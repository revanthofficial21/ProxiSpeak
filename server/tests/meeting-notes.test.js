const assert = require("node:assert/strict");
const { MEETING_ROOM } = require("../lib/meeting-call");
const {
  MAX_NOTE_LENGTH,
  registerMeetingNotesEvents,
} = require("../lib/meeting-notes");

const players = new Map([
  ["alice", { id: "alice", name: "Alice", room: MEETING_ROOM }],
  ["bob", { id: "bob", name: "Bob", room: MEETING_ROOM }],
  ["lee", { id: "lee", name: "Lee", room: "Lounge" }],
]);
const participantIds = new Set(["alice", "bob"]);
const state = { _id: MEETING_ROOM, content: "", actionItems: [] };
const sockets = new Map();
const broadcasts = [];

const collection = {
  async findOne(filter) {
    assert.deepEqual(filter, { _id: MEETING_ROOM });
    return state._id ? structuredClone(state) : null;
  },
  async updateOne(filter, update, options = {}) {
    if (filter["actionItems.id"]) {
      const item = state.actionItems.find(
        (candidate) => candidate.id === filter["actionItems.id"]
      );
      if (!item) return { matchedCount: 0 };
      item.completed = update.$set["actionItems.$.completed"];
      state.updatedAt = update.$set.updatedAt;
      return { matchedCount: 1 };
    }

    if (!state._id && options.upsert) {
      state._id = filter._id;
      Object.assign(state, structuredClone(update.$setOnInsert || {}));
    }
    Object.assign(state, update.$set || {});
    if (update.$push?.actionItems) {
      state.actionItems ||= [];
      state.actionItems.push(structuredClone(update.$push.actionItems));
    }
    return { matchedCount: 1 };
  },
};

function createSocket(id, room) {
  const socket = {
    id,
    rooms: new Set([`meeting-call:${room}`]),
    handlers: new Map(),
    delivered: [],
    on(event, handler) {
      this.handlers.set(event, handler);
    },
    receive(event, ...args) {
      return this.handlers.get(event)(...args);
    },
  };
  sockets.set(id, socket);
  return socket;
}

for (const [id, player] of players) {
  const socket = createSocket(id, player.room);
  registerMeetingNotesEvents(socket, {
    io: {
      to(channel) {
        return {
          emit(event, payload) {
            broadcasts.push({ channel, event, payload });
            for (const recipient of sockets.values()) {
              if (recipient.rooms.has(channel)) {
                recipient.delivered.push({ event, payload });
              }
            }
          },
        };
      },
    },
    players,
    participantIds,
    collection,
  });
}

async function send(id, event, payload) {
  let acknowledgement;
  const callback = (response) => {
    acknowledgement = response;
  };
  const args =
    event === "meeting:notes:load" ? [callback] : [payload, callback];
  await sockets.get(id).receive(event, ...args);
  return acknowledgement;
}

async function main() {
  assert.deepEqual(await send("lee", "meeting:notes:load"), {
    success: false,
    error: "Join the Meeting Room call to access meeting notes",
  });
  assert.deepEqual(
    await send("alice", "meeting:notes:update", { content: "Notes", extra: 1 }),
    { success: false, error: "Invalid meeting notes" }
  );
  assert.deepEqual(
    await send("alice", "meeting:notes:update", {
      content: "x".repeat(MAX_NOTE_LENGTH + 1),
    }),
    { success: false, error: "Invalid meeting notes" }
  );
  assert.equal(
    broadcasts.length,
    0,
    "invalid and unauthorized events do not broadcast"
  );

  const loaded = await send("alice", "meeting:notes:load");
  assert.equal(loaded.success, true);
  assert.deepEqual(loaded.state, {
    content: "",
    actionItems: [],
    updatedAt: null,
  });

  const saved = await send("alice", "meeting:notes:update", {
    content: "Discuss launch checklist",
  });
  assert.equal(saved.success, true);
  assert.equal(state.content, "Discuss launch checklist");
  assert.equal(broadcasts.at(-1).channel, "meeting-call:Meeting Room");
  assert.equal(broadcasts.at(-1).event, "meeting:notes:state");
  assert.deepEqual(sockets.get("bob").delivered.at(-1), {
    event: "meeting:notes:state",
    payload: saved.state,
  });
  assert.equal(sockets.get("lee").delivered.length, 0);

  assert.deepEqual(
    await send("bob", "meeting:action:create", {
      title: "Send recap",
      assignee: "Alice",
      dueDate: "2026-11-30",
    }).then(({ success, state: nextState }) => ({
      success,
      item: nextState.actionItems[0],
    })),
    {
      success: true,
      item: {
        id: state.actionItems[0].id,
        title: "Send recap",
        assignee: "Alice",
        dueDate: "2026-11-30",
        completed: false,
        createdAt: state.actionItems[0].createdAt,
      },
    }
  );
  assert.match(state.actionItems[0].id, /^[\da-f-]{36}$/i);
  assert.deepEqual(
    await send("alice", "meeting:action:update", {
      id: state.actionItems[0].id,
      completed: true,
    }).then(({ success, state: nextState }) => ({
      success,
      completed: nextState.actionItems[0].completed,
    })),
    { success: true, completed: true }
  );
  assert.deepEqual(
    await send("alice", "meeting:action:update", {
      id: state.actionItems[0].id,
      completed: false,
    }).then(({ success, state: nextState }) => ({
      success,
      completed: nextState.actionItems[0].completed,
    })),
    { success: true, completed: false }
  );

  assert.deepEqual(
    await send("alice", "meeting:action:create", {
      title: "   ",
      assignee: "Bob",
    }),
    { success: false, error: "Invalid action item" }
  );
  assert.deepEqual(
    await send("alice", "meeting:action:create", {
      title: "Send recap",
      assignee: "Bob",
      dueDate: "2026-02-30",
    }),
    { success: false, error: "Invalid action item" }
  );
  assert.deepEqual(
    await send("alice", "meeting:action:update", {
      id: "unknown",
      completed: true,
    }),
    { success: false, error: "Action item not found" }
  );

  participantIds.delete("bob");
  assert.deepEqual(
    await send("bob", "meeting:notes:update", { content: "Unauthorized" }),
    {
      success: false,
      error: "Join the Meeting Room call to access meeting notes",
    }
  );
  assert.deepEqual(
    await send("alice", "meeting:action:create", {
      title: "Unsupported assignee",
      assignee: "External person",
    }),
    { success: false, error: "Invalid action item" }
  );
  assert.equal(state.content, "Discuss launch checklist");
  console.log("All meeting notes tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
