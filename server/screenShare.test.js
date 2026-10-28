const assert = require("node:assert/strict");
const {
  MEETING_ROOM_ID,
  registerScreenShareHandlers,
  stopActiveScreenShare,
  removeScreenViewer,
} = require("./screenShare");

function createSocket(id) {
  const handlers = new Map();
  const events = [];
  return {
    id,
    events,
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      events.push({ destination: "self", event, payload });
    },
    async trigger(event, ...args) {
      const handler = handlers.get(event);
      if (handler) return handler(...args);
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

async function startShare(socket) {
  let response;
  await socket.trigger("screen:start", (result) => {
    response = result;
  });
  return response;
}

async function run() {
  const players = new Map([
    ["sharer", { id: "sharer", name: "Alice", roomId: MEETING_ROOM_ID }],
    ["viewer", { id: "viewer", name: "Bob", roomId: MEETING_ROOM_ID }],
    ["outsider", { id: "outsider", name: "Eve", roomId: "lounge" }],
  ]);
  const io = createIo();
  const activeShares = new Map();
  const sharer = createSocket("sharer");
  const viewer = createSocket("viewer");
  const outsider = createSocket("outsider");
  for (const socket of [sharer, viewer, outsider]) {
    registerScreenShareHandlers(socket, { players, io, activeShares });
  }

  assert.deepEqual(await startShare(outsider), {
    success: false,
    error: "Screen sharing is only available in the Meeting Room.",
  });
  assert.equal(activeShares.size, 0);

  assert.deepEqual(await startShare(sharer), { success: true });
  assert.deepEqual(await startShare(sharer), { success: true });
  assert.equal(activeShares.get("sharer").name, "Alice");
  assert.equal(activeShares.get("sharer").roomId, MEETING_ROOM_ID);
  assert(
    io.events.some(
      ({ destination, event, payload }) =>
        destination === "room:meeting-room" &&
        event === "screen:available" &&
        payload.name === "Alice"
    )
  );

  await viewer.trigger("screen:watch", { sharerId: "sharer" });
  assert(activeShares.get("sharer").viewers.has("viewer"));
  assert(
    io.events.some(
      ({ destination, event, payload }) =>
        destination === "sharer" &&
        event === "screen:viewer" &&
        payload.viewerId === "viewer"
    )
  );
  await outsider.trigger("screen:watch", { sharerId: "sharer" });
  assert.equal(
    io.events.filter(({ event }) => event === "screen:viewer").length,
    1,
    "viewers outside the meeting room cannot request the share"
  );

  await sharer.trigger("screen:offer", {
    targetId: "viewer",
    offer: { type: "offer" },
  });
  assert(
    io.events.some(
      ({ destination, event }) =>
        destination === "viewer" && event === "screen:offer"
    )
  );
  const offerCount = io.events.filter(({ event }) => event === "screen:offer").length;
  await sharer.trigger("screen:offer", {
    targetId: "outsider",
    offer: { type: "offer" },
  });
  await viewer.trigger("screen:answer", {
    targetId: "sharer",
    answer: { type: "answer" },
  });
  await outsider.trigger("screen:answer", {
    targetId: "sharer",
    answer: { type: "answer" },
  });
  await viewer.trigger("screen:ice-candidate", {
    targetId: "sharer",
    shareId: "sharer",
    candidate: { candidate: "candidate" },
  });
  await outsider.trigger("screen:ice-candidate", {
    targetId: "sharer",
    shareId: "sharer",
    candidate: { candidate: "candidate" },
  });
  assert.equal(
    io.events.filter(({ event }) => event === "screen:offer").length,
    offerCount,
    "offers cannot be relayed to another room"
  );
  assert.equal(
    io.events.filter(({ event }) => event === "screen:answer").length,
    1,
    "only an authorized in-room viewer can answer"
  );
  assert.equal(
    io.events.filter(({ event }) => event === "screen:ice-candidate").length,
    1,
    "ICE candidates cannot cross room boundaries"
  );
  assert.equal(
    io.events.find(({ event }) => event === "screen:offer").payload.shareId,
    "sharer",
    "screen signaling identifies its share to support simultaneous sharers"
  );

  assert.equal(
    stopActiveScreenShare("sharer", activeShares, io, "room-left"),
    true
  );
  assert.equal(activeShares.has("sharer"), false);
  assert(
    io.events.some(
      ({ destination, event, payload }) =>
        destination === "room:meeting-room" &&
        event === "screen:stopped" &&
        payload.reason === "room-left"
    ),
    "stopping the share notifies only the meeting room"
  );
  assert.equal(stopActiveScreenShare("sharer", activeShares, io), false);

  await startShare(sharer);
  await viewer.trigger("screen:watch", { sharerId: "sharer" });
  assert.equal(removeScreenViewer("viewer", activeShares, io), true);
  assert.equal(activeShares.get("sharer").viewers.has("viewer"), false);
  assert(
    io.events.some(
      ({ destination, event }) =>
        destination === "sharer" && event === "screen:viewer-left"
    ),
    "leaving participants are removed from sharer peer connections"
  );
  players.set("sharer", { ...players.get("sharer"), roomId: "lounge" });
  await sharer.trigger("disconnect");
  assert.equal(activeShares.has("sharer"), false, "disconnect clears active share");

  console.log("Screen-share signaling tests passed");
}

run().catch((error) => {
  console.error("Screen-share signaling tests failed:", error);
  process.exitCode = 1;
});
