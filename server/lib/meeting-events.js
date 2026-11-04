const { roomChannel } = require("./rooms");
const { canJoinMeetingCall, MEETING_ROOM } = require("./meeting-call");

const MEETING_REACTIONS = Object.freeze(["👍", "👏", "😂", "❤️", "🙌"]);

function canSendMeetingEvent(player, participantIds) {
  return Boolean(
    canJoinMeetingCall(player) &&
      player.id &&
      participantIds.has(player.id)
  );
}

function registerMeetingEvents(
  socket,
  { io, players, participantIds, raisedHands, getRoomChannel = roomChannel }
) {
  const acknowledge = (callback, response) => {
    if (typeof callback === "function") callback(response);
  };
  const getCurrentParticipant = () => {
    const player = players.get(socket.id);
    return canSendMeetingEvent(player, participantIds) ? player : null;
  };

  socket.on("meeting:hand", (payload, callback) => {
    const player = getCurrentParticipant();
    if (!player) {
      acknowledge(callback, {
        success: false,
        error: "Join the Meeting Room call before changing hand status",
      });
      return;
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.raised !== "boolean" ||
      Object.keys(payload).some((key) => key !== "raised")
    ) {
      acknowledge(callback, { success: false, error: "Invalid hand status" });
      return;
    }

    if (payload.raised) raisedHands.add(socket.id);
    else raisedHands.delete(socket.id);

    const channel = getRoomChannel(MEETING_ROOM);
    if (!channel) {
      acknowledge(callback, {
        success: false,
        error: "Meeting Room unavailable",
      });
      return;
    }
    io.to(channel).emit("meeting:hand", {
      id: socket.id,
      name: player.name || `Player ${socket.id.slice(0, 4)}`,
      raised: payload.raised,
    });
    acknowledge(callback, { success: true });
  });

  socket.on("meeting:reaction", (payload, callback) => {
    const player = getCurrentParticipant();
    if (!player) {
      acknowledge(callback, {
        success: false,
        error: "Join the Meeting Room call before sending a reaction",
      });
      return;
    }
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof payload.emoji !== "string" ||
      !MEETING_REACTIONS.includes(payload.emoji) ||
      Object.keys(payload).some((key) => key !== "emoji")
    ) {
      acknowledge(callback, { success: false, error: "Invalid reaction" });
      return;
    }

    const channel = getRoomChannel(MEETING_ROOM);
    if (!channel) {
      acknowledge(callback, {
        success: false,
        error: "Meeting Room unavailable",
      });
      return;
    }
    io.to(channel).emit("meeting:reaction", {
      id: socket.id,
      name: player.name || `Player ${socket.id.slice(0, 4)}`,
      emoji: payload.emoji,
    });
    acknowledge(callback, { success: true });
  });
}

module.exports = {
  MEETING_REACTIONS,
  canSendMeetingEvent,
  registerMeetingEvents,
};
