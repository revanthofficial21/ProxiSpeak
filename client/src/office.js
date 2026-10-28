// The built-in office layout — the fallback used before the server's persisted
// layout arrives, and if that request fails.
//
// The renderer, the movement collision check and the audio occlusion test all read
// this same shape, so a room always behaves consistently even when the data comes
// from two different places.

export const DEFAULT_LAYOUT = {
  zones: [
    { name: "Open Workspace", x: 40, y: 40, w: 440, h: 290, tint: "#16263c", accent: "#38bdf8" },
    { name: "Meeting Room", x: 560, y: 40, w: 400, h: 250, tint: "#2a2418", accent: "#fbbf24" },
    { name: "Discussion Area", x: 500, y: 330, w: 250, h: 230, tint: "#241f33", accent: "#a78bfa" },
    { name: "Lounge", x: 40, y: 370, w: 420, h: 190, tint: "#152a24", accent: "#34d399" },
    { name: "Game Zone", x: 780, y: 330, w: 180, h: 230, tint: "#2a1a26", accent: "#f472b6" },
  ],
  furniture: [
    { kind: "desk", x: 90, y: 110, width: 120, height: 55 },
    { kind: "desk", x: 280, y: 110, width: 120, height: 55 },
    { kind: "desk", x: 90, y: 235, width: 120, height: 55 },
    { kind: "desk", x: 280, y: 235, width: 120, height: 55 },
    { kind: "meeting-table", x: 610, y: 120, width: 300, height: 110 },
    { kind: "discussion-table", x: 570, y: 400, width: 110, height: 110 },
    { kind: "game-table", x: 810, y: 395, width: 120, height: 100 },
    { kind: "sofa", x: 80, y: 400, width: 150, height: 42 },
    { kind: "sofa", x: 80, y: 495, width: 150, height: 42 },
  ],
  plants: [
    { x: 62, y: 62 },
    { x: 456, y: 62 },
    { x: 938, y: 62 },
    { x: 62, y: 538 },
    { x: 938, y: 538 },
  ],
};

// Each accessor falls back per field, so a layout missing only its plants still
// contributes its furniture.
export function zonesOf(layout) {
  const zones = layout?.zones;
  return Array.isArray(zones) && zones.length > 0 ? zones : DEFAULT_LAYOUT.zones;
}

export function furnitureOf(layout) {
  const furniture = layout?.furniture;
  return Array.isArray(furniture) && furniture.length > 0
    ? furniture
    : DEFAULT_LAYOUT.furniture;
}

export function plantsOf(layout) {
  const plants = layout?.plants;
  return Array.isArray(plants) ? plants : DEFAULT_LAYOUT.plants;
}
