const assert = require("node:assert/strict");
const { registerRoomHandler } = require("./roomHandler");
const {
  DEFAULT_ROOM_ID,
  getRoomChannel,
  getPlayersInRoom,
  areInSameRoom,
  emitToRoom,
  emitRoomPresence,
  emitPlayerLeft,
} = require("./roomUtils");
const { getNearbyPlayers } = require("./proximity");

const rooms = [
  { id: "open-world", name: "Open World" },
  { id: "meeting-room", name: "Meeting Room" },
  { id: "lounge", name: "Lounge" },
];

function createSocket(id, initialRoomId) {
  const handlers = new Map();
  const events = [];
  const memberships = new Set([getRoomChannel(initialRoomId)]);

  return {
    id,
    events,
    memberships,
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      events.push({ destination: "self", event, payload });
    },
    to(channel) {
      return {
        emit(event, payload) {
          events.push({ destination: channel, event, payload });
        },
      };
    },
    async join(channel) {
      memberships.add(channel);
    },
    leave(channel) {
      memberships.delete(channel);
    },
    async trigger(event, ...args) {
      return handlers.get(event)(...args);
    },
  };
}

function createIo() {
  const events = [];
  return {
    events,
    to(destination) {
      return {
        emit(event, payload) {
          events.push({ destination, event, payload });
        },
      };
    },
  };
}

async function requestRoom(socket, roomId) {
  let response;
  await socket.trigger("room:join", roomId, (result) => {
    response = result;
  });
  return response;
}

