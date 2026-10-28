const { getRoomChannel } = require("./roomUtils");

const TYPING_IDLE_TIMEOUT_MS = 2000;

function registerChatTypingHandlers(socket, { players, io }) {
  let typingTimer = null;
  let typingRoomId = null;

  function clearTyping() {
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }

    if (!typingRoomId) return;

    const roomId = typingRoomId;
    typingRoomId = null;
    const player = players.get(socket.id);
    io.to(getRoomChannel(roomId)).emit("chat:typing", {
      playerId: socket.id,
      displayName: player?.name || `Player ${socket.id.slice(0, 4)}`,
      roomId,
      isTyping: false,
    });
  }

  function startTyping() {
    const player = players.get(socket.id);
    if (!player) return;

    if (typingRoomId !== player.roomId) {
      clearTyping();
      typingRoomId = player.roomId;
      io.to(getRoomChannel(typingRoomId)).emit("chat:typing", {
        playerId: socket.id,
        displayName: player.name || `Player ${socket.id.slice(0, 4)}`,
        roomId: typingRoomId,
        isTyping: true,
      });
    } else if (typingTimer) {
      clearTimeout(typingTimer);
    }

    typingTimer = setTimeout(clearTyping, TYPING_IDLE_TIMEOUT_MS);
  }

  socket.on("chat:typing", (status) => {
    if (!status || typeof status.isTyping !== "boolean") return;
    if (status.isTyping) {
      startTyping();
    } else {
      clearTyping();
    }
  });
  socket.on("disconnect", clearTyping);

  return clearTyping;
}

module.exports = {
  TYPING_IDLE_TIMEOUT_MS,
  registerChatTypingHandlers,
};
