use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug)]
pub struct TokenBucket {
    tokens: i64,
    capacity: i64,
    fill_rate: f64,
    last_refill: Instant,
}

impl TokenBucket {
    /// Create a new TokenBucket with a specified fill interval and capacity.
    pub fn new(fill_interval: Duration, capacity: i64) -> Arc<Mutex<Self>> {
        Arc::new(Mutex::new(Self {
            tokens: capacity,
            capacity,
            fill_rate: capacity as f64 / fill_interval.as_secs_f64(),
            last_refill: Instant::now(),
        }))
    }

    /// Attempt to take `count` tokens from the bucket.
    /// Returns true if successful, false otherwise.
    pub fn take_available(&mut self, count: i64) -> bool {
        self.refill();
        if self.tokens >= count {
            self.tokens -= count;
            true
        } else {
            false
        }
    }

    /// Calculate the time duration required to get at least one token.
    pub fn retry_after(&mut self) -> Duration {
        self.refill();
        if self.tokens >= 1 {
            Duration::ZERO
        } else {
            let fill_time = (self.capacity as f64 / self.fill_rate) as u64;
            Duration::from_secs(fill_time) - self.last_refill.elapsed()
        }
    }

    /// Refill tokens based on elapsed time.
    fn refill(&mut self) {
        let now = Instant::now();
        let elapsed_time = now.duration_since(self.last_refill).as_secs_f64();
        self.last_refill = now;

        self.tokens = std::cmp::min(
            self.tokens + (elapsed_time * self.fill_rate) as i64,
            self.capacity,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_token_bucket() {
        let fill_interval = Duration::from_secs(10);
        let capacity = 5;
        let bucket = TokenBucket::new(fill_interval, capacity);

        {
            let mut tb = bucket.lock().unwrap();
            assert!(tb.take_available(1));
            assert!(tb.take_available(4));
            assert!(!tb.take_available(1));
        }

        thread::sleep(Duration::from_secs(10));

        {
            let mut tb = bucket.lock().unwrap();
            assert!(tb.take_available(1));
        }
    }
}
