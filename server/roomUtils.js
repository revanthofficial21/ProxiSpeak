const { randomUUID } = require("node:crypto");

const DEFAULT_ROOM_ID = "open-world";

function getRoomChannel(roomId) {
  return `room:${roomId}`;
}

function isRoomAvailable(roomId, rooms) {
  return (
    typeof roomId === "string" &&
    Array.isArray(rooms) &&
    rooms.some((room) => room.id === roomId)
  );
}

function getPlayersInRoom(players, roomId) {
  return Array.from(players.values()).filter(
    (player) => player.roomId === roomId
  );
}

function areInSameRoom(players, firstId, secondId) {
  const firstPlayer = players.get(firstId);
  const secondPlayer = players.get(secondId);
  return Boolean(
    firstPlayer &&
      secondPlayer &&
      firstPlayer.roomId === secondPlayer.roomId
  );
}

function emitToRoom(io, roomId, event, payload) {
  io.to(getRoomChannel(roomId)).emit(event, payload);
}

function emitRoomPresence(io, roomId, player, action, senderSocket) {
  const destination = senderSocket
    ? senderSocket.to(getRoomChannel(roomId))
    : io.to(getRoomChannel(roomId));
  const displayName =
    typeof player.name === "string" && player.name.trim()
      ? player.name.trim()
      : `Player ${player.id.slice(0, 4)}`;

  destination.emit("room:presence", {
    eventId: randomUUID(),
    roomId,
    playerId: player.id,
    displayName,
    action,
  });
}

function emitPlayerLeft(io, player) {
  const roomId = player.roomId || DEFAULT_ROOM_ID;
  emitToRoom(io, roomId, "player:left", player.id);
  emitRoomPresence(io, roomId, player, "left");
}

module.exports = {
  DEFAULT_ROOM_ID,
  getRoomChannel,
  isRoomAvailable,
  getPlayersInRoom,
  areInSameRoom,
  emitToRoom,
  emitRoomPresence,
  emitPlayerLeft,
};
