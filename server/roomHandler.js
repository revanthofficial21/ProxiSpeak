const {
  DEFAULT_ROOM_ID,
  getRoomChannel,
  getPlayersInRoom,
  isRoomAvailable,
  emitRoomPresence,
  emitPlayerLeft,
} = require("./roomUtils");

function registerRoomHandler(socket, {
  availableRooms,
  players,
  db,
  io,
  publicPlayer,
  onRoomChanged,
  onRoomLeaving,
  loadChatHistory,
}) {
  socket.on("room:join", async (roomId, callback) => {
    const respond = (result) => {
      if (typeof callback === "function") callback(result);
    };

    if (!isRoomAvailable(roomId, availableRooms)) {
      respond({ success: false, error: "Invalid room selection." });
      return;
    }

    const currentPlayer = players.get(socket.id);
    if (!currentPlayer) {
      respond({ success: false, error: "Player not found." });
      return;
    }

    const previousRoomId = currentPlayer.roomId || DEFAULT_ROOM_ID;
    if (roomId === previousRoomId) {
      respond({ success: true, roomId });
      return;
    }

    try {
      const result = await db.collection("players").updateOne(
        { socketId: socket.id, connected: true },
        { $set: { roomId, updatedAt: new Date() } }
      );
      if (result.matchedCount === 0) {
        respond({ success: false, error: "Player record not found." });
        return;
      }

      if (onRoomLeaving) {
        try {
          await onRoomLeaving(socket.id, previousRoomId, roomId);
        } catch (error) {
          console.error("Failed to stop room resources before switching:", error.message);
        }
      }
      socket.leave(getRoomChannel(previousRoomId));
      emitPlayerLeft(io, { ...currentPlayer, roomId: previousRoomId });

      const updatedPlayer = { ...currentPlayer, roomId };
      players.set(socket.id, updatedPlayer);
      await socket.join(getRoomChannel(roomId));

      socket.emit(
        "world:state",
        getPlayersInRoom(players, roomId).map(publicPlayer)
      );
      socket.to(getRoomChannel(roomId)).emit(
        "player:joined",
        publicPlayer(updatedPlayer)
      );
      emitRoomPresence(io, roomId, updatedPlayer, "joined", socket);
      if (onRoomChanged) {
        try {
          await onRoomChanged(socket.id, previousRoomId, roomId);
        } catch (error) {
          console.error("Failed to refresh room proximity:", error.message);
        }
      }
      if (loadChatHistory) {
        try {
          await loadChatHistory(roomId);
        } catch (error) {
          console.error("Failed to load switched room chat history:", error.message);
        }
      }
      respond({ success: true, roomId });
    } catch (error) {
      console.error("Failed to switch player room:", error.message);
      respond({ success: false, error: "Could not switch rooms. Try again." });
    }
  });

  if (loadChatHistory) {
    const currentPlayer = players.get(socket.id);
    if (currentPlayer) {
      Promise.resolve()
        .then(() => loadChatHistory(currentPlayer.roomId || DEFAULT_ROOM_ID))
        .catch((error) => {
          console.error(
            "Failed to load initial room chat history:",
            error.message
          );
        });
    }
  }
}

module.exports = { registerRoomHandler };
