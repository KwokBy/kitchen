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
use chrono::{DateTime, Duration, NaiveDate, Utc};
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
    wechat_subscribe_template_id: String,
    wechat_miniprogram_state: String,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateNotificationRequest {
    kind: String,
    date: Option<String>,
    #[serde(default)]
    dish_names: Vec<String>,
}

#[derive(FromRow)]
struct NotificationRow {
    id: Uuid,
    kind: String,
    plan_date: Option<NaiveDate>,
    dish_names: Vec<String>,
    sender_nickname: String,
    read_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationView {
    id: Uuid,
    kind: String,
    date: Option<NaiveDate>,
    dish_names: Vec<String>,
    sender_nickname: String,
    is_read: bool,
    push_sent: bool,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct WechatAccessTokenResponse {
    access_token: Option<String>,
    errcode: Option<i64>,
    errmsg: Option<String>,
}

#[derive(Deserialize)]
struct WechatApiResponse {
    errcode: i64,
    errmsg: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationsResponse {
    notifications: Vec<NotificationView>,
    unread_count: usize,
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
        wechat_subscribe_template_id: env::var("WECHAT_SUBSCRIBE_TEMPLATE_ID").unwrap_or_default(),
        wechat_miniprogram_state: env::var("WECHAT_MINIPROGRAM_STATE")
            .unwrap_or_else(|_| "trial".to_owned()),
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
        .route(
            "/v1/notifications",
            get(list_notifications).post(create_notification),
        )
        .route("/v1/notifications/read", put(read_notifications))
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

async fn list_notifications(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
) -> Result<Json<NotificationsResponse>, ApiError> {
    let rows = sqlx::query_as::<_, NotificationRow>(
        "SELECT n.id, n.kind, n.plan_date, n.dish_names, u.nickname AS sender_nickname, \
         n.read_at, n.created_at \
         FROM kitchen_notifications n JOIN users u ON u.id = n.sender_user_id \
         WHERE n.recipient_user_id = $1 ORDER BY n.created_at DESC LIMIT 30",
    )
    .bind(user_id)
    .fetch_all(&state.pool)
    .await
    .map_err(internal)?;
    let unread_count = rows.iter().filter(|row| row.read_at.is_none()).count();
    let notifications = rows
        .into_iter()
        .map(|row| NotificationView {
            id: row.id,
            kind: row.kind,
            date: row.plan_date,
            dish_names: row.dish_names,
            sender_nickname: row.sender_nickname,
            is_read: row.read_at.is_some(),
            push_sent: false,
            created_at: row.created_at,
        })
        .collect();
    Ok(Json(NotificationsResponse {
        notifications,
        unread_count,
    }))
}

async fn create_notification(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
    body: Result<Json<CreateNotificationRequest>, JsonRejection>,
) -> Result<Json<NotificationView>, ApiError> {
    let Json(body) = body.map_err(invalid_json)?;
    let membership = sqlx::query_as::<_, (Uuid, String)>(
        "SELECT kitchen_id, role FROM kitchen_members WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?
    .ok_or_else(|| ApiError::BadRequest("请先加入厨房".to_owned()))?;
    let target_role = match (body.kind.as_str(), membership.1.as_str()) {
        ("menu_ready", "member") => "owner",
        ("pick_reminder", "owner") => "member",
        ("menu_ready", _) => {
            return Err(ApiError::BadRequest(
                "你就是做饭主力，无需通知自己".to_owned(),
            ));
        }
        ("pick_reminder", _) => {
            return Err(ApiError::Forbidden("只有做饭主力可以提醒点菜".to_owned()));
        }
        _ => return Err(ApiError::BadRequest("通知类型无效".to_owned())),
    };
    let recipient_user_id = sqlx::query_scalar::<_, Uuid>(
        "SELECT user_id FROM kitchen_members WHERE kitchen_id = $1 AND role = $2",
    )
    .bind(membership.0)
    .bind(target_role)
    .fetch_optional(&state.pool)
    .await
    .map_err(internal)?
    .ok_or_else(|| ApiError::BadRequest("厨房里的另一位成员还没有加入".to_owned()))?;
    let recipient_openid =
        sqlx::query_scalar::<_, String>("SELECT openid FROM users WHERE id = $1")
            .bind(recipient_user_id)
            .fetch_one(&state.pool)
            .await
            .map_err(internal)?;
    let plan_date = match body.date {
        Some(value) => Some(
            NaiveDate::parse_from_str(value.trim(), "%Y-%m-%d")
                .map_err(|_| ApiError::BadRequest("菜单日期格式无效".to_owned()))?,
        ),
        None => None,
    };
    let dish_names: Vec<String> = body
        .dish_names
        .into_iter()
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .collect();
    if body.kind == "menu_ready"
        && (plan_date.is_none()
            || dish_names.is_empty()
            || dish_names.len() > 20
            || dish_names.iter().any(|name| name.chars().count() > 40))
    {
        return Err(ApiError::BadRequest(
            "点菜通知需要日期和 1 到 20 道菜".to_owned(),
        ));
    }
    let notification_id = Uuid::new_v4();
    let row = sqlx::query_as::<_, NotificationRow>(
        "WITH inserted AS ( \
           INSERT INTO kitchen_notifications \
             (id, kitchen_id, sender_user_id, recipient_user_id, kind, plan_date, dish_names) \
           VALUES ($1, $2, $3, $4, $5, $6, $7) \
           RETURNING * \
         ) \
         SELECT inserted.id, inserted.kind, inserted.plan_date, inserted.dish_names, \
           users.nickname AS sender_nickname, inserted.read_at, inserted.created_at \
         FROM inserted JOIN users ON users.id = inserted.sender_user_id",
    )
    .bind(notification_id)
    .bind(membership.0)
    .bind(user_id)
    .bind(recipient_user_id)
    .bind(&body.kind)
    .bind(plan_date)
    .bind(&dish_names)
    .fetch_one(&state.pool)
    .await
    .map_err(internal)?;
    let push_sent = send_wechat_subscription(
        &state,
        &recipient_openid,
        &row.sender_nickname,
        &row.kind,
        row.plan_date,
        &row.dish_names,
    )
    .await;
    Ok(Json(NotificationView {
        id: row.id,
        kind: row.kind,
        date: row.plan_date,
        dish_names: row.dish_names,
        sender_nickname: row.sender_nickname,
        is_read: false,
        push_sent,
        created_at: row.created_at,
    }))
}

async fn send_wechat_subscription(
    state: &AppState,
    recipient_openid: &str,
    sender_nickname: &str,
    kind: &str,
    plan_date: Option<NaiveDate>,
    dish_names: &[String],
) -> bool {
    if state.wechat_subscribe_template_id.is_empty() {
        return false;
    }
    let token_response = match state
        .http
        .get("https://api.weixin.qq.com/cgi-bin/token")
        .query(&[
            ("grant_type", "client_credential"),
            ("appid", state.wechat_app_id.as_str()),
            ("secret", state.wechat_app_secret.as_str()),
        ])
        .send()
        .await
    {
        Ok(response) => match response.json::<WechatAccessTokenResponse>().await {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(%error, "cannot decode WeChat access token response");
                return false;
            }
        },
        Err(error) => {
            tracing::warn!(%error, "cannot request WeChat access token");
            return false;
        }
    };
    let Some(access_token) = token_response.access_token else {
        tracing::warn!(errcode = ?token_response.errcode, errmsg = ?token_response.errmsg, "WeChat access token rejected");
        return false;
    };
    let message = if kind == "menu_ready" {
        let date = plan_date
            .map(|value| value.format("%m/%d").to_string())
            .unwrap_or_default();
        format!("{date}菜单：{}", dish_names.join("、"))
    } else {
        "想和你一起选这几天吃什么".to_owned()
    };
    let now = Utc::now() + Duration::hours(8);
    let body = serde_json::json!({
        "touser": recipient_openid,
        "template_id": state.wechat_subscribe_template_id,
        "page": "pages/today/today",
        "miniprogram_state": state.wechat_miniprogram_state,
        "lang": "zh_CN",
        "data": {
            "thing1": { "value": truncate_chars(sender_nickname, 20) },
            "thing2": { "value": truncate_chars(&message, 20) },
            "time3": { "value": now.format("%Y年%m月%d日 %H:%M").to_string() }
        }
    });
    let response = match state
        .http
        .post("https://api.weixin.qq.com/cgi-bin/message/subscribe/send")
        .query(&[("access_token", access_token.as_str())])
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(%error, "cannot send WeChat subscription message");
            return false;
        }
    };
    match response.json::<WechatApiResponse>().await {
        Ok(result) if result.errcode == 0 => true,
        Ok(result) => {
            tracing::info!(errcode = result.errcode, errmsg = %result.errmsg, "WeChat subscription message not delivered");
            false
        }
        Err(error) => {
            tracing::warn!(%error, "cannot decode WeChat subscription response");
            false
        }
    }
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

async fn read_notifications(
    State(state): State<AppState>,
    AuthenticatedUser(user_id): AuthenticatedUser,
) -> Result<StatusCode, ApiError> {
    sqlx::query(
        "UPDATE kitchen_notifications SET read_at = now() \
         WHERE recipient_user_id = $1 AND read_at IS NULL",
    )
    .bind(user_id)
    .execute(&state.pool)
    .await
    .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
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
