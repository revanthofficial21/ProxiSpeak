// Screen sharing, available in the Meeting Room.
//
// The sharer captures their screen and opens a separate peer connection to each
// viewer; the server relays only the signaling and keeps the roster of who is
// sharing and who is watching. Ported from Vivek's branch and adapted to main's
// room model (player.room + roomChannel).
const { MEETING_ROOM, canJoinMeetingCall } = require("./meeting-call");
const { roomChannel } = require("./rooms");

function meetingRoomPlayer(players, socketId) {
  const player = players.get(socketId);
  return canJoinMeetingCall(player) ? player : null;
}

function stopActiveScreenShare(socketId, activeShares, io, reason = "stopped") {
  const share = activeShares.get(socketId);
  if (!share) return false;

  activeShares.delete(socketId);
  const channel = roomChannel(share.room);
  if (channel) {
    io.to(channel).emit("screen:stopped", { sharerId: socketId, reason });
  }
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
    const player = meetingRoomPlayer(players, socket.id);
    if (!player) {
      socket.emit("screen:list", { room: null, shares: [] });
      return;
    }

    socket.emit("screen:list", {
      room: player.room,
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

    const player = meetingRoomPlayer(players, socket.id);
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
      room: player.room,
      viewers: new Set(),
    });

    const channel = roomChannel(player.room);
    if (channel) {
      io.to(channel).emit("screen:available", {
        sharerId: socket.id,
        name: activeShares.get(socket.id).name,
      });
    }

    respond({ success: true });
  });

  socket.on("screen:watch", (data) => {
    const viewer = meetingRoomPlayer(players, socket.id);
    const sharerId = data && data.sharerId;
    const share =
      typeof sharerId === "string" ? activeShares.get(sharerId) : null;

    if (!viewer || !share || share.room !== viewer.room) return;

    share.viewers.add(socket.id);
    io.to(sharerId).emit("screen:viewer", { viewerId: socket.id });
  });

  socket.on("screen:offer", (data) => {
    const sharer = meetingRoomPlayer(players, socket.id);
    const targetId = data && data.targetId;
    const viewer =
      typeof targetId === "string"
        ? meetingRoomPlayer(players, targetId)
        : null;
    const share = activeShares.get(socket.id);

    if (
      !sharer ||
      !viewer ||
      !share ||
      share.room !== viewer.room ||
      !share.viewers.has(targetId) ||
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
    const viewer = meetingRoomPlayer(players, socket.id);
    const targetId = data && data.targetId;
    const sharer =
      typeof targetId === "string"
        ? meetingRoomPlayer(players, targetId)
        : null;
    const share = targetId ? activeShares.get(targetId) : null;

    if (
      !viewer ||
      !sharer ||
      !share ||
      share.room !== viewer.room ||
      !share.viewers.has(socket.id) ||
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
    const sender = meetingRoomPlayer(players, socket.id);
    const targetId = data && data.targetId;
    const target =
      typeof targetId === "string"
        ? meetingRoomPlayer(players, targetId)
        : null;
    const shareId = data && data.shareId;
    const share = typeof shareId === "string" ? activeShares.get(shareId) : null;

    // Either the sharer signalling a viewer, or a viewer signalling the sharer.
    const isSharer = socket.id === shareId && share?.viewers.has(targetId);
    const isViewer = targetId === shareId && share?.viewers.has(socket.id);

    if (
      !sender ||
      !target ||
      sender.room !== target.room ||
      !share ||
      share.room !== sender.room ||
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
  MEETING_ROOM,
  meetingRoomPlayer,
  stopActiveScreenShare,
  removeScreenViewer,
  registerScreenShareHandlers,
};
