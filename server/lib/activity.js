// Presence notifications: who joined, who left, who came into earshot.
//
// Ported from Naseema's branch onto the current room model. Everything is
// validated here rather than trusted; anything malformed returns null and the
// caller simply does not emit it.
const { randomUUID } = require("crypto");
const { normalizeRoomName } = require("./rooms");

const ACTIVITY_TYPES = new Set([
  "player-joined",
  "player-left",
  "proximity-enter",
]);

const MAX_NAME_LENGTH = 30;
const MAX_MESSAGE_LENGTH = 200;

function activityPlayerName(player) {
  if (!player || typeof player.id !== "string" || !player.id.trim()) {
    return null;
  }

  const name = typeof player.name === "string" ? player.name.trim() : "";
  if (name && name.length <= MAX_NAME_LENGTH) return name;

  return `Player ${player.id.slice(0, 4)}`;
}

function activityMessage(type, playerName, room) {
  if (type === "player-joined") return `${playerName} joined ${room}`;
  if (type === "player-left") return `${playerName} left ${room}`;
  if (type === "proximity-enter") return `${playerName} is now nearby`;
  return null;
}

function createActivity(
  type,
  player,
  room,
  { id = randomUUID(), timestamp = new Date() } = {}
) {
  const playerName = activityPlayerName(player);
  const validRoom = normalizeRoomName(room);
  const message = playerName && validRoom
    ? activityMessage(type, playerName, validRoom)
    : null;

  if (
    !ACTIVITY_TYPES.has(type) ||
    !playerName ||
    !validRoom ||
    !message ||
    message.length > MAX_MESSAGE_LENGTH ||
    typeof id !== "string" ||
    !id ||
    !(timestamp instanceof Date) ||
    !Number.isFinite(timestamp.getTime())
  ) {
    return null;
  }

  return {
    id,
    type,
    playerName,
    room: validRoom,
    message,
    timestamp: timestamp.toISOString(),
  };
}

// Only the peers that just entered range, so a re-sync does not repeat the ones
// that were already nearby.
function getNewProximityEntries(previousNearby, currentNearby) {
  const previous =
    previousNearby instanceof Set
      ? previousNearby
      : new Set(previousNearby || []);

  return Array.from(currentNearby || []).filter(
    (playerId) => !previous.has(playerId)
  );
}

module.exports = {
  ACTIVITY_TYPES,
  MAX_MESSAGE_LENGTH,
  activityPlayerName,
  createActivity,
  getNewProximityEntries,
};
