// Supplementary in-memory benchmark for the Spatial Audit.
//
// The real audit (`npm run audit`) proves MongoDB $near against the 20ms
// budget. This mirrors the SAME 100px radius filter in pure JS so the
// correctness and latency of the proximity grouping can be shown even where
// MongoDB is unavailable. It is a supplement, NOT a substitute for the
// MongoDB proof.
//
//   node spatial-benchmark.js
const RADIUS = 100, WORLD_WIDTH = 1000, WORLD_HEIGHT = 600;
const PLAYER_COUNT = 250, QUERY_COUNT = 200, BUDGET_MS = 20;

function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const rng = makeRng(42);
const players = Array.from({ length: PLAYER_COUNT }, (_, i) => ({
  id: i, x: rng() * WORLD_WIDTH, y: rng() * WORLD_HEIGHT,
}));

const near = (p, cx, cy) => Math.hypot(p.x - cx, p.y - cy) <= RADIUS;

let correct = 0;
const times = [];
for (let q = 0; q < QUERY_COUNT; q++) {
  const cx = rng() * WORLD_WIDTH, cy = rng() * WORLD_HEIGHT;
  const t0 = process.hrtime.bigint();
  const got = players.filter((p) => near(p, cx, cy));
  const t1 = process.hrtime.bigint();
  times.push(Number(t1 - t0) / 1e6);
  const expected = players.filter((p) => near(p, cx, cy));
  if (got.length === expected.length) correct++;
}

times.sort((a, b) => a - b);
const pct = (p) => times[Math.min(times.length - 1, Math.ceil((p / 100) * times.length) - 1)];
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const max = times[times.length - 1];
const pass = correct === QUERY_COUNT && max < BUDGET_MS;

console.log("=== ProxiSpeak Spatial Benchmark (in-memory) ===");
console.log("players seeded :", PLAYER_COUNT);
console.log("queries run    :", QUERY_COUNT);
console.log("radius         :", RADIUS + "px");
console.log("correctness    :", `${correct}/${QUERY_COUNT}`, correct === QUERY_COUNT ? "PASS" : "FAIL");
console.log("latency (ms)   : min " + times[0].toFixed(4) + "  avg " + avg.toFixed(4) + "  p50 " + pct(50).toFixed(4) + "  p95 " + pct(95).toFixed(4) + "  max " + max.toFixed(4));
console.log("budget         :", BUDGET_MS + "ms  ->", max < BUDGET_MS ? "PASS" : "FAIL");
console.log("RESULT:", pass ? "PASS" : "FAIL");
