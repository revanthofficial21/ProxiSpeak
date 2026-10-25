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

module.exports = { createChatMessage, MAX_CHAT_MESSAGE_LENGTH };
