use std::{env, net::SocketAddr, sync::Arc};

use axum::{
    Json, Router,
    body::Body,
    extract::{FromRequestParts, Path, State, rejection::JsonRejection},
    http::{StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
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
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("服务暂时不可用")]
    Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::Forbidden(_) => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
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

struct AuthenticatedUser(Uuid);

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let value = parts
            .headers
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
        Ok(Self(claims.claims.sub))
    }
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateKitchenSettingsRequest {
    name: String,
    owner_role_name: String,
    member_role_name: String,
}

#[derive(FromRow)]
struct KitchenRow {
    id: Uuid,
    name: String,
    invite_code: String,
    owner_role_name: String,
    member_role_name: String,
    role: String,
    member_count: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KitchenView {
    id: Uuid,
    name: String,
    invite_code: String,
    owner_role_name: String,
    member_role_name: String,
    role: String,
    member_count: i64,
    members: Vec<MemberView>,
}

#[derive(FromRow)]
struct MemberRow {
    user_id: Uuid,
    role: String,
    nickname: String,
    has_avatar: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MemberView {
    user_id: Uuid,
    role: String,
    nickname: String,
    avatar_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProfileRequest {
    nickname: String,
    avatar_data: Option<String>,
    avatar_content_type: Option<String>,
}

#[derive(Serialize)]
struct KitchenResponse {
    kitchen: KitchenView,
}

#[derive(Serialize)]
struct OptionalKitchenResponse {
    kitchen: Option<KitchenView>,
}

impl KitchenView {
    fn from_row(row: KitchenRow, members: Vec<MemberView>) -> Self {
        Self {
            id: row.id,
            name: row.name,
            invite_code: row.invite_code.trim().to_owned(),
            owner_role_name: row.owner_role_name,
            member_role_name: row.member_role_name,
            role: row.role,
            member_count: row.member_count,
            members,
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
        .route(
            "/v1/kitchens",
            get(current_kitchen)
                .post(create_kitchen)
                .put(update_kitchen_settings),
        )
        .route("/v1/kitchens/join", post(join_kitchen))
        .route("/v1/users/me/profile", put(update_profile))
        .route("/v1/users/{user_id}/avatar", get(user_avatar))
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
    body: Result<Json<WechatLoginRequest>, JsonRejection>,
) -> Result<Json<AuthResponse>, ApiError> {
    let Json(body) = body.map_err(invalid_json)?;
    let code = body.code.trim();
    if code.is_empty() || code.chars().count() > 128 {
        return Err(ApiError::BadRequest("微信登录 code 格式无效".to_owned()));
    }
    let session = state
        .http
        .get("https://api.weixin.qq.com/sns/jscode2session")
        .query(&[
            ("appid", state.wechat_app_id.as_str()),
            ("secret", state.wechat_app_secret.as_str()),
            ("js_code", code),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(internal)?
        .json::<WechatSession>()
        .await
        .map_err(internal)?;
    let openid = session.openid.ok_or_else(|| {
        tracing::warn!(errcode = ?session.errcode, errmsg = ?session.errmsg, "WeChat login rejected");
        ApiError::BadRequest("微信登录失败，请重新尝试".to_owned())
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
    AuthenticatedUser(user_id): AuthenticatedUser,
    body: Result<Json<CreateKitchenRequest>, JsonRejection>,
) -> Result<Json<KitchenResponse>, ApiError> {
    let Json(body) = body.map_err(invalid_json)?;
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err(ApiError::BadRequest(
            "厨房名称需要是 1 到 40 个字".to_owned(),
        ));
    }
    let kitchen_id = Uuid::new_v4();
    let invite_code = new_invite_code();
    let mut tx = state.pool.begin().await.map_err(internal)?;
    sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let has_kitchen = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM kitchen_members WHERE user_id = $1)",
    )
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    if has_kitchen {
        return Err(ApiError::Conflict("每个人只能拥有一个厨房".to_owned()));
    }
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
    let members = load_members(&state.pool, kitchen_id).await?;
    Ok(Json(KitchenResponse {
        kitchen: KitchenView {
            id: kitchen_id,
            name: name.to_owned(),
            invite_code,
            owner_role_name: "做饭主力".to_owned(),
            member_role_name: "点菜主力".to_owned(),
            role: "owner".to_owned(),
            member_count: 1,
            members,
        },
    }))
}

async fn current_kitchen(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
) -> Result<Json<OptionalKitchenResponse>, ApiError> {
    let row = sqlx::query_as::<_, KitchenRow>(
        "SELECT k.id, k.name, k.invite_code, k.owner_role_name, k.member_role_name, km.role, COUNT(all_members.user_id) AS member_count \
         FROM kitchens k \
         JOIN kitchen_members km ON km.kitchen_id = k.id AND km.user_id = $1 \
         JOIN kitchen_members all_members ON all_members.kitchen_id = k.id \
         GROUP BY k.id, km.role",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?;
    let kitchen = match row {
        Some(row) => {
            let members = load_members(&state.pool, row.id).await?;
            Some(KitchenView::from_row(row, members))
        }
        None => None,
    };
    Ok(Json(OptionalKitchenResponse { kitchen }))
}

async fn join_kitchen(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
    body: Result<Json<JoinKitchenRequest>, JsonRejection>,
) -> Result<Json<KitchenResponse>, ApiError> {
    let Json(body) = body.map_err(invalid_json)?;
    let code = body.invite_code.trim().to_uppercase();
    if code.len() != 6 {
        return Err(ApiError::BadRequest("邀请码应为 6 位".to_owned()));
    }
    let mut tx = state.pool.begin().await.map_err(internal)?;
    sqlx::query("SELECT id FROM users WHERE id = $1 FOR UPDATE")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(internal)?;
    let existing_kitchen =
        sqlx::query_scalar::<_, Uuid>("SELECT kitchen_id FROM kitchen_members WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(internal)?;
    if existing_kitchen.is_some() {
        return Err(ApiError::Conflict(
            "你已经有厨房了，不能再加入其他厨房".to_owned(),
        ));
    }
    let kitchen_id =
        sqlx::query_scalar::<_, Uuid>("SELECT id FROM kitchens WHERE invite_code = $1 FOR UPDATE")
            .bind(&code)
            .fetch_optional(&mut *tx)
            .await
            .map_err(internal)?
            .ok_or_else(|| ApiError::NotFound("邀请码无效".to_owned()))?;
    let member_count =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM kitchen_members WHERE kitchen_id = $1")
            .bind(kitchen_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(internal)?;
    if member_count >= 2 {
        return Err(ApiError::Conflict("这个厨房已经满员了".to_owned()));
    }
    sqlx::query(
        "INSERT INTO kitchen_members (kitchen_id, user_id, role) VALUES ($1, $2, 'member')",
    )
    .bind(kitchen_id)
    .bind(user_id)
    .execute(&mut *tx)
    .await
    .map_err(internal)?;
    let row = sqlx::query_as::<_, KitchenRow>(
        "SELECT k.id, k.name, k.invite_code, k.owner_role_name, k.member_role_name, km.role, COUNT(all_members.user_id) AS member_count \
         FROM kitchens k \
         JOIN kitchen_members km ON km.kitchen_id = k.id AND km.user_id = $2 \
         JOIN kitchen_members all_members ON all_members.kitchen_id = k.id \
         WHERE k.id = $1 GROUP BY k.id, km.role",
    )
    .bind(kitchen_id)
    .bind(user_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(internal)?;
    tx.commit().await.map_err(internal)?;
    let members = load_members(&state.pool, kitchen_id).await?;
    Ok(Json(KitchenResponse {
        kitchen: KitchenView::from_row(row, members),
    }))
}

async fn update_kitchen_settings(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
    body: Result<Json<UpdateKitchenSettingsRequest>, JsonRejection>,
) -> Result<Json<KitchenResponse>, ApiError> {
    let Json(body) = body.map_err(invalid_json)?;
    let name = body.name.trim();
    let owner_role_name = body.owner_role_name.trim();
    let member_role_name = body.member_role_name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err(ApiError::BadRequest(
            "厨房名称需要是 1 到 40 个字".to_owned(),
        ));
    }
    if owner_role_name.is_empty()
        || owner_role_name.chars().count() > 20
        || member_role_name.is_empty()
        || member_role_name.chars().count() > 20
    {
        return Err(ApiError::BadRequest(
            "身份称呼需要是 1 到 20 个字".to_owned(),
        ));
    }
    let kitchen_id = sqlx::query_scalar::<_, Uuid>(
        "UPDATE kitchens SET name = $2, owner_role_name = $3, member_role_name = $4 \
         WHERE owner_user_id = $1 RETURNING id",
    )
    .bind(user_id)
    .bind(name)
    .bind(owner_role_name)
    .bind(member_role_name)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?
    .ok_or_else(|| ApiError::Forbidden("只有厨房创建者可以修改共享设置".to_owned()))?;
    let row = sqlx::query_as::<_, KitchenRow>(
        "SELECT k.id, k.name, k.invite_code, k.owner_role_name, k.member_role_name, km.role, COUNT(all_members.user_id) AS member_count \
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
    let members = load_members(&state.pool, kitchen_id).await?;
    Ok(Json(KitchenResponse {
        kitchen: KitchenView::from_row(row, members),
    }))
}

async fn load_members(pool: &PgPool, kitchen_id: Uuid) -> Result<Vec<MemberView>, ApiError> {
    let rows = sqlx::query_as::<_, MemberRow>(
        "SELECT km.user_id, km.role, u.nickname, u.avatar IS NOT NULL AS has_avatar \
         FROM kitchen_members km JOIN users u ON u.id = km.user_id \
         WHERE km.kitchen_id = $1 \
         ORDER BY CASE km.role WHEN 'owner' THEN 0 ELSE 1 END, km.joined_at",
    )
    .bind(kitchen_id)
    .fetch_all(pool)
    .await
    .map_err(internal)?;
    Ok(rows
        .into_iter()
        .map(|row| MemberView {
            user_id: row.user_id,
            role: row.role,
            nickname: row.nickname,
            avatar_url: if row.has_avatar {
                format!("/v1/users/{}/avatar", row.user_id)
            } else {
                String::new()
            },
        })
        .collect())
}

async fn update_profile(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
    body: Result<Json<UpdateProfileRequest>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    let Json(body) = body.map_err(invalid_json)?;
    let nickname = body.nickname.trim();
    if nickname.is_empty() || nickname.chars().count() > 40 {
        return Err(ApiError::BadRequest(
            "微信昵称需要是 1 到 40 个字".to_owned(),
        ));
    }
    let avatar = match body.avatar_data {
        Some(value) => {
            let decoded = BASE64
                .decode(value)
                .map_err(|_| ApiError::BadRequest("头像数据格式无效".to_owned()))?;
            if decoded.len() > 2 * 1024 * 1024 {
                return Err(ApiError::BadRequest("头像不能超过 2MB".to_owned()));
            }
            Some(decoded)
        }
        None => None,
    };
    let content_type = body
        .avatar_content_type
        .unwrap_or_else(|| "image/jpeg".to_owned());
    if !matches!(
        content_type.as_str(),
        "image/jpeg" | "image/png" | "image/webp"
    ) {
        return Err(ApiError::BadRequest("头像图片格式不支持".to_owned()));
    }
    sqlx::query(
        "UPDATE users SET nickname = $2, \
         avatar = COALESCE($3, avatar), \
         avatar_content_type = CASE WHEN $3 IS NULL THEN avatar_content_type ELSE $4 END \
         WHERE id = $1",
    )
    .bind(user_id)
    .bind(nickname)
    .bind(avatar)
    .bind(content_type)
    .execute(&state.pool)
    .await
    .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn user_avatar(
    State(state): State<AppState>,
    Path(user_id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let row = sqlx::query_as::<_, (Vec<u8>, String)>(
        "SELECT avatar, avatar_content_type FROM users WHERE id = $1 AND avatar IS NOT NULL",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?
    .ok_or_else(|| ApiError::NotFound("头像不存在".to_owned()))?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, row.1)
        .header(header::CACHE_CONTROL, "public, max-age=300")
        .body(Body::from(row.0))
        .map_err(internal)
}

fn invalid_json(_: JsonRejection) -> ApiError {
    ApiError::BadRequest("请求格式不正确".to_owned())
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
