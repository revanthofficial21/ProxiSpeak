const { createRateLimiter } = require("../lib/rate-limit");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

const t0 = 1_000_000;
const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1 });

check(
  "allows up to the capacity in one burst",
  [0, 1, 2].every((offset) => limiter.take("alice", t0 + offset))
);

check(
  "rejects once the bucket is empty",
  limiter.take("alice", t0 + 3) === false
);

check(
  "a rejected call does not go into debt",
  limiter.take("alice", t0 + 3) === false
);

check("keys are independent", limiter.take("bob", t0 + 3) === true);

check(
  "refills over time",
  (() => {
    const fresh = createRateLimiter({ capacity: 2, refillPerSecond: 1 });
    const start = 5_000_000;
    fresh.take("k", start);
    fresh.take("k", start);
    const empty = fresh.take("k", start) === false;
    // One second later exactly one token is available, and only one.
    const afterOneSecond = fresh.take("k", start + 1000) === true;
    const immediatelyAfter = fresh.take("k", start + 1000) === false;
    return empty && afterOneSecond && immediatelyAfter;
  })()
);

check(
  "refill is capped at the capacity",
  (() => {
    const fresh = createRateLimiter({ capacity: 2, refillPerSecond: 10 });
    const start = 2_000_000;
    fresh.take("k", start);
    fresh.take("k", start);
    // A very long wait must not bank more than the capacity.
    const afterLongWait = [
      fresh.take("k", start + 100_000),
      fresh.take("k", start + 100_000),
      fresh.take("k", start + 100_000),
    ];
    return (
      afterLongWait[0] === true &&
      afterLongWait[1] === true &&
      afterLongWait[2] === false
    );
  })()
);

check(
  "forget clears a key's bucket",
  (() => {
    const fresh = createRateLimiter({ capacity: 1, refillPerSecond: 1 });
    const start = 3_000_000;
    fresh.take("gone", start);
    const blocked = fresh.take("gone", start) === false;
    fresh.forget("gone");
    const allowedAgain = fresh.take("gone", start) === true;
    return blocked && allowedAgain && fresh.size() === 1;
  })()
);

check(
  "rejects invalid configuration",
  (() => {
    let threwCapacity = false;
    let threwRefill = false;
    try {
      createRateLimiter({ capacity: 0, refillPerSecond: 1 });
    } catch (error) {
      threwCapacity = true;
    }
    try {
      createRateLimiter({ capacity: 1, refillPerSecond: 0 });
    } catch (error) {
      threwRefill = true;
    }
    return threwCapacity && threwRefill;
  })()
);

console.log(
  failures === 0
    ? "All rate limit tests passed"
    : `${failures} rate limit test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
