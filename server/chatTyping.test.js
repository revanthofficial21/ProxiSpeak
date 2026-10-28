const assert = require("node:assert/strict");
const {
  TYPING_IDLE_TIMEOUT_MS,
  registerChatTypingHandlers,
} = require("./chatTyping");
const { registerChatHandlers } = require("./chat");

function createSocket(id) {
  const handlers = new Map();
  return {
    id,
    on(event, handler) {
      handlers.set(event, handler);
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
    except(destination) {
      return {
        emit(event, payload) {
          events.push({ excludedDestination: destination, event, payload });
        },
      };
    },
  };
}

async function run() {
  assert.equal(TYPING_IDLE_TIMEOUT_MS, 2000);

  const player = {
    id: "socket-one",
    name: "Vivek",
    roomId: "lounge",
  };
  const players = new Map([[player.id, player]]);
  const socket = createSocket(player.id);
  const io = createIo();
  const clearTyping = registerChatTypingHandlers(socket, { players, io });

  await socket.trigger("chat:typing", { isTyping: true });
  assert.deepEqual(io.events[0], {
    destination: "room:lounge",
    event: "chat:typing",
    payload: {
      playerId: player.id,
      displayName: "Vivek",
      roomId: "lounge",
      isTyping: true,
    },
  });
  assert.equal(
    Object.hasOwn(io.events[0].payload, "text"),
    false,
    "typing events do not include message text"
  );

  await socket.trigger("chat:typing", { isTyping: true });
  assert.equal(io.events.length, 1, "repeated start events do not duplicate indicators");

  await socket.trigger("chat:typing", { isTyping: false });
  assert.equal(io.events[1].destination, "room:lounge");
  assert.equal(io.events[1].payload.isTyping, false);

  await socket.trigger("chat:typing", { isTyping: true });
  player.roomId = "meeting-room";
  clearTyping();
  assert.equal(io.events[3].destination, "room:lounge");
  assert.equal(io.events[3].payload.isTyping, false);

  await socket.trigger("chat:typing", { isTyping: true });
  await socket.trigger("disconnect");
  assert.equal(io.events[5].destination, "room:meeting-room");
  assert.equal(io.events[5].payload.isTyping, false);

  const idleSocket = createSocket("socket-idle");
  const idlePlayers = new Map([
    ["socket-idle", { id: "socket-idle", name: "Naseema", roomId: "lounge" }],
  ]);
  const idleIo = createIo();
  registerChatTypingHandlers(idleSocket, { players: idlePlayers, io: idleIo });
  await idleSocket.trigger("chat:typing", { isTyping: true });
  await new Promise((resolve) =>
    setTimeout(resolve, TYPING_IDLE_TIMEOUT_MS + 50)
  );
  assert.equal(idleIo.events.length, 2, "idle typing clears after two seconds");
  assert.equal(idleIo.events[1].payload.isTyping, false);

  const sendingSocket = createSocket("socket-sender");
  const sendingPlayer = {
    id: "socket-sender",
    name: "Vivek",
    roomId: "lounge",
  };
  const sendingPlayers = new Map([[sendingPlayer.id, sendingPlayer]]);
  const sendingIo = createIo();
  const clearSendingTyping = registerChatTypingHandlers(sendingSocket, {
    players: sendingPlayers,
    io: sendingIo,
  });
  registerChatHandlers(sendingSocket, {
    players: sendingPlayers,
    io: sendingIo,
    onMessageSending: clearSendingTyping,
    db: {
      collection() {
        return {
          async insertOne() {},
        };
      },
    },
  });
  await sendingSocket.trigger("chat:typing", { isTyping: true });
  await sendingSocket.trigger("chat:send", "Hello", "message-one", () => {});
  assert.equal(sendingIo.events[1].payload.isTyping, false);

  console.log("Chat typing indicator tests passed");
}

run().catch((error) => {
  console.error("Chat typing indicator tests failed:", error);
  process.exitCode = 1;
});
