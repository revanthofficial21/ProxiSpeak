const { normalizeRoomName } = require("./rooms");

const ACTIVITY_TYPES = new Set([
  "player-joined",
  "player-left",
  "proximity-enter",
]);

function getActivityPlayerName(player) {
  if (!player || typeof player.id !== "string" || !player.id.trim()) {
    return null;
  }
  if (
    typeof player.name === "string" &&
    player.name.trim() &&
    player.name.trim().length <= 30
  ) {
    return player.name.trim();
  }
  return `Player ${player.id.slice(0, 4)}`;
}

function createActivityNotification(
  type,
  player,
  room,
  id,
  timestamp = new Date()
) {
  const playerName = getActivityPlayerName(player);
  const validRoom = normalizeRoomName(room);
  if (
    !ACTIVITY_TYPES.has(type) ||
    !playerName ||
    !validRoom ||
    typeof id !== "string" ||
    !id ||
    !(timestamp instanceof Date) ||
    !Number.isFinite(timestamp.getTime())
  ) {
    return null;
  }

  let message;
  if (type === "player-joined") message = `${playerName} joined ${validRoom}`;
  if (type === "player-left") message = `${playerName} left ${validRoom}`;
  if (type === "proximity-enter") message = `${playerName} is now nearby`;

  return {
    id,
    type,
    playerName,
    room: validRoom,
    message,
    timestamp: timestamp.toISOString(),
  };
}

function createRoomSwitchNotification(
  player,
  fromRoom,
  toRoom,
  id,
  timestamp = new Date()
) {
  const playerName = getActivityPlayerName(player);
  const validFromRoom = normalizeRoomName(fromRoom);
  const validToRoom = normalizeRoomName(toRoom);
  if (
    !playerName ||
    !validFromRoom ||
    !validToRoom ||
    validFromRoom === validToRoom ||
    typeof id !== "string" ||
    !id ||
    !(timestamp instanceof Date) ||
    !Number.isFinite(timestamp.getTime())
  ) {
    return null;
  }

  return {
    id,
    type: "room-switch",
    playerName,
    room: validToRoom,
    fromRoom: validFromRoom,
    toRoom: validToRoom,
    message: `${playerName} moved from ${validFromRoom} to ${validToRoom}`,
    timestamp: timestamp.toISOString(),
  };
}

function getNewProximityEntries(previousNearby, currentNearby) {
  const previous = previousNearby instanceof Set
    ? previousNearby
    : new Set(previousNearby || []);
  return Array.from(currentNearby).filter((playerId) => !previous.has(playerId));
}

function isCurrentPlayerSession(players, socketId, player) {
  return Boolean(
    typeof socketId === "string" &&
      player &&
      player.id === socketId &&
      player.socketId === socketId &&
      players.get(socketId) === player
  );
}

module.exports = {
  createActivityNotification,
  createRoomSwitchNotification,
  getNewProximityEntries,
  isCurrentPlayerSession,
};
