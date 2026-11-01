const MAX_CHAT_MESSAGE_LENGTH = 500;

function createChatMessage(player, text, id) {
  if (
    !player ||
    typeof player.id !== "string" ||
    typeof text !== "string"
  ) {
    return null;
  }

  const messageText = text.trim();
  if (!messageText || messageText.length > MAX_CHAT_MESSAGE_LENGTH) {
    return null;
  }

  const senderName =
    typeof player.name === "string" && player.name.trim()
      ? player.name.trim()
      : "Player";

  return {
    id,
    senderName,
    text: messageText,
  };
}

function deliverChatMessage({
  scope,
  message,
  room,
  emitWorld,
  emitRoom,
}) {
  if (scope === "world") {
    emitWorld(message);
    return true;
  }

  if (scope !== "room" || !room) return false;
  return emitRoom(room, message) !== false;
}

module.exports = {
  createChatMessage,
  deliverChatMessage,
  MAX_CHAT_MESSAGE_LENGTH,
};
