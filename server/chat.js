const { randomUUID } = require("node:crypto");
const { emitToRoom } = require("./roomUtils");

const MAX_CHAT_MESSAGE_LENGTH = 500;
const CHAT_HISTORY_LIMIT = 100;
const CLIENT_MESSAGE_ID_MAX_LENGTH = 100;
const DEFAULT_AVATAR_COLOR = "#6ee7b7";

function validateChatText(messageText) {
  if (typeof messageText !== "string") {
    return { success: false, error: "Message must be text." };
  }

  const text = messageText.trim();
  if (!text) {
    return { success: false, error: "Message cannot be empty." };
  }
  if (text.length > MAX_CHAT_MESSAGE_LENGTH) {
    return {
      success: false,
      error: `Messages must be ${MAX_CHAT_MESSAGE_LENGTH} characters or fewer.`,
    };
  }

  return { success: true, text };
}

function toPublicChatMessage(document) {
  return {
    id: String(document.messageId || document._id),
    senderId: document.senderId,
    name: document.name,
    avatarColor: document.avatarColor,
    roomId: document.roomId,
    text: document.text,
    timestamp: new Date(document.timestamp).toISOString(),
  };
}

async function loadRecentChatHistory(db, roomId) {
  const documents = await db
    .collection("chatMessages")
    .find({ roomId })
    .sort({ timestamp: -1, _id: -1 })
    .limit(CHAT_HISTORY_LIMIT)
    .toArray();

  return documents.reverse().map(toPublicChatMessage);
}

async function sendRoomChatHistory(socket, db, players, roomId) {
  const player = players.get(socket.id);
  if (!player || player.roomId !== roomId) return;

  try {
    const messages = await loadRecentChatHistory(db, roomId);
    const currentPlayer = players.get(socket.id);
    if (!currentPlayer || currentPlayer.roomId !== roomId) return;
    socket.emit("chat:history", { roomId, messages });
  } catch (error) {
    console.error("Failed to load room chat history:", error.message);
    const currentPlayer = players.get(socket.id);
    if (currentPlayer && currentPlayer.roomId === roomId) {
      socket.emit("chat:history:error", {
        roomId,
        error: "Could not load chat history. Try switching rooms.",
      });
    }
  }
}

function registerChatHandlers(socket, { db, players, io }) {
  socket.on("chat:send", async (messageText, clientMessageId, callback) => {
    const respond = (result) => {
      if (typeof callback === "function") callback(result);
    };

    const validation = validateChatText(messageText);
    if (!validation.success) {
      respond(validation);
      return;
    }
    if (
      typeof clientMessageId !== "string" ||
      !clientMessageId.trim() ||
      clientMessageId.length > CLIENT_MESSAGE_ID_MAX_LENGTH
    ) {
      respond({ success: false, error: "Invalid message ID." });
      return;
    }

    const sender = players.get(socket.id);
    if (!sender) {
      respond({ success: false, error: "Player not found." });
      return;
    }

    const timestamp = new Date();
    const messageId = randomUUID();
    const messageDocument = {
      _id: messageId,
      messageId,
      senderId: socket.id,
      name: sender.name,
      avatarColor: sender.avatarColor || DEFAULT_AVATAR_COLOR,
      roomId: sender.roomId,
      text: validation.text,
      timestamp,
      clientMessageId: clientMessageId.trim(),
    };

    try {
      await db.collection("chatMessages").insertOne(messageDocument);
      const message = toPublicChatMessage(messageDocument);
      emitToRoom(io, sender.roomId, "chat:message", message);
      respond({ success: true, id: message.id });
    } catch (error) {
      if (error.code === 11000) {
        try {
          const existing = await db.collection("chatMessages").findOne({
            senderId: socket.id,
            clientMessageId: clientMessageId.trim(),
          });
          if (existing) {
            respond({
              success: true,
              id: String(existing.messageId || existing._id),
              duplicate: true,
            });
            return;
          }
        } catch (lookupError) {
          console.error(
            "Failed to verify duplicate chat message:",
            lookupError.message
          );
        }
      }

      console.error("Failed to save chat message:", error.message);
      respond({
        success: false,
        error: "Could not send your message. Try again.",
      });
    }
  });
}

module.exports = {
  MAX_CHAT_MESSAGE_LENGTH,
  CHAT_HISTORY_LIMIT,
  validateChatText,
  loadRecentChatHistory,
  sendRoomChatHistory,
  registerChatHandlers,
};
