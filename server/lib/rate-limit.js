// A tiny in-memory token bucket, one bucket per key.
//
// Each key starts with `capacity` tokens, refilled at `refillPerSecond`. Every
// `take` costs one token; once the bucket is empty the call is rejected until
// tokens accrue again. This is enough to stop a single client flooding a
// socket, without needing Redis or a dependency.
function createRateLimiter({ capacity, refillPerSecond }) {
  if (!(capacity > 0)) {
    throw new Error("capacity must be a positive number");
  }
  if (!(refillPerSecond > 0)) {
    throw new Error("refillPerSecond must be a positive number");
  }

  const buckets = new Map();

  function take(key, now = Date.now()) {
    let bucket = buckets.get(key);

    if (!bucket) {
      bucket = { tokens: capacity, updatedAt: now };
    } else {
      const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
      bucket.tokens = Math.min(
        capacity,
        bucket.tokens + elapsedSeconds * refillPerSecond
      );
      bucket.updatedAt = now;
    }

    if (bucket.tokens < 1) {
      buckets.set(key, bucket);
      return false;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return true;
  }

  function forget(key) {
    buckets.delete(key);
  }

  function size() {
    return buckets.size;
  }

  return { take, forget, size };
}

module.exports = { createRateLimiter };
