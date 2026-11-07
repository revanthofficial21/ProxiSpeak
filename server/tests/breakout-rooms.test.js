const assert = require("node:assert/strict");
const { MEETING_ROOM } = require("../lib/meeting-call");
const { createBreakoutRoomManager } = require("../lib/breakout-rooms");

const players = new Map([
  ["host", { id: "host", name: "Host", room: MEETING_ROOM }],
  ["alice", { id: "alice", name: "Alice", room: MEETING_ROOM }],
  ["bob", { id: "bob", name: "Bob", room: MEETING_ROOM }],
  ["outsider", { id: "outsider", name: "Lee", room: MEETING_ROOM }],
]);
const participantIds = new Set();
const sockets = new Map();
const emitted = [];

function createSocket(id) {
  const socket = {
    id,
    rooms: new Set(),
    handlers: new Map(),
    delivered: [],
    on(event, handler) {
      this.handlers.set(event, handler);
    },
    async join(channel) {
      this.rooms.add(channel);
    },
    async leave(channel) {
      this.rooms.delete(channel);
    },
    async receive(event, ...args) {
      return this.handlers.get(event)(...args);
    },
  };
  sockets.set(id, socket);
  return socket;
}

const io = {
  to(channel) {
    return {
      emit(event, payload) {
        emitted.push({ channel, event, payload });
        for (const recipient of sockets.values()) {
          if (
            (Array.isArray(channel) && channel.includes(recipient.id)) ||
            recipient.rooms.has(channel)
          ) {
            recipient.delivered.push({ event, payload });
          }
        }
      },
    };
  },
  in(id) {
    return {
      async socketsLeave(channel) {
        sockets.get(id)?.rooms.delete(channel);
      },
    };
  },
};

const manager = createBreakoutRoomManager({ io, players, participantIds });
for (const id of players.keys()) {
  const socket = createSocket(id);
  manager.registerSocket(socket);
}

async function send(id, event, payload) {
  let response;
  const callback = (value) => {
    response = value;
  };
  const args =
    event === "breakout:load" || event === "breakout:leave"
      ? [callback]
      : [payload, callback];
  await sockets.get(id).receive(event, ...args);
  return response;
}

async function main() {
  for (const id of ["host", "alice", "bob"]) {
    participantIds.add(id);
    await sockets.get(id).join("meeting-call:Meeting Room");
    manager.joinCall(id);
  }

  assert.equal(manager.getState().hostId, "host");
  assert.deepEqual(await send("alice", "breakout:create", { name: "Plan" }), {
    success: false,
    error: "Only the meeting host can manage breakout rooms",
  });
  assert.deepEqual(
    await send("host", "breakout:create", { name: " Plan ", extra: true }),
    { success: false, error: "Invalid breakout room" }
  );
  assert.deepEqual(
    await send("host", "breakout:create", { name: "   " }),
    { success: false, error: "Invalid breakout room" }
  );
  const created = await send("host", "breakout:create", { name: " Plan " });
  assert.equal(created.success, true);
  assert.equal(created.state.rooms[0].name, "Plan");
  const roomId = created.roomId;

  assert.deepEqual(
    await send("alice", "breakout:assign", {
      participantId: "bob",
      roomId,
    }),
    {
      success: false,
      error: "Only the meeting host can manage breakout rooms",
    }
  );
  assert.deepEqual(
    await send("host", "breakout:assign", {
      participantId: "outsider",
      roomId,
    }),
    { success: false, error: "Invalid breakout assignment" }
  );
  assert.deepEqual(
    await send("host", "breakout:assign", {
      participantId: "alice",
      roomId: "missing",
    }),
    { success: false, error: "Invalid breakout assignment" }
  );
  assert.equal(
    (await send("alice", "breakout:join", { roomId })).success,
    false,
    "unassigned participants cannot join a breakout room"
  );
  assert.equal(
    (await send("outsider", "breakout:load")).success,
    false,
    "non-call participants cannot view breakout state"
  );

  assert.equal(
    (await send("host", "breakout:assign", {
      participantId: "alice",
      roomId,
    })).success,
    true
  );
  assert.equal(
    (await send("alice", "breakout:join", { roomId })).success,
    true
  );
  assert.equal(manager.getBreakoutRoomId("alice"), roomId);
  assert.deepEqual(
    manager.getState().rooms[0].participants.map(({ id }) => id),
    ["alice"]
  );

  assert.deepEqual(
    await send("alice", "breakout:chat:send", { text: "  Hello group  " }),
    { success: true }
  );
  assert.equal(
    sockets.get("alice").delivered.at(-1).payload.text,
    "Hello group"
  );
  const chatEvent = emitted.at(-1);
  assert.deepEqual(chatEvent.channel, ["alice"]);
  assert.equal(chatEvent.event, "breakout:chat:message");
  assert.equal(
    sockets.get("host").delivered.some(
      ({ event }) => event === "breakout:chat:message"
    ),
    false,
    "main room participants do not receive breakout chat"
  );
  assert.deepEqual(
    await send("host", "breakout:chat:send", { text: "No access" }),
    { success: false, error: "Invalid breakout message" }
  );
  assert.deepEqual(
    await send("alice", "breakout:chat:send", { text: "x".repeat(501) }),
    { success: false, error: "Invalid breakout message" }
  );

  assert.equal(
    (await send("host", "breakout:move-back", {
      participantId: "alice",
    })).success,
    true
  );
  assert.equal(manager.getBreakoutRoomId("alice"), null);
  assert.equal(manager.getState().participants[1].assignedRoomId, null);

  await send("host", "breakout:assign", { participantId: "alice", roomId });
  await send("alice", "breakout:join", { roomId });
  assert.equal((await send("host", "breakout:close", { roomId })).success, true);
  assert.equal(manager.getState().rooms.length, 0);
  assert.equal(manager.getBreakoutRoomId("alice"), null);

  await manager.leaveCall("host");
  assert.equal(manager.getState().hostId, "alice");
  assert.equal(participantIds.has("host"), false);
  await manager.leaveCall("alice");
  await manager.leaveCall("bob");
  assert.equal(manager.getState().hostId, null);
  assert.equal(manager.getState().rooms.length, 0);

  console.log("All breakout room tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
