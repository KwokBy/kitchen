use std::{env, net::SocketAddr, sync::Arc};

use axum::{
    Json, Router,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool, postgres::PgPoolOptions};
use thiserror::Error;
use uuid::Uuid;

#[derive(Clone)]
struct AppState {
    pool: PgPool,
    http: reqwest::Client,
    wechat_app_id: String,
    wechat_app_secret: String,
    jwt_secret: Arc<String>,
}

#[derive(Debug, Error)]
enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("请先登录")]
    Unauthorized,
    #[error("{0}")]
    NotFound(String),
    #[error("服务暂时不可用")]
    Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(serde_json::json!({ "message": self.to_string() })),
        )
            .into_response()
    }
}

#[derive(Deserialize)]
struct WechatLoginRequest {
    code: String,
}

#[derive(Deserialize)]
struct WechatSession {
    openid: Option<String>,
    unionid: Option<String>,
    errcode: Option<i64>,
    errmsg: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: Uuid,
    iat: usize,
    exp: usize,
}

#[derive(Serialize)]
struct UserView {
    id: Uuid,
}

#[derive(Serialize)]
struct AuthResponse {
    token: String,
    user: UserView,
}

#[derive(Deserialize)]
struct CreateKitchenRequest {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinKitchenRequest {
    invite_code: String,
}

#[derive(FromRow)]
struct KitchenRow {
    id: Uuid,
    name: String,
    invite_code: String,
    role: String,
    member_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KitchenView {
    id: Uuid,
    name: String,
    invite_code: String,
    role: String,
    member_count: i64,
}

#[derive(Serialize)]
struct KitchenResponse {
    kitchen: KitchenView,
}

impl From<KitchenRow> for KitchenView {
    fn from(row: KitchenRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            invite_code: row.invite_code.trim().to_owned(),
            role: row.role,
            member_count: row.member_count,
        }
    }
}

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let database_url = required_env("DATABASE_URL");
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(&database_url)
        .await
        .expect("cannot connect to PostgreSQL");
    sqlx::migrate!()
        .run(&pool)
        .await
        .expect("database migration failed");

    let state = AppState {
        pool,
        http: reqwest::Client::new(),
        wechat_app_id: required_env("WECHAT_APP_ID"),
        wechat_app_secret: required_env("WECHAT_APP_SECRET"),
        jwt_secret: Arc::new(required_env("JWT_SECRET")),
    };
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/v1/auth/wechat", post(wechat_login))
        .route("/v1/kitchens", post(create_kitchen))
        .route("/v1/kitchens/join", post(join_kitchen))
        .with_state(state);

    let addr: SocketAddr = env::var("LISTEN_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8787".to_owned())
        .parse()
        .expect("LISTEN_ADDR must be a socket address");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("cannot bind server");
    tracing::info!(%addr, "API listening");
    axum::serve(listener, app)
        .await
        .expect("server stopped unexpectedly");
}

fn required_env(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| panic!("missing required environment variable {name}"))
}

async fn healthz() -> &'static str {
    "ok"
}

