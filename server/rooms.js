const ROOM_NAMES = ["Lounge", "Meeting Room", "Focus Space"];
const DEFAULT_ROOM = ROOM_NAMES[0];
const { getNearbyPlayers } = require("./proximity");

function normalizeRoomName(roomName) {
  return ROOM_NAMES.includes(roomName) ? roomName : null;
}

function roomChannel(roomName) {
  const validRoomName = normalizeRoomName(roomName);
  return validRoomName ? `space:${validRoomName}` : null;
}

function getPlayersInRoom(players, roomName) {
  return Array.from(players.values()).filter(
    (player) => player.room === roomName
  );
}

function arePlayersInSameRoom(playerA, playerB) {
  return Boolean(
    playerA &&
      playerB &&
      normalizeRoomName(playerA.room) &&
      playerA.room === playerB.room
  );
}

function getNearbyPlayersInRoom(players, targetPlayer, radius) {
  if (!normalizeRoomName(targetPlayer?.room)) return [];

  return getNearbyPlayers(
    Array.from(players.values()).filter((player) =>
      arePlayersInSameRoom(targetPlayer, player)
    ),
    targetPlayer,
    radius
  );
}

module.exports = {
  ROOM_NAMES,
  DEFAULT_ROOM,
  normalizeRoomName,
  roomChannel,
  getPlayersInRoom,
  arePlayersInSameRoom,
  getNearbyPlayersInRoom,
};
