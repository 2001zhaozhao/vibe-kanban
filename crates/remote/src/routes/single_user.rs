use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    AppState,
    db::{
        auth::AuthSessionRepository,
        oauth_accounts::{OAuthAccountInsert, OAuthAccountRepository},
        organizations::OrganizationRepository,
        users::{UpsertUser, UserRepository},
    },
};

/// Deterministic UUID for the single-user local account.
fn single_user_id() -> Uuid {
    Uuid::new_v5(&Uuid::NAMESPACE_URL, b"vibekanban-single-user-local")
}

pub fn public_router() -> Router<AppState> {
    Router::new().route("/auth/single-user/login", post(single_user_login))
}

#[derive(Debug, Serialize)]
struct SingleUserLoginResponse {
    access_token: String,
    refresh_token: String,
}

#[derive(Debug, thiserror::Error)]
enum SingleUserLoginError {
    #[error("single-user mode is not enabled")]
    NotEnabled,
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("identity error: {0}")]
    Identity(#[from] crate::db::identity_errors::IdentityError),
    #[error("oauth account error: {0}")]
    OAuthAccount(#[from] crate::db::oauth_accounts::OAuthAccountError),
    #[error("session error: {0}")]
    Session(#[from] crate::db::auth::AuthSessionError),
    #[error("jwt error: {0}")]
    Jwt(#[from] crate::auth::JwtError),
}

impl IntoResponse for SingleUserLoginError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            SingleUserLoginError::NotEnabled => (StatusCode::NOT_FOUND, "not_found"),
            SingleUserLoginError::Database(_) => {
                tracing::error!(error = %self, "Database error during single-user login");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
            SingleUserLoginError::Identity(_) => {
                tracing::error!(error = %self, "Identity error during single-user login");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
            SingleUserLoginError::OAuthAccount(_) => {
                tracing::error!(error = %self, "OAuth account error during single-user login");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
            SingleUserLoginError::Session(_) => {
                tracing::error!(error = %self, "Session error during single-user login");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
            SingleUserLoginError::Jwt(_) => {
                tracing::error!(error = %self, "JWT error during single-user login");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
        };

        let body = serde_json::json!({
            "error": message,
            "message": self.to_string()
        });

        (status, Json(body)).into_response()
    }
}

async fn single_user_login(
    State(state): State<AppState>,
) -> Result<Json<SingleUserLoginResponse>, SingleUserLoginError> {
    if !state.single_user_mode() {
        return Err(SingleUserLoginError::NotEnabled);
    }

    let user_id = single_user_id();

    // 1. Upsert user
    let user_repo = UserRepository::new(state.pool());
    let user = user_repo
        .upsert_user(UpsertUser {
            id: user_id,
            email: "local@vibekanban.local",
            first_name: Some("Local"),
            last_name: Some("User"),
            username: Some("local"),
        })
        .await?;

    // 2. Ensure personal org and admin membership
    let org_repo = OrganizationRepository::new(state.pool());
    org_repo
        .ensure_personal_org_and_admin_membership(user_id, Some("Local User"))
        .await?;

    // 3. Upsert OAuth account
    let oauth_repo = OAuthAccountRepository::new(state.pool());
    oauth_repo
        .upsert(OAuthAccountInsert {
            user_id,
            provider: "local",
            provider_user_id: "local-single-user",
            email: Some("local@vibekanban.local"),
            username: Some("local"),
            display_name: Some("Local User"),
            avatar_url: None,
            encrypted_provider_tokens: None,
        })
        .await?;

    // 4. Create auth session
    let session_repo = AuthSessionRepository::new(state.pool());
    let session = session_repo.create(user_id, None).await?;

    // 5. Generate JWT tokens
    let jwt = state.jwt();
    let tokens = jwt.generate_tokens(&session, &user, "local")?;

    // 7. Set refresh token on session
    session_repo
        .set_current_refresh_token(session.id, tokens.refresh_token_id)
        .await?;

    tracing::info!(user_id = %user_id, "Single-user login successful");

    Ok(Json(SingleUserLoginResponse {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
    }))
}
