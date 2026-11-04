const assert = require("node:assert/strict");
const { MEETING_ROOM } = require("../lib/meeting-call");
const {
  MEETING_REACTIONS,
  registerMeetingEvents,
} = require("../lib/meeting-events");

const players = new Map([
  ["alice", { id: "alice", name: "Alice", room: MEETING_ROOM }],
  ["bob", { id: "bob", name: "Bob", room: MEETING_ROOM }],
  ["lee", { id: "lee", name: "Lee", room: "Lounge" }],
]);
const participantIds = new Set(["alice", "bob"]);
const raisedHands = new Set();
const sockets = new Map();
const broadcasts = [];

function createSocket(id, room) {
  const socket = {
    id,
    rooms: new Set([`space:${room}`]),
    handlers: new Map(),
    delivered: [],
    on(event, handler) {
      this.handlers.set(event, handler);
    },
    receive(event, ...args) {
      this.handlers.get(event)(...args);
    },
  };
  sockets.set(id, socket);
  return socket;
}

for (const [id, player] of players) {
  const socket = createSocket(id, player.room);
  registerMeetingEvents(socket, {
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
    raisedHands,
  });
}

function send(id, event, payload) {
  let acknowledgement;
  sockets.get(id).receive(event, payload, (response) => {
    acknowledgement = response;
  });
  return acknowledgement;
}

assert.deepEqual(send("alice", "meeting:hand", { raised: "yes" }), {
  success: false,
  error: "Invalid hand status",
});
assert.deepEqual(
  send("alice", "meeting:hand", { raised: true, id: "bob" }),
  { success: false, error: "Invalid hand status" }
);
assert.deepEqual(send("alice", "meeting:reaction", { emoji: "🔥" }), {
  success: false,
  error: "Invalid reaction",
});
assert.equal(broadcasts.length, 0, "invalid payloads are not broadcast");

assert.deepEqual(
  send("lee", "meeting:reaction", { emoji: MEETING_REACTIONS[0] }),
  {
    success: false,
    error: "Join the Meeting Room call before sending a reaction",
  }
);
assert.equal(broadcasts.length, 0, "participants in other rooms cannot emit");

participantIds.delete("bob");
assert.deepEqual(
  send("bob", "meeting:hand", { raised: true }),
  {
    success: false,
    error: "Join the Meeting Room call before changing hand status",
  }
);
participantIds.add("bob");

assert.deepEqual(send("alice", "meeting:hand", { raised: true }), {
  success: true,
});
assert.equal(raisedHands.has("alice"), true);
assert.deepEqual(broadcasts.at(-1), {
  channel: "space:Meeting Room",
  event: "meeting:hand",
  payload: { id: "alice", name: "Alice", raised: true },
});
assert.deepEqual(sockets.get("bob").delivered.at(-1), {
  event: "meeting:hand",
  payload: { id: "alice", name: "Alice", raised: true },
});
assert.equal(sockets.get("lee").delivered.length, 0);
assert.deepEqual(send("alice", "meeting:hand", { raised: false }), {
  success: true,
});
assert.equal(raisedHands.has("alice"), false);

for (const emoji of MEETING_REACTIONS) {
  assert.deepEqual(send("bob", "meeting:reaction", { emoji }), {
    success: true,
  });
  assert.deepEqual(broadcasts.at(-1), {
    channel: "space:Meeting Room",
    event: "meeting:reaction",
    payload: { id: "bob", name: "Bob", emoji },
  });
  assert.deepEqual(sockets.get("alice").delivered.at(-1), {
    event: "meeting:reaction",
    payload: { id: "bob", name: "Bob", emoji },
  });
}

assert.equal(
  sockets.get("lee").rooms.has(broadcasts.at(-1).channel),
  false,
  "reaction broadcasts are isolated to the Meeting Room Socket.IO channel"
);
console.log("All meeting event tests passed");
