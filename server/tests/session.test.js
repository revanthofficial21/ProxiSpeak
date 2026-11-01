const {
  MAX_NAME_LENGTH,
  allocateSpawnPosition,
  clampPosition,
  normalizeDisplayName,
  diffProximity,
  isWithinProximity,
} = require("../lib/session");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

const world = { width: 1000, height: 600, radius: 20 };

// --- spawn -------------------------------------------------------------

const first = allocateSpawnPosition({ occupied: [], usedCount: 0, ...world });
check(
  "first spawn sits at the margin",
  first.x === 40 && first.y === 40
);

check(
  "spawn stays inside the world",
  first.x >= world.radius &&
    first.x <= world.width - world.radius &&
    first.y >= world.radius &&
    first.y <= world.height - world.radius
);

const second = allocateSpawnPosition({
  occupied: [first],
  usedCount: 1,
  ...world,
});
check(
  "second spawn avoids the first",
  Math.hypot(second.x - first.x, second.y - first.y) >= world.radius * 2 + 8
);

// Fill the 80px grid of a small world, then confirm the grid tightens.
const small = { width: 300, height: 200, radius: 20 };
const margin = small.radius + 20;
const occupied80 = [];
for (let row = 0; row * 80 + margin <= small.height - margin; row += 1) {
  for (let col = 0; col * 80 + margin <= small.width - margin; col += 1) {
    occupied80.push({ x: margin + col * 80, y: margin + row * 80 });
  }
}
const tightened = allocateSpawnPosition({
  occupied: occupied80,
  usedCount: occupied80.length,
  ...small,
});
check(
  "spawn tightens the grid when the wide one is full",
  !occupied80.some((slot) => slot.x === tightened.x && slot.y === tightened.y)
);

const tiny = { width: 100, height: 100, radius: 20 };
const fallback = allocateSpawnPosition({
  occupied: [{ x: 40, y: 40 }],
  usedCount: 3,
  ...tiny,
});
check(
  "spawn falls back to a wrapped position when nothing fits",
  Number.isFinite(fallback.x) &&
    Number.isFinite(fallback.y) &&
    fallback.x >= tiny.radius &&
    fallback.y >= tiny.radius
);

// --- clamp -------------------------------------------------------------

check(
  "clamp keeps positions inside the world",
  (() => {
    const clamped = clampPosition(-500, 9999, world);
    return clamped.x === world.radius && clamped.y === world.height - world.radius;
  })()
);

check(
  "clamp leaves valid positions alone",
  (() => {
    const clamped = clampPosition(500, 300, world);
    return clamped.x === 500 && clamped.y === 300;
  })()
);

check(
  "clamp turns non-finite input into a safe value",
  (() => {
    const clamped = clampPosition(Number.NaN, Number.POSITIVE_INFINITY, world);
    return Number.isFinite(clamped.x) && Number.isFinite(clamped.y);
  })()
);

// --- names -------------------------------------------------------------

check("names are trimmed", normalizeDisplayName("  Revanth  ") === "Revanth");
check(
  "blank names are rejected",
  normalizeDisplayName("   ") === null && normalizeDisplayName("") === null
);
check("non-strings are rejected", normalizeDisplayName(null) === null && normalizeDisplayName(42) === null);
check(
  "names are capped at the maximum length",
  normalizeDisplayName("x".repeat(200)).length === MAX_NAME_LENGTH
);

// --- proximity diff ----------------------------------------------------

const previous = new Set(["a", "b"]);
const { entered, left, next } = diffProximity(previous, ["b", "c"]);
check(
  "diff reports who entered",
  entered.length === 1 && entered[0] === "c"
);
check("diff reports who left", left.length === 1 && left[0] === "a");
check("diff returns the new set", next.has("b") && next.has("c") && !next.has("a"));

const empty = diffProximity(new Set(), ["a", "b"]);
check(
  "diff from empty reports everyone as entered",
  empty.entered.length === 2 && empty.left.length === 0
);

const noChange = diffProximity(new Set(["a"]), ["a"]);
check(
  "diff with no change reports nothing",
  noChange.entered.length === 0 && noChange.left.length === 0
);

// --- proximity hysteresis ---------------------------------------------

const radii = { enterRadius: 100, leaveRadius: 115 };

check(
  "enters inside the enter radius",
  isWithinProximity({ distance: 99, ...radii }) === true
);
check(
  "does not enter outside the enter radius",
  isWithinProximity({ distance: 101, ...radii }) === false
);
check(
  "enters exactly on the enter radius",
  isWithinProximity({ distance: 100, ...radii }) === true
);
check(
  "stays connected while already nearby and inside the leave radius",
  isWithinProximity({ distance: 110, isAlreadyNearby: true, ...radii }) === true
);
check(
  "drops out past the leave radius",
  isWithinProximity({ distance: 116, isAlreadyNearby: true, ...radii }) === false
);
check(
  "a distant peer inside the leave radius does not newly enter",
  isWithinProximity({ distance: 110, ...radii }) === false
);
check(
  "non-finite distance is never nearby",
  isWithinProximity({ distance: Number.NaN, ...radii }) === false
);

// --- spawn spreading ---------------------------------------------------

const spawnWorld = { width: 1000, height: 600, radius: 20, margin: 40 };

const firstFree = allocateSpawnPosition(spawnWorld);
check(
  "the default pick is deterministic and takes the first slot",
  firstFree.x === 40 && firstFree.y === 40
);

const lastSlot = allocateSpawnPosition({
  ...spawnWorld,
  pick: (slots) => slots[slots.length - 1],
});
check(
  "a custom pick is honoured so arrivals can spread out",
  lastSlot.x !== firstFree.x || lastSlot.y !== firstFree.y
);

const desk = { x: 0, y: 0, width: 200, height: 200 };
const clearOfDesk = allocateSpawnPosition({ ...spawnWorld, obstacles: [desk] });
check(
  "no spawn lands inside furniture",
  !(
    clearOfDesk.x > desk.x - 20 &&
    clearOfDesk.x < desk.x + desk.width + 20 &&
    clearOfDesk.y > desk.y - 20 &&
    clearOfDesk.y < desk.y + desk.height + 20
  )
);

const crowded = allocateSpawnPosition({
  ...spawnWorld,
  occupied: [{ x: 40, y: 40 }],
});
check("an occupied slot is skipped", crowded.x !== 40 || crowded.y !== 40);

console.log(
  failures === 0
    ? "All session tests passed"
    : `${failures} session test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
