const MEETING_ROOM_ID = "meeting-room";

function getMeetingRoomPlayer(players, socketId) {
  const player = players.get(socketId);
  return player?.roomId === MEETING_ROOM_ID ? player : null;
}

function stopActiveScreenShare(socketId, activeShares, io, reason = "stopped") {
  const share = activeShares.get(socketId);
  if (!share) return false;

  activeShares.delete(socketId);
  io.to(`room:${share.roomId}`).emit("screen:stopped", {
    sharerId: socketId,
    reason,
  });
  return true;
}

function removeScreenViewer(socketId, activeShares, io) {
  let removed = false;
  for (const [sharerId, share] of activeShares) {
    if (!share.viewers.delete(socketId)) continue;
    removed = true;
    io.to(sharerId).emit("screen:viewer-left", { viewerId: socketId });
  }
  return removed;
}

function registerScreenShareHandlers(socket, { players, io, activeShares }) {
  socket.on("screen:list", () => {
    const player = getMeetingRoomPlayer(players, socket.id);
    if (!player) {
      socket.emit("screen:list", { roomId: null, shares: [] });
      return;
    }

    socket.emit("screen:list", {
      roomId: player.roomId,
      shares: Array.from(activeShares, ([sharerId, share]) => ({
        sharerId,
        name: share.name,
      })).filter((share) => share.sharerId !== socket.id),
    });
  });

  socket.on("screen:start", (callback) => {
    const respond = (result) => {
      if (typeof callback === "function") callback(result);
    };
    const player = getMeetingRoomPlayer(players, socket.id);
    if (!player) {
      respond({
        success: false,
        error: "Screen sharing is only available in the Meeting Room.",
      });
      return;
    }

    if (activeShares.has(socket.id)) {
      respond({ success: true });
      return;
    }

    activeShares.set(socket.id, {
      name: player.name || `Player ${socket.id.slice(0, 4)}`,
      roomId: player.roomId,
      viewers: new Set(),
    });
    io.to(`room:${player.roomId}`).emit("screen:available", {
      sharerId: socket.id,
      name: activeShares.get(socket.id).name,
    });
    respond({ success: true });
  });

  socket.on("screen:watch", (data) => {
    const viewer = getMeetingRoomPlayer(players, socket.id);
    const sharerId = data && data.sharerId;
    const sharer = typeof sharerId === "string" && activeShares.get(sharerId);
    if (!viewer || !sharer || sharer.roomId !== viewer.roomId) return;
    sharer.viewers.add(socket.id);
    io.to(sharerId).emit("screen:viewer", { viewerId: socket.id });
  });

  socket.on("screen:offer", (data) => {
    const sharer = getMeetingRoomPlayer(players, socket.id);
    const targetId = data && data.targetId;
    const viewer = typeof targetId === "string"
      ? getMeetingRoomPlayer(players, targetId)
      : null;
    const activeShare = activeShares.get(socket.id);
    if (
      !sharer ||
      !viewer ||
      !activeShare ||
      activeShare.roomId !== viewer.roomId ||
      !activeShare.viewers.has(targetId) ||
      !data.offer
    ) {
      return;
    }
    io.to(targetId).emit("screen:offer", {
      fromId: socket.id,
      shareId: socket.id,
      offer: data.offer,
    });
  });

  socket.on("screen:answer", (data) => {
    const viewer = getMeetingRoomPlayer(players, socket.id);
    const targetId = data && data.targetId;
    const sharer = typeof targetId === "string"
      ? getMeetingRoomPlayer(players, targetId)
      : null;
    const activeShare = targetId && activeShares.get(targetId);
    if (
      !viewer ||
      !sharer ||
      !activeShare ||
      activeShare.roomId !== viewer.roomId ||
      !activeShare.viewers.has(socket.id) ||
      !data.answer
    ) {
      return;
    }
    io.to(targetId).emit("screen:answer", {
      fromId: socket.id,
      shareId: targetId,
      answer: data.answer,
    });
  });

  socket.on("screen:ice-candidate", (data) => {
    const sender = getMeetingRoomPlayer(players, socket.id);
    const targetId = data && data.targetId;
    const target = typeof targetId === "string"
      ? getMeetingRoomPlayer(players, targetId)
      : null;
    const shareId = data && data.shareId;
    const share = typeof shareId === "string" && activeShares.get(shareId);
    const isSharer = socket.id === shareId && share?.viewers.has(targetId);
    const isViewer = targetId === shareId && share?.viewers.has(socket.id);
    if (
      !sender ||
      !target ||
      sender.roomId !== target.roomId ||
      !share ||
      share.roomId !== sender.roomId ||
      !data.candidate ||
      (!isSharer && !isViewer)
    ) {
      return;
    }
    io.to(targetId).emit("screen:ice-candidate", {
      fromId: socket.id,
      shareId,
      candidate: data.candidate,
    });
  });

  socket.on("screen:stop", () => {
    stopActiveScreenShare(socket.id, activeShares, io);
  });

  socket.on("disconnect", () => {
    stopActiveScreenShare(socket.id, activeShares, io, "disconnected");
    removeScreenViewer(socket.id, activeShares, io);
  });
}

module.exports = {
  MEETING_ROOM_ID,
  getMeetingRoomPlayer,
  stopActiveScreenShare,
  removeScreenViewer,
  registerScreenShareHandlers,
};
