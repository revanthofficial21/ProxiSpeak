const { randomUUID } = require("node:crypto");
const { canSendMeetingEvent } = require("./meeting-events");
const { MEETING_ROOM } = require("./meeting-call");

const MEETING_CALL_CHANNEL = `meeting-call:${MEETING_ROOM}`;
const MAX_NOTE_LENGTH = 10000;
const MAX_ACTION_TITLE_LENGTH = 160;
const MAX_ASSIGNEE_LENGTH = 80;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isValidDueDate(value) {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}

function createMeetingNotesState(document) {
  return {
    content: typeof document?.content === "string" ? document.content : "",
    actionItems: Array.isArray(document?.actionItems)
      ? document.actionItems
      : [],
    updatedAt: document?.updatedAt || null,
  };
}

async function loadMeetingNotes(collection) {
  return createMeetingNotesState(
    await collection.findOne({ _id: MEETING_ROOM })
  );
}

function registerMeetingNotesEvents(
  socket,
  { io, players, participantIds, collection }
) {
  const acknowledge = (callback, response) => {
    if (typeof callback === "function") callback(response);
  };
  const getCurrentParticipant = () => {
    const player = players.get(socket.id);
    return canSendMeetingEvent(player, participantIds) ? player : null;
  };
  const getParticipantNames = () =>
    Array.from(participantIds, (id) => players.get(id))
      .filter(Boolean)
      .map((player) =>
        typeof player.name === "string" && player.name.trim()
          ? player.name.trim()
          : `Player ${player.id.slice(0, 4)}`
      );
  const rejectUnauthorized = (callback) => {
    acknowledge(callback, {
      success: false,
      error: "Join the Meeting Room call to access meeting notes",
    });
  };
  const broadcastState = async (callback) => {
    const state = await loadMeetingNotes(collection);
    io.to(MEETING_CALL_CHANNEL).emit("meeting:notes:state", state);
    acknowledge(callback, { success: true, state });
  };

  socket.on("meeting:notes:load", async (callback) => {
    if (!getCurrentParticipant()) {
      rejectUnauthorized(callback);
      return;
    }

    try {
      acknowledge(callback, {
        success: true,
        state: await loadMeetingNotes(collection),
      });
    } catch (error) {
      console.error("Failed to load meeting notes:", error.message);
      acknowledge(callback, {
        success: false,
        error: "Could not load meeting notes",
      });
    }
  });

  socket.on("meeting:notes:update", async (payload, callback) => {
    if (!getCurrentParticipant()) {
      rejectUnauthorized(callback);
      return;
    }
    if (
      !isRecord(payload) ||
      typeof payload.content !== "string" ||
      payload.content.length > MAX_NOTE_LENGTH ||
      !hasOnlyKeys(payload, ["content"])
    ) {
      acknowledge(callback, { success: false, error: "Invalid meeting notes" });
      return;
    }

    try {
      await collection.updateOne(
        { _id: MEETING_ROOM },
        {
          $set: { content: payload.content, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
      await broadcastState(callback);
    } catch (error) {
      console.error("Failed to save meeting notes:", error.message);
      acknowledge(callback, {
        success: false,
        error: "Could not save meeting notes",
      });
    }
  });

  socket.on("meeting:action:create", async (payload, callback) => {
    if (!getCurrentParticipant()) {
      rejectUnauthorized(callback);
      return;
    }
    if (
      !isRecord(payload) ||
      typeof payload.title !== "string" ||
      !payload.title.trim() ||
      payload.title.trim().length > MAX_ACTION_TITLE_LENGTH ||
      typeof payload.assignee !== "string" ||
      !payload.assignee.trim() ||
      payload.assignee.trim().length > MAX_ASSIGNEE_LENGTH ||
      !getParticipantNames().includes(payload.assignee.trim()) ||
      !isValidDueDate(payload.dueDate) ||
      !hasOnlyKeys(payload, ["title", "assignee", "dueDate"])
    ) {
      acknowledge(callback, { success: false, error: "Invalid action item" });
      return;
    }

    const actionItem = {
      id: randomUUID(),
      title: payload.title.trim(),
      assignee: payload.assignee.trim(),
      dueDate: payload.dueDate || null,
      completed: false,
      createdAt: new Date(),
    };

    try {
      await collection.updateOne(
        { _id: MEETING_ROOM },
        {
          $push: { actionItems: actionItem },
          $set: { updatedAt: new Date() },
          $setOnInsert: { content: "", createdAt: new Date() },
        },
        { upsert: true }
      );
      await broadcastState(callback);
    } catch (error) {
      console.error("Failed to create meeting action item:", error.message);
      acknowledge(callback, {
        success: false,
        error: "Could not create action item",
      });
    }
  });

  socket.on("meeting:action:update", async (payload, callback) => {
    if (!getCurrentParticipant()) {
      rejectUnauthorized(callback);
      return;
    }
    if (
      !isRecord(payload) ||
      typeof payload.id !== "string" ||
      !payload.id.trim() ||
      typeof payload.completed !== "boolean" ||
      !hasOnlyKeys(payload, ["id", "completed"])
    ) {
      acknowledge(callback, { success: false, error: "Invalid action item" });
      return;
    }

    try {
      const result = await collection.updateOne(
        { _id: MEETING_ROOM, "actionItems.id": payload.id },
        {
          $set: {
            "actionItems.$.completed": payload.completed,
            updatedAt: new Date(),
          },
        }
      );
      if (result.matchedCount !== 1) {
        acknowledge(callback, {
          success: false,
          error: "Action item not found",
        });
        return;
      }

      await broadcastState(callback);
    } catch (error) {
      console.error("Failed to update meeting action item:", error.message);
      acknowledge(callback, {
        success: false,
        error: "Could not update action item",
      });
    }
  });
}

module.exports = {
  MAX_ACTION_TITLE_LENGTH,
  MAX_ASSIGNEE_LENGTH,
  MAX_NOTE_LENGTH,
  createMeetingNotesState,
  isValidDueDate,
  loadMeetingNotes,
  registerMeetingNotesEvents,
};
