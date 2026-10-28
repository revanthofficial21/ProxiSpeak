// Room layouts, persisted in MongoDB.
//
// The brief's Week-4 item: each room owns its furniture instead of the client
// hard-coding one office. A layout is zones (the labelled areas), furniture (the
// solid pieces that block movement and muffle sound) and plants (decoration only).
//
// The client falls back to its built-in layout if the fetch fails, so a database
// outage degrades to "looks the same as before" rather than an empty world.

const DEFAULT_ZONES = [
  { name: "Open Workspace", x: 40, y: 40, w: 440, h: 290, tint: "#16263c", accent: "#38bdf8" },
  { name: "Meeting Room", x: 560, y: 40, w: 400, h: 250, tint: "#2a2418", accent: "#fbbf24" },
  { name: "Discussion Area", x: 500, y: 330, w: 250, h: 230, tint: "#241f33", accent: "#a78bfa" },
  { name: "Lounge", x: 40, y: 370, w: 420, h: 190, tint: "#152a24", accent: "#34d399" },
  { name: "Game Zone", x: 780, y: 330, w: 180, h: 230, tint: "#2a1a26", accent: "#f472b6" },
];

const DEFAULT_FURNITURE = [
  { kind: "desk", x: 90, y: 110, width: 120, height: 55 },
  { kind: "desk", x: 280, y: 110, width: 120, height: 55 },
  { kind: "desk", x: 90, y: 235, width: 120, height: 55 },
  { kind: "desk", x: 280, y: 235, width: 120, height: 55 },
  { kind: "table", x: 610, y: 120, width: 300, height: 110 },
  { kind: "table", x: 570, y: 400, width: 110, height: 110 },
  { kind: "table", x: 810, y: 395, width: 120, height: 100 },
  { kind: "sofa", x: 80, y: 400, width: 150, height: 42 },
  { kind: "sofa", x: 80, y: 495, width: 150, height: 42 },
];

const DEFAULT_PLANTS = [
  { x: 62, y: 62 },
  { x: 456, y: 62 },
  { x: 938, y: 62 },
  { x: 62, y: 538 },
  { x: 938, y: 538 },
];

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const FURNITURE_KINDS = new Set(["desk", "table", "sofa"]);

function buildDefaultLayout(roomId) {
  return {
    roomId,
    zones: DEFAULT_ZONES,
    furniture: DEFAULT_FURNITURE,
    plants: DEFAULT_PLANTS,
  };
}

function isBox(value) {
  return (
    value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

// Anything read from the database is untrusted: drop malformed pieces rather than
// letting a bad document produce an unplayable room.
function normalizeLayout(document, roomId) {
  if (!document || typeof document !== "object") {
    return buildDefaultLayout(roomId);
  }

  const zones = Array.isArray(document.zones)
    ? document.zones.filter(
        (zone) =>
          zone &&
          typeof zone.name === "string" &&
          Number.isFinite(zone.x) &&
          Number.isFinite(zone.y) &&
          Number.isFinite(zone.w) &&
          Number.isFinite(zone.h)
      )
    : [];

  const furniture = Array.isArray(document.furniture)
    ? document.furniture.filter(
        (piece) => isBox(piece) && FURNITURE_KINDS.has(piece.kind)
      )
    : [];

  const plants = Array.isArray(document.plants)
    ? document.plants.filter(
        (plant) => plant && Number.isFinite(plant.x) && Number.isFinite(plant.y)
      )
    : [];

  // A layout with no furniture would make every room silent-proof and empty; fall
  // back rather than serve something clearly broken.
  if (furniture.length === 0) {
    return buildDefaultLayout(roomId);
  }

  return {
    roomId,
    zones: zones.length > 0 ? zones : DEFAULT_ZONES,
    furniture,
    plants,
  };
}

async function initializeLayouts(db, roomIds) {
  const collection = db.collection("rooms");

  await collection.bulkWrite(
    roomIds.map((roomId) => ({
      updateOne: {
        filter: { _id: roomId },
        update: { $setOnInsert: { layout: buildDefaultLayout(roomId) } },
        upsert: true,
      },
    }))
  );
}

async function getLayout(db, roomId) {
  const room = await db.collection("rooms").findOne({ _id: roomId });
  return normalizeLayout(room?.layout, roomId);
}

module.exports = {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  FURNITURE_KINDS,
  buildDefaultLayout,
  normalizeLayout,
  initializeLayouts,
  getLayout,
};
