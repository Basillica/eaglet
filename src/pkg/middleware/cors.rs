use actix_cors::Cors;
// use actix_web::http::header;
// use std::env;

pub fn cors_middleware() -> Cors {
    Cors::permissive()
    // let origin = &env::var("CORS_ALLOWED_ORIGIN").unwrap_or("http://localhost:3000".to_string());
    // Cors::default()
    //     .allowed_origin(&origin)
    //     // .allowed_origin_fn(|origin, _req_head| origin.as_bytes().starts_with(origin.as_bytes()))
    //     .allowed_methods(vec!["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    //     .allowed_headers(vec![
    //         header::AUTHORIZATION,
    //         header::ACCEPT,
    //         header::CONTENT_TYPE,
    //         header::HeaderName::from_static("x-api-key"),
    //         header::HeaderName::from_static("token-exp"),
    //         header::HeaderName::from_static("x-access-token"),
    //         header::HeaderName::from_static("user-data"),
    //         header::HeaderName::from_static("x-requested-with"),
    //     ])
    //     .expose_any_header()
    //     .supports_credentials()
    //     .max_age(3600)
}
