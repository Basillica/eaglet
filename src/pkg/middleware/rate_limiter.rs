use crate::pkg::utils::bucket::TokenBucket;
use actix_web::{
    dev::{Service, ServiceRequest, ServiceResponse, Transform},
    error::ErrorTooManyRequests,
    Error,
};
use futures::future::{ok, Ready};
use futures_util::future::LocalBoxFuture;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use std::time::Duration;

pub struct RateLimiter {
    fill_interval: Duration,
    capacity: i64,
    buckets: Arc<Mutex<HashMap<String, Arc<Mutex<TokenBucket>>>>>,
}

impl RateLimiter {
    pub fn new(fill_interval: Duration, capacity: i64) -> Self {
        Self {
            fill_interval,
            capacity,
            buckets: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl<S, B> Transform<S, ServiceRequest> for RateLimiter
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error> + 'static,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Transform = RateLimiterMiddleware<S>;
    type InitError = ();
    type Future = Ready<Result<Self::Transform, Self::InitError>>;

    fn new_transform(&self, service: S) -> Self::Future {
        ok(RateLimiterMiddleware {
            service,
            fill_interval: self.fill_interval,
            capacity: self.capacity,
            buckets: self.buckets.clone(),
        })
    }
}

pub struct RateLimiterMiddleware<S> {
    service: S,
    fill_interval: Duration,
    capacity: i64,
    buckets: Arc<Mutex<HashMap<String, Arc<Mutex<TokenBucket>>>>>,
}

impl<S, B> Service<ServiceRequest> for RateLimiterMiddleware<S>
where
    S: Service<ServiceRequest, Response = ServiceResponse<B>, Error = Error>,
    S::Future: 'static,
    B: 'static,
{
    type Response = ServiceResponse<B>;
    type Error = Error;
    type Future = LocalBoxFuture<'static, Result<Self::Response, Self::Error>>;

    fn poll_ready(&self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&self, req: ServiceRequest) -> Self::Future {
        let client_ip = req
            .connection_info()
            .realip_remote_addr()
            .unwrap_or("unknown")
            .to_string();
        let mut buckets = self.buckets.lock().unwrap();

        let bucket = buckets
            .entry(client_ip.clone())
            .or_insert_with(|| TokenBucket::new(self.fill_interval, self.capacity));

        let mut bucket = bucket.lock().unwrap();

        if bucket.take_available(1) {
            let fut = self.service.call(req);
            Box::pin(async move {
                let res = fut.await?;
                Ok(res)
            })
        } else {
            let retry_after = bucket.retry_after();
            return Box::pin(async move {
                Err(ErrorTooManyRequests(format!(
                    "Too many requests. Retry after {}",
                    retry_after.as_secs_f64()
                )))
            });
        }
    }
}
