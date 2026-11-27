use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};

pub fn local_proxy() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::mirror_request())
        .allow_credentials(true)
        .allow_methods(AllowMethods::mirror_request())
        .allow_headers(AllowHeaders::mirror_request())
}

#[cfg(test)]
mod tests {
    use axum::{http::StatusCode, routing::get, Router};

    #[tokio::test]
    async fn credentialed_preflight_allows_the_requested_method_and_headers() {
        let router = Router::new().route("/session", get(|| async { "ok" })).layer(super::local_proxy());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

        let response = reqwest::Client::new()
            .request(reqwest::Method::OPTIONS, format!("http://{address}/session"))
            .header("Origin", "tauri://localhost")
            .header("Access-Control-Request-Method", "POST")
            .header("Access-Control-Request-Headers", "content-type")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let headers = response.headers();
        assert_eq!(headers["access-control-allow-origin"], "tauri://localhost");
        assert_eq!(headers["access-control-allow-credentials"], "true");
        assert_eq!(headers["access-control-allow-methods"], "POST");
        assert_eq!(headers["access-control-allow-headers"], "content-type");
        server.abort();
    }
}