async function run() {
  const player = {
    id: "player-1",
    socketId: "player-1",
    name: "One",
    x: 100,
    y: 100,
    roomId: DEFAULT_ROOM_ID,
  };
  const sameRoomPeer = {
    id: "player-2",
    socketId: "player-2",
    name: "Two",
    x: 150,
    y: 100,
    roomId: DEFAULT_ROOM_ID,
  };
  const otherRoomPeer = {
    id: "player-3",
    socketId: "player-3",
    name: "Three",
    x: 110,
    y: 100,
    roomId: "lounge",
  };
  const players = new Map(
    [player, sameRoomPeer, otherRoomPeer].map((entry) => [entry.id, entry])
  );
  const socket = createSocket(player.id, DEFAULT_ROOM_ID);
  const io = createIo();
  const updates = [];
  const roomChanges = [];
  const historyLoads = [];
  const leavingRooms = [];
  const db = {
    collection(name) {
      assert.equal(name, "players");
      return {
        async updateOne(filter, update) {
          updates.push({ filter, update });
          return { matchedCount: 1 };
        },
      };
    },
  };

  registerRoomHandler(socket, {
    availableRooms: rooms,
    players,
    db,
    io,
    publicPlayer: ({ id, name, x, y, roomId }) => ({
      id,
      name,
      x,
      y,
      roomId,
    }),
    onRoomLeaving: async (...args) => leavingRooms.push(args),
    onRoomChanged: async (...args) => roomChanges.push(args),
    loadChatHistory: async (roomId) => historyLoads.push(roomId),
  });
  await Promise.resolve();
  assert.deepEqual(historyLoads, [DEFAULT_ROOM_ID]);

  const invalid = await requestRoom(socket, "not-a-room");
  assert.deepEqual(invalid, {
    success: false,
    error: "Invalid room selection.",
  });
  assert.equal(updates.length, 0, "invalid selection is not persisted");
  assert.deepEqual([...socket.memberships], [getRoomChannel(DEFAULT_ROOM_ID)]);

  const switched = await requestRoom(socket, "lounge");
  assert.deepEqual(switched, { success: true, roomId: "lounge" });
  assert.equal(players.get(player.id).roomId, "lounge");
  assert.equal(socket.memberships.has(getRoomChannel(DEFAULT_ROOM_ID)), false);
  assert.equal(socket.memberships.has(getRoomChannel("lounge")), true);
  assert.deepEqual(updates[0].filter, {
    socketId: player.id,
    connected: true,
  });
  assert.equal(updates[0].update.$set.roomId, "lounge");
  assert.deepEqual(roomChanges, [[player.id, DEFAULT_ROOM_ID, "lounge"]]);
  assert.deepEqual(leavingRooms, [[player.id, DEFAULT_ROOM_ID, "lounge"]]);
  assert.deepEqual(historyLoads, [DEFAULT_ROOM_ID, "lounge"]);
  assert.deepEqual(
    socket.events.find((event) => event.event === "world:state").payload.map(
      (entry) => entry.id
    ),
    ["player-1", "player-3"]
  );
  assert(
    io.events.some(
      ({ destination, event, payload }) =>
        destination === getRoomChannel(DEFAULT_ROOM_ID) &&
        event === "player:left" &&
        payload === player.id
    ),
    "leaving presence is sent only to the previous room"
  );
  assert(
    socket.events.some(
      ({ destination, event }) =>
        destination === getRoomChannel("lounge") && event === "player:joined"
    ),
    "joining presence is sent only to the new room"
  );
  assert(
    io.events.some(
      ({ destination, event, payload }) =>
        destination === getRoomChannel(DEFAULT_ROOM_ID) &&
        event === "room:presence" &&
        payload.action === "left" &&
        payload.displayName === "One"
    ),
    "named players notify their previous room when leaving"
  );
  assert(
    socket.events.some(
      ({ destination, event, payload }) =>
        destination === getRoomChannel("lounge") &&
        event === "room:presence" &&
        payload.action === "joined" &&
        payload.displayName === "One"
    ),
    "named players notify only their new room when joining"
  );
  assert.equal(
    io.events.filter(({ event }) => event === "room:presence").length,
    1,
    "the old room receives only its own leave notification"
  );
  assert.equal(
    socket.events.filter(({ event }) => event === "room:presence").length,
    1,
    "the new room receives only its own join notification"
  );

  const repeated = await requestRoom(socket, "lounge");
  assert.deepEqual(repeated, { success: true, roomId: "lounge" });
  assert.equal(updates.length, 1, "rejoining the active room is a no-op");
  assert.equal(
    socket.events.filter(({ event }) => event === "room:presence").length,
    1,
    "repeated joins do not duplicate presence notifications"
  );

  const nextSwitch = await requestRoom(socket, "meeting-room");
  assert.deepEqual(nextSwitch, { success: true, roomId: "meeting-room" });
  assert.equal(players.get(player.id).roomId, "meeting-room");
  assert.equal(socket.memberships.has(getRoomChannel("lounge")), false);
  assert.equal(socket.memberships.has(getRoomChannel("meeting-room")), true);
  assert.deepEqual(historyLoads, [
    DEFAULT_ROOM_ID,
    "lounge",
    "meeting-room",
  ]);
  assert.deepEqual(leavingRooms, [
    [player.id, DEFAULT_ROOM_ID, "lounge"],
    [player.id, "lounge", "meeting-room"],
  ]);
  assert(
    io.events.some(
      ({ destination, event, payload }) =>
        destination === getRoomChannel("lounge") &&
        event === "room:presence" &&
        payload.action === "left"
    ),
    "switching rooms notifies the room being left"
  );
  assert(
    socket.events.some(
      ({ destination, event, payload }) =>
        destination === getRoomChannel("meeting-room") &&
        event === "room:presence" &&
        payload.action === "joined"
    ),
    "switching rooms notifies the destination room"
  );
  assert.equal(areInSameRoom(players, player.id, sameRoomPeer.id), false);
  assert.equal(areInSameRoom(players, player.id, otherRoomPeer.id), false);

  const roomPlayers = getPlayersInRoom(players, DEFAULT_ROOM_ID);
  const nearby = getNearbyPlayers(roomPlayers, {
    id: "viewer",
    x: 100,
    y: 100,
  });
  assert.deepEqual(
    nearby.map((entry) => entry.id),
    ["player-2"],
    "nearby-player status excludes players from other rooms"
  );

  emitToRoom(io, "meeting-room", "chat:message", { text: "room message" });
  emitToRoom(io, "meeting-room", "player:moved", { id: player.id });
  assert.deepEqual(
    io.events.slice(-2).map(({ destination }) => destination),
    [getRoomChannel("meeting-room"), getRoomChannel("meeting-room")],
    "chat and movement use the room-specific channel"
  );

  const isolatedIo = createIo();
  emitRoomPresence(isolatedIo, "lounge", {
    ...otherRoomPeer,
    name: "",
  }, "joined");
  emitPlayerLeft(isolatedIo, {
    ...otherRoomPeer,
    name: "",
  });
  assert.deepEqual(
    isolatedIo.events.map(({ destination, event, payload }) => ({
      destination,
      event,
      action: payload.action || (event === "player:left" ? "left" : undefined),
      displayName: event === "room:presence" ? payload.displayName : undefined,
    })),
    [
      {
        destination: getRoomChannel("lounge"),
        event: "room:presence",
        action: "joined",
        displayName: "Player play",
      },
      {
        destination: getRoomChannel("lounge"),
        event: "player:left",
        action: "left",
        displayName: undefined,
      },
      {
        destination: getRoomChannel("lounge"),
        event: "room:presence",
        action: "left",
        displayName: "Player play",
      },
    ],
    "unnamed joins and disconnects notify only the affected room"
  );

  console.log("Room handler tests passed");
}

run().catch((error) => {
  console.error("Room handler tests failed:", error);
  process.exitCode = 1;
});
