// Spatial Audit — proves the geospatial proximity layer is correct and fast.
//
// Seeds a collection of synthetic players across the 1000x600 world, then runs
// many $near queries and checks two things for each:
//   1. correctness  — the $near result equals a brute-force distance filter
//   2. performance  — the DATABASE executes the query well under the 20ms budget
//                     (measured with explain(executionStats), so the network
//                     round-trip to the DB host is reported but not counted)
//
// Uses MONGODB_URI when set; otherwise falls back to an in-memory MongoDB so
// the audit can run anywhere (needs the optional 'mongodb-memory-server' dep).
//
//   node audit.js
//
require("dotenv").config();
const { MongoClient } = require("mongodb");

const RADIUS = 100;
const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const WORLD_MAX = Math.max(WORLD_WIDTH, WORLD_HEIGHT);
const PLAYER_COUNT = 250;
const QUERY_COUNT = 200;
const BUDGET_MS = 20;
const COLLECTION = "audit_players";

// Small seeded PRNG so the audit is reproducible.
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[index];
}

async function connect() {
  if (process.env.MONGODB_URI) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    return { client, stop: async () => client.close() };
  }

  const { MongoMemoryServer } = require("mongodb-memory-server");
  const memory = await MongoMemoryServer.create();
  const client = new MongoClient(memory.getUri());
  await client.connect();
  return {
    client,
    stop: async () => {
      await client.close();
      await memory.stop();
    },
  };
}

async function main() {
  const { client, stop } = await connect();
  const collection = client.db("proxispeak").collection(COLLECTION);

  try {
    await collection.deleteMany({});

    // 1. Seed players at spread-out coordinates.
    const rng = makeRng(20261022);
    const players = [];
    for (let i = 0; i < PLAYER_COUNT; i += 1) {
      const x = Math.round(rng() * WORLD_WIDTH);
      const y = Math.round(rng() * WORLD_HEIGHT);
      players.push({
        id: `p${i}`,
        x,
        y,
        location: [x, y],
        connected: true,
      });
    }
    await collection.insertMany(players);

    // 2. The same 2d index the server creates at startup.
    await collection.createIndex({ location: "2d" }, { min: 0, max: WORLD_MAX });

    // 3. Run queries and measure.
    // `timings` is the wall-clock round-trip (includes the network to the DB
    // host). `serverTimings` is the database's own execution time, which is
    // what the 20ms budget is actually about.
    const timings = [];
    const serverTimings = [];
    let mismatches = 0;

    for (let i = 0; i < QUERY_COUNT; i += 1) {
      const ox = Math.round(rng() * WORLD_WIDTH);
      const oy = Math.round(rng() * WORLD_HEIGHT);

      const started = performance.now();
      const found = await collection
        .find({
          connected: true,
          location: { $near: [ox, oy], $maxDistance: RADIUS },
        })
        .project({ _id: 0, id: 1 })
        .toArray();
      timings.push(performance.now() - started);

      // Server-side execution time — excludes the network round-trip.
      const explained = await collection
        .find({
          connected: true,
          location: { $near: [ox, oy], $maxDistance: RADIUS },
        })
        .project({ _id: 0, id: 1 })
        .explain("executionStats");
      serverTimings.push(explained.executionStats.executionTimeMillis);

      // Brute-force expectation.
      const expected = players
        .filter(
          (p) => Math.hypot(p.x - ox, p.y - oy) <= RADIUS
        )
        .map((p) => p.id)
        .sort();
      const got = found.map((p) => p.id).sort();

      if (expected.length !== got.length) {
        mismatches += 1;
      } else {
        for (let k = 0; k < expected.length; k += 1) {
          if (expected[k] !== got[k]) {
            mismatches += 1;
            break;
          }
        }
      }
    }

    const sorted = [...timings].sort((a, b) => a - b);
    const avg = timings.reduce((sum, t) => sum + t, 0) / timings.length;
    const max = sorted[sorted.length - 1];

    const serverSorted = [...serverTimings].sort((a, b) => a - b);
    const serverAvg =
      serverTimings.reduce((sum, t) => sum + t, 0) / serverTimings.length;
    const serverMax = serverSorted[serverSorted.length - 1];

    const correct = mismatches === 0;
    const withinBudget = serverMax < BUDGET_MS;

    console.log("=== ProxiSpeak Spatial Audit ===");
    console.log(`players seeded : ${PLAYER_COUNT}`);
    console.log(`queries run    : ${QUERY_COUNT}`);
    console.log(`radius         : ${RADIUS}px`);
    console.log("");
    console.log(
      `correctness    : ${QUERY_COUNT - mismatches}/${QUERY_COUNT} matched the brute-force set ${correct ? "PASS" : "FAIL"}`
    );
    console.log(
      `server query   : min ${serverSorted[0].toFixed(2)}  avg ${serverAvg.toFixed(2)}  ` +
        `p50 ${percentile(serverSorted, 50).toFixed(2)}  ` +
        `p95 ${percentile(serverSorted, 95).toFixed(2)}  max ${serverMax.toFixed(2)}  (ms, DB execution)`
    );
    console.log(
      `round-trip     : min ${sorted[0].toFixed(2)}  avg ${avg.toFixed(2)}  ` +
        `p50 ${percentile(sorted, 50).toFixed(2)}  ` +
        `p95 ${percentile(sorted, 95).toFixed(2)}  max ${max.toFixed(2)}  (ms, incl. network to DB host)`
    );
    console.log(
      `budget         : ${BUDGET_MS}ms on server query time  ->  ${withinBudget ? "PASS" : "FAIL"}`
    );
    console.log("");
    console.log(
      correct && withinBudget
        ? "RESULT: PASS"
        : "RESULT: FAIL"
    );

    if (!correct || !withinBudget) {
      process.exitCode = 1;
    }
  } finally {
    await stop();
  }
}

main().catch((error) => {
  console.error("Audit failed:", error.message);
  process.exitCode = 1;
});
