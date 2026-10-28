// Layouts read from the database are untrusted, so the normaliser has to be strict.
const {
  buildDefaultLayout,
  normalizeLayout,
  isLayoutStale,
  FURNITURE_KINDS,
} = require("../lib/layouts");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

const fallback = buildDefaultLayout("open-world");

check(
  "the default layout has zones, furniture and plants",
  fallback.zones.length === 5 &&
    fallback.furniture.length === 9 &&
    fallback.plants.length === 5
);

check(
  "every default piece is a valid box of a known kind",
  fallback.furniture.every(
    (piece) =>
      FURNITURE_KINDS.has(piece.kind) &&
      piece.width > 0 &&
      piece.height > 0
  )
);

check(
  "a missing document falls back to the default",
  normalizeLayout(null, "lounge").furniture.length === 9
);

check(
  "a non-object document falls back to the default",
  normalizeLayout("nonsense", "lounge").furniture.length === 9
);

check(
  "the roomId is always taken from the request, not the document",
  normalizeLayout({ roomId: "spoofed", furniture: [] }, "meeting-room").roomId ===
    "meeting-room"
);

const withJunk = normalizeLayout(
  {
    zones: [{ name: "Real", x: 0, y: 0, w: 10, h: 10 }, { name: 42 }],
    furniture: [
      { kind: "desk", x: 10, y: 10, width: 50, height: 20 },
      { kind: "lava", x: 10, y: 10, width: 50, height: 20 },
      { kind: "desk", x: "far", y: 10, width: 50, height: 20 },
      { kind: "desk", x: 10, y: 10, width: 0, height: 20 },
      null,
    ],
    plants: [{ x: 5, y: 5 }, { x: "nope" }],
  },
  "lounge"
);

check(
  "malformed furniture is dropped, valid pieces kept",
  withJunk.furniture.length === 1 && withJunk.furniture[0].kind === "desk"
);

check("malformed zones are dropped", withJunk.zones.length === 1);
check("malformed plants are dropped", withJunk.plants.length === 1);

const empty = normalizeLayout({ furniture: [] }, "lounge");
check(
  "an empty layout falls back rather than serving a room with nothing in it",
  empty.furniture.length === 9
);

check(
  "a layout with no zones still gets the default zones",
  normalizeLayout(
    { furniture: [{ kind: "desk", x: 1, y: 1, width: 10, height: 10 }] },
    "lounge"
  ).zones.length === 5
);

check(
  "unknown kinds never reach the client",
  normalizeLayout(
    {
      furniture: [
        { kind: "desk", x: 1, y: 1, width: 10, height: 10 },
        { kind: "volcano", x: 1, y: 1, width: 10, height: 10 },
      ],
    },
    "lounge"
  ).furniture.length === 1
);

// --- upgrade repair ----------------------------------------------------

check(
  "a freshly built layout is not stale",
  isLayoutStale(buildDefaultLayout("open-world")) === false
);

check(
  "a layout using a retired kind is stale",
  isLayoutStale({
    furniture: [{ kind: "table", x: 1, y: 1, width: 10, height: 10 }],
  }) === true
);

check(
  "a layout with no furniture is stale",
  isLayoutStale({ furniture: [] }) === true &&
    isLayoutStale(null) === true
);

check(
  "a layout with every current kind is fine",
  isLayoutStale({
    furniture: [
      { kind: "desk", x: 1, y: 1, width: 10, height: 10 },
      { kind: "meeting-table", x: 1, y: 1, width: 10, height: 10 },
      { kind: "sofa", x: 1, y: 1, width: 10, height: 10 },
    ],
  }) === false
);

console.log(
  failures === 0
    ? "All layout tests passed"
    : `${failures} layout test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
