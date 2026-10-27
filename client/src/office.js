// The office layout, shared by everything that needs to agree on it: the canvas
// renderer, the movement collision check, and the audio occlusion test.

// Named areas, drawn as tinted panels with labels.
export const ZONES = [
  { name: "Open Workspace", x: 40, y: 40, w: 440, h: 290, tint: "#16263c", accent: "#38bdf8" },
  { name: "Meeting Room", x: 560, y: 40, w: 400, h: 250, tint: "#2a2418", accent: "#fbbf24" },
  { name: "Discussion Area", x: 500, y: 330, w: 250, h: 230, tint: "#241f33", accent: "#a78bfa" },
  { name: "Lounge", x: 40, y: 370, w: 420, h: 190, tint: "#152a24", accent: "#34d399" },
  { name: "Game Zone", x: 780, y: 330, w: 180, h: 230, tint: "#2a1a26", accent: "#f472b6" },
];

export const desks = [
  { x: 90, y: 110, width: 120, height: 55 },
  { x: 280, y: 110, width: 120, height: 55 },
  { x: 90, y: 235, width: 120, height: 55 },
  { x: 280, y: 235, width: 120, height: 55 },
];

export const meetingTable = { x: 610, y: 120, width: 300, height: 110 };
export const discussionTable = { x: 570, y: 400, width: 110, height: 110 };
export const gameTable = { x: 810, y: 395, width: 120, height: 100 };

export const sofas = [
  { x: 80, y: 400, width: 150, height: 42 },
  { x: 80, y: 495, width: 150, height: 42 },
];

export const plants = [
  { x: 62, y: 62 },
  { x: 456, y: 62 },
  { x: 938, y: 62 },
  { x: 62, y: 538 },
  { x: 938, y: 538 },
];

// Solid things the avatar cannot walk through — and that block sound.
export const obstacles = [
  ...desks,
  meetingTable,
  discussionTable,
  gameTable,
  ...sofas,
];
