const { randomUUID } = require("node:crypto");
const { MEETING_ROOM } = require("./meeting-call");
const { canSendMeetingEvent } = require("./meeting-events");

const MEETING_CALL_CHANNEL = `meeting-call:${MEETING_ROOM}`;
const MAX_BREAKOUT_ROOMS = 8;
const MAX_BREAKOUT_NAME_LENGTH = 40;
const MAX_BREAKOUT_MESSAGE_LENGTH = 500;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function createBreakoutRoomManager({
  io,
  players,
  participantIds,
  chatLimiter,
}) {
  const rooms = new Map();
  const assignments = new Map();
  const memberships = new Map();
  const joinOrder = new Map();
  let hostId = null;
  let joinSequence = 0;
  let messageSequence = 0;

  const isActiveParticipant = (id) =>
    participantIds.has(id) &&
    players.get(id)?.room === MEETING_ROOM;

  function participantInfo(id) {
    const player = players.get(id);
    if (!player || !isActiveParticipant(id)) return null;

    return {
      id,
      name: player.name?.trim() || `Player ${id.slice(0, 4)}`,
      isHost: id === hostId,
      assignedRoomId: assignments.get(id) || null,
      breakoutRoomId: memberships.get(id) || null,
    };
  }

  function getState() {
    const participants = Array.from(joinOrder.keys())
      .filter(isActiveParticipant)
      .map(participantInfo)
      .filter(Boolean);

    return {
      hostId: isActiveParticipant(hostId) ? hostId : null,
      participants,
      rooms: Array.from(rooms.values()).map((room) => ({
        id: room.id,
        name: room.name,
        participants: participants.filter(
          (participant) => participant.assignedRoomId === room.id
        ),
      })),
    };
  }

  function publishState() {
    const state = getState();
    io.to(MEETING_CALL_CHANNEL).emit("breakout:state", state);
    return state;
  }

  function acknowledge(callback, response) {
    if (typeof callback === "function") callback(response);
  }

  function rejectUnauthorized(callback) {
    acknowledge(callback, {
      success: false,
      error: "Join the Meeting Room call to access breakout rooms",
    });
  }

  function isHost(id) {
    return id === hostId && isActiveParticipant(id);
  }

  function getRoomMembers(roomId) {
    return Array.from(memberships)
      .filter(([, assignedRoomId]) => assignedRoomId === roomId)
      .map(([participantId]) => participantId);
  }

  function moveParticipantToMain(participantId) {
    memberships.delete(participantId);
    assignments.delete(participantId);
  }

  function joinCall(participantId) {
    if (!isActiveParticipant(participantId)) {
      throw new Error("Player is not an active Meeting Room participant");
    }

    if (!joinOrder.has(participantId)) {
      joinSequence += 1;
      joinOrder.set(participantId, joinSequence);
    }
    if (!hostId) hostId = participantId;

    return publishState();
  }

  function leaveCall(participantId) {
    memberships.delete(participantId);
    assignments.delete(participantId);
    joinOrder.delete(participantId);
    participantIds.delete(participantId);

    if (hostId === participantId) {
      hostId = Array.from(joinOrder.keys()).find(isActiveParticipant) || null;
    }
    if (joinOrder.size === 0) {
      rooms.clear();
      assignments.clear();
      memberships.clear();
      hostId = null;
    }

    return publishState();
  }

  function getBreakoutRoomId(participantId) {
    return memberships.get(participantId) || null;
  }

  function getMemberships() {
    return memberships;
  }

  function broadcastState() {
    return publishState();
  }

  function registerSocket(socket) {
    const currentParticipant = () => {
      const player = players.get(socket.id);
      return canSendMeetingEvent(player, participantIds) ? player : null;
    };
    const requireParticipant = (callback) => {
      if (currentParticipant()) return true;
      rejectUnauthorized(callback);
      return false;
    };
    const requireHost = (callback) => {
      if (requireParticipant(callback) && isHost(socket.id)) return true;
      if (currentParticipant() && !isHost(socket.id)) {
        acknowledge(callback, {
          success: false,
          error: "Only the meeting host can manage breakout rooms",
        });
      }
      return false;
    };

    socket.on("breakout:load", (callback) => {
      if (callback !== undefined && typeof callback !== "function") return;
      if (!requireParticipant(callback)) return;
      acknowledge(callback, { success: true, state: getState() });
    });

    socket.on("breakout:create", (payload, callback) => {
      if (!requireHost(callback)) return;
      if (
        !isRecord(payload) ||
        typeof payload.name !== "string" ||
        !payload.name.trim() ||
        payload.name.trim().length > MAX_BREAKOUT_NAME_LENGTH ||
        !hasOnlyKeys(payload, ["name"])
      ) {
        acknowledge(callback, { success: false, error: "Invalid breakout room" });
        return;
      }
      if (rooms.size >= MAX_BREAKOUT_ROOMS) {
        acknowledge(callback, {
          success: false,
          error: "The maximum number of breakout rooms has been reached",
        });
        return;
      }
      const name = payload.name.trim();
      if (
        Array.from(rooms.values()).some(
          (room) => room.name.toLowerCase() === name.toLowerCase()
        )
      ) {
        acknowledge(callback, {
          success: false,
          error: "A breakout room with that name already exists",
        });
        return;
      }

      const room = { id: randomUUID(), name };
      rooms.set(room.id, room);
      acknowledge(callback, {
        success: true,
        roomId: room.id,
        state: publishState(),
      });
    });

    socket.on("breakout:close", (payload, callback) => {
      if (!requireHost(callback)) return;
      if (
        !isRecord(payload) ||
        typeof payload.roomId !== "string" ||
        !hasOnlyKeys(payload, ["roomId"]) ||
        !rooms.has(payload.roomId)
      ) {
        acknowledge(callback, { success: false, error: "Invalid breakout room" });
        return;
      }

      const affectedParticipants = Array.from(joinOrder.keys()).filter(
        (id) =>
          assignments.get(id) === payload.roomId ||
          memberships.get(id) === payload.roomId
      );
      for (const id of affectedParticipants) {
        moveParticipantToMain(id);
      }
      rooms.delete(payload.roomId);
      acknowledge(callback, { success: true, state: publishState() });
    });

    socket.on("breakout:assign", (payload, callback) => {
      if (!requireHost(callback)) return;
      if (
        !isRecord(payload) ||
        typeof payload.participantId !== "string" ||
        typeof payload.roomId !== "string" ||
        !hasOnlyKeys(payload, ["participantId", "roomId"]) ||
        !rooms.has(payload.roomId) ||
        !isActiveParticipant(payload.participantId) ||
        payload.participantId === hostId
      ) {
        acknowledge(callback, { success: false, error: "Invalid breakout assignment" });
        return;
      }

      const previousRoomId = memberships.get(payload.participantId);
      if (previousRoomId && previousRoomId !== payload.roomId) {
        memberships.delete(payload.participantId);
      }
      assignments.set(payload.participantId, payload.roomId);
      acknowledge(callback, { success: true, state: publishState() });
    });

    socket.on("breakout:join", (payload, callback) => {
      if (!requireParticipant(callback)) return;
      if (
        !isRecord(payload) ||
        typeof payload.roomId !== "string" ||
        !hasOnlyKeys(payload, ["roomId"]) ||
        !rooms.has(payload.roomId) ||
        assignments.get(socket.id) !== payload.roomId ||
        socket.id === hostId
      ) {
        acknowledge(callback, {
          success: false,
          error: "You are not assigned to that breakout room",
        });
        return;
      }

      memberships.set(socket.id, payload.roomId);
      acknowledge(callback, { success: true, state: publishState() });
    });

    socket.on("breakout:leave", (callback) => {
      if (callback !== undefined && typeof callback !== "function") return;
      if (!requireParticipant(callback)) return;
      const roomId = memberships.get(socket.id);
      if (!roomId) {
        acknowledge(callback, {
          success: false,
          error: "You are not in a breakout room",
        });
        return;
      }

      memberships.delete(socket.id);
      assignments.delete(socket.id);
      acknowledge(callback, { success: true, state: publishState() });
    });

    socket.on("breakout:move-back", (payload, callback) => {
      if (!requireHost(callback)) return;
      if (
        !isRecord(payload) ||
        typeof payload.participantId !== "string" ||
        !hasOnlyKeys(payload, ["participantId"]) ||
        payload.participantId === hostId ||
        !isActiveParticipant(payload.participantId)
      ) {
        acknowledge(callback, { success: false, error: "Invalid participant" });
        return;
      }
      moveParticipantToMain(payload.participantId);
      acknowledge(callback, { success: true, state: publishState() });
    });

    socket.on("breakout:chat:send", (payload, callback) => {
      if (!requireParticipant(callback)) return;
      const roomId = memberships.get(socket.id);
      if (
        !roomId ||
        !isRecord(payload) ||
        typeof payload.text !== "string" ||
        !payload.text.trim() ||
        payload.text.trim().length > MAX_BREAKOUT_MESSAGE_LENGTH ||
        !hasOnlyKeys(payload, ["text"])
      ) {
        acknowledge(callback, { success: false, error: "Invalid breakout message" });
        return;
      }
      if (chatLimiter && !chatLimiter.take(socket.id)) {
        acknowledge(callback, {
          success: false,
          error: "Slow down — too many messages",
        });
        return;
      }

      messageSequence += 1;
      const player = players.get(socket.id);
      io.to(getRoomMembers(roomId)).emit("breakout:chat:message", {
        id: `breakout-${Date.now()}-${messageSequence}`,
        senderId: socket.id,
        senderName: player.name?.trim() || `Player ${socket.id.slice(0, 4)}`,
        text: payload.text.trim(),
        sentAt: new Date().toISOString(),
      });
      acknowledge(callback, { success: true });
    });
  }

  return {
    broadcastState,
    getBreakoutRoomId,
    getMemberships,
    getRoomMembers,
    getState,
    joinCall,
    leaveCall,
    registerSocket,
  };
}

module.exports = {
  MAX_BREAKOUT_MESSAGE_LENGTH,
  MAX_BREAKOUT_NAME_LENGTH,
  MAX_BREAKOUT_ROOMS,
  createBreakoutRoomManager,
};
