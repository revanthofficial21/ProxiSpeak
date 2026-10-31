// Presence notifications, ported from Naseema's branch onto the current rooms.
const {
  createActivity,
  activityPlayerName,
  getNewProximityEntries,
  ACTIVITY_TYPES,
} = require("../lib/activity");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

const player = { id: "abc12345", name: "Revanth", room: "Open World" };

const joined = createActivity("player-joined", player, "Open World", { id: "n1" });
check(
  "a join produces a notification",
  joined && joined.type === "player-joined" && joined.id === "n1"
);
check(
  "the message names the player and the room",
  joined.message === "Revanth joined Open World"
);
check(
  "the timestamp is an ISO string",
  typeof joined.timestamp === "string" &&
    Number.isFinite(Date.parse(joined.timestamp))
);

check(
  "a leave produces a notification",
  createActivity("player-left", player, "Lounge", { id: "n2" }).message ===
    "Revanth left Lounge"
);

check(
  "proximity uses its own wording",
  createActivity("proximity-enter", player, "Open World", { id: "n3" }).message ===
    "Revanth is now nearby"
);

check(
  "an unknown room is rejected",
  createActivity("player-joined", player, "Focus Space", { id: "n4" }) === null
);

check(
  "an unknown type is rejected",
  createActivity("player-danced", player, "Open World", { id: "n5" }) === null
);

check(
  "a missing player is rejected",
  createActivity("player-joined", null, "Open World", { id: "n6" }) === null
);

check(
  "an invalid timestamp is rejected",
  createActivity("player-joined", player, "Open World", {
    id: "n7",
    timestamp: new Date("nonsense"),
  }) === null
);

check(
  "a nameless player falls back to a short id",
  createActivity("player-joined", { id: "zzzz9999", name: "" }, "Lounge", {
    id: "n8",
  }).playerName === "Player zzzz"
);

check(
  "an over-long name falls back rather than being truncated silently",
  activityPlayerName({ id: "zzzz9999", name: "x".repeat(40) }) === "Player zzzz"
);

check(
  "every advertised type is accepted",
  [...ACTIVITY_TYPES].every((type) =>
    Boolean(createActivity(type, player, "Open World", { id: `t-${type}` }))
  )
);

// --- proximity diff -----------------------------------------------------

check(
  "only newly nearby peers are reported",
  getNewProximityEntries(new Set(["a", "b"]), ["b", "c"]).join(",") === "c"
);

check(
  "everything is new when there was nothing before",
  getNewProximityEntries(null, ["a", "b"]).length === 2
);

check(
  "a repeat sync reports nothing new",
  getNewProximityEntries(["a", "b"], ["a", "b"]).length === 0
);

console.log(
  failures === 0
    ? "All activity tests passed"
    : `${failures} activity test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