async fn wechat_login(
    State(state): State<AppState>,
    Json(body): Json<WechatLoginRequest>,
) -> Result<Json<AuthResponse>, ApiError> {
    if body.code.trim().is_empty() {
        return Err(ApiError::BadRequest("缺少微信登录 code".to_owned()));
    }
    let session = state
        .http
        .get("https://api.weixin.qq.com/sns/jscode2session")
        .query(&[
            ("appid", state.wechat_app_id.as_str()),
            ("secret", state.wechat_app_secret.as_str()),
            ("js_code", body.code.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(internal)?
        .json::<WechatSession>()
        .await
        .map_err(internal)?;
    let openid = session.openid.ok_or_else(|| {
        ApiError::BadRequest(
            session
                .errmsg
                .unwrap_or_else(|| format!("微信登录失败（{}）", session.errcode.unwrap_or(-1))),
        )
    })?;
    let user_id = Uuid::new_v4();
    let stored_id = sqlx::query_scalar::<_, Uuid>(
        "INSERT INTO users (id, openid, unionid) VALUES ($1, $2, $3) \
         ON CONFLICT (openid) DO UPDATE SET unionid = COALESCE(EXCLUDED.unionid, users.unionid) RETURNING id",
    )
    .bind(user_id)
    .bind(openid)
    .bind(session.unionid)
    .fetch_one(&state.pool)
    .await
    .map_err(internal)?;
    let now = Utc::now();
    let claims = Claims {
        sub: stored_id,
        iat: now.timestamp() as usize,
        exp: (now + Duration::days(30)).timestamp() as usize,
    };
    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(state.jwt_secret.as_bytes()),
    )
    .map_err(internal)?;
    Ok(Json(AuthResponse {
        token,
        user: UserView { id: stored_id },
    }))
}

async fn create_kitchen(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateKitchenRequest>,
) -> Result<Json<KitchenResponse>, ApiError> {
    let user_id = authenticated_user(&state, &headers)?;
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err(ApiError::BadRequest(
            "厨房名称需要是 1 到 40 个字".to_owned(),
        ));
    }
    let kitchen_id = Uuid::new_v4();
    let invite_code = new_invite_code();
    let mut tx = state.pool.begin().await.map_err(internal)?;
    sqlx::query(
        "INSERT INTO kitchens (id, name, invite_code, owner_user_id) VALUES ($1, $2, $3, $4)",
    )
    .bind(kitchen_id)
    .bind(name)
    .bind(&invite_code)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    sqlx::query("INSERT INTO kitchen_members (kitchen_id, user_id, role) VALUES ($1, $2, 'owner')")
        .bind(kitchen_id)
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    Ok(Json(KitchenResponse {
        kitchen: KitchenView {
            id: kitchen_id,
            name: name.to_owned(),
            invite_code,
            role: "owner".to_owned(),
            member_count: 1,
        },
    }))
}

async fn join_kitchen(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<JoinKitchenRequest>,
) -> Result<Json<KitchenResponse>, ApiError> {
    let user_id = authenticated_user(&state, &headers)?;
    let code = body.invite_code.trim().to_uppercase();
    if code.len() != 6 {
        return Err(ApiError::BadRequest("邀请码应为 6 位".to_owned()));
    }
    let kitchen_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM kitchens WHERE invite_code = $1")
            .bind(&code)
            .fetch_optional(&state.pool)
            .await
            .map_err(internal)?
            .ok_or_else(|| ApiError::NotFound("邀请码无效".to_owned()))?;
    sqlx::query(
        "INSERT INTO kitchen_members (kitchen_id, user_id, role) VALUES ($1, $2, 'member') \
         ON CONFLICT (kitchen_id, user_id) DO NOTHING",
    )
    .bind(kitchen_id)
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(internal)?;
    let row = sqlx::query_as::<_, KitchenRow>(
        "SELECT k.id, k.name, k.invite_code, km.role, COUNT(all_members.user_id) AS member_count \
         FROM kitchens k \
         JOIN kitchen_members km ON km.kitchen_id = k.id AND km.user_id = $2 \
         JOIN kitchen_members all_members ON all_members.kitchen_id = k.id \
         WHERE k.id = $1 GROUP BY k.id, km.role",
    )
    .bind(kitchen_id)
    .bind(user_id)
    .fetch_one(&state.pool)
    .await
    .map_err(internal)?;
    Ok(Json(KitchenResponse {
        kitchen: row.into(),
    }))
}

fn authenticated_user(state: &AppState, headers: &HeaderMap) -> Result<Uuid, ApiError> {
    let value = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .ok_or(ApiError::Unauthorized)?;
    let claims = decode::<Claims>(
        value,
        &DecodingKey::from_secret(state.jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|_| ApiError::Unauthorized)?;
    Ok(claims.claims.sub)
}

fn new_invite_code() -> String {
    const ALPHABET: &[u8] = b"23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    Uuid::new_v4()
        .as_bytes()
        .iter()
        .take(6)
        .map(|byte| ALPHABET[*byte as usize % ALPHABET.len()] as char)
        .collect()
}

fn internal(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(%error, "request failed");
    ApiError::Internal
}
