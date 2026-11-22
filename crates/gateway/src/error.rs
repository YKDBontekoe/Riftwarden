//! API errors: a stable machine code plus a message the client can show.

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;

#[derive(Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self { status, code, message: message.into() }
    }
    pub fn bad(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }
    pub fn unauthorized() -> Self {
        Self::new(StatusCode::UNAUTHORIZED, "unauthorized", "Sign in first")
    }
    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, code, message)
    }
    pub fn limited() -> Self {
        Self::new(StatusCode::TOO_MANY_REQUESTS, "rate_limited", "Too many attempts, wait a minute")
    }
    pub fn internal(e: impl std::fmt::Display) -> Self {
        tracing::error!(error = %e, "internal error");
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", "Server error")
    }
}

#[derive(Serialize)]
struct Body<'a> {
    error: &'a str,
    message: &'a str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(Body { error: self.code, message: &self.message })).into_response()
    }
}

impl From<riftwarden_db::DbError> for ApiError {
    fn from(e: riftwarden_db::DbError) -> Self {
        match e {
            riftwarden_db::DbError::Conflict => Self::conflict("conflict", "Already taken"),
            other => Self::internal(other),
        }
    }
}

impl From<redis::RedisError> for ApiError {
    fn from(e: redis::RedisError) -> Self {
        Self::internal(e)
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
