// Pure session logic, pulled out of index.js so it can be tested without a
// socket or a database. index.js still owns the wiring; the decisions live here.

const MAX_NAME_LENGTH = 30;

// Pick a free spawn slot: try progressively tighter grids, then fall back to a
// wrapped position so a very full world still gets somewhere to stand.
function allocateSpawnPosition({
  occupied = [],
  usedCount = 0,
  width,
  height,
  radius,
  spacings = [80, 60, 40],
  margin = radius + 20,
}) {
  const minimumSpacing = radius * 2 + 8;

  for (const spacing of spacings) {
    const columns = Math.floor((width - margin * 2) / spacing) + 1;
    const rows = Math.floor((height - margin * 2) / spacing) + 1;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const position = {
          x: margin + column * spacing,
          y: margin + row * spacing,
        };

        const free = occupied.every(
          (slot) =>
            Math.hypot(position.x - slot.x, position.y - slot.y) >=
            minimumSpacing
        );

        if (free) return position;
      }
    }
  }

  const spanX = Math.max(1, width - margin * 2);
  const spanY = Math.max(1, height - margin * 2);

  return {
    x: margin + (usedCount % spanX),
    y: margin + (Math.floor(usedCount / spanX) % spanY),
  };
}

// Keep a position inside the world, accounting for the avatar's radius.
function clampPosition(x, y, { width, height, radius }) {
  const clampAxis = (value, max) =>
    Number.isFinite(value) ? Math.max(radius, Math.min(max, value)) : radius;

  return {
    x: clampAxis(x, width - radius),
    y: clampAxis(y, height - radius),
  };
}

// Trim and cap a display name; null when there is nothing usable.
function normalizeDisplayName(name, maxLength = MAX_NAME_LENGTH) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim().slice(0, maxLength);
  return trimmed.length === 0 ? null : trimmed;
}

// Who entered and left range between two snapshots of a peer set.
function diffProximity(previous, nextIds) {
  const next = new Set(nextIds);
  const entered = [];
  const left = [];

  for (const id of next) {
    if (!previous.has(id)) entered.push(id);
  }
  for (const id of previous) {
    if (!next.has(id)) left.push(id);
  }

  return { entered, left, next };
}

// Hysteresis: a peer enters at the enter radius, but only leaves once past the
// wider leave radius. Without this, a player hovering at the boundary thrashes
// proximity:enter/leave — creating and tearing down a WebRTC peer each time.
function isWithinProximity({
  distance,
  isAlreadyNearby = false,
  enterRadius,
  leaveRadius = enterRadius,
}) {
  if (!Number.isFinite(distance)) return false;
  return isAlreadyNearby ? distance <= leaveRadius : distance <= enterRadius;
}

module.exports = {
  MAX_NAME_LENGTH,
  allocateSpawnPosition,
  clampPosition,
  normalizeDisplayName,
  diffProximity,
  isWithinProximity,
};
