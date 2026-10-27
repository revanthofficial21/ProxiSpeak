const assert = require("node:assert/strict");
const {
  MAX_CHAT_MESSAGE_LENGTH,
  CHAT_HISTORY_LIMIT,
  validateChatText,
  loadRecentChatHistory,
  sendRoomChatHistory,
  registerChatHandlers,
} = require("./chat");

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
      events.push({ event, payload });
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

function createChatDatabase(initialMessages = []) {
  const messages = [...initialMessages];
  let historyFilter;
  let failInsert = false;
  let failHistory = false;
  const collection = {
    async insertOne(document) {
      if (failInsert) throw new Error("database unavailable");
      const duplicate = messages.find(
        (message) =>
          message.senderId === document.senderId &&
          message.clientMessageId === document.clientMessageId
      );
      if (duplicate) {
        const error = new Error("duplicate key");
        error.code = 11000;
        throw error;
      }
      messages.push(document);
    },
    async findOne(filter) {
      return (
        messages.find(
          (message) =>
            message.senderId === filter.senderId &&
            message.clientMessageId === filter.clientMessageId
        ) || null
      );
    },
    find(filter) {
      historyFilter = filter;
      return {
        sort(sortOrder) {
          this.sortOrder = sortOrder;
          return this;
        },
        limit(limit) {
          this.maxResults = limit;
          return this;
        },
        async toArray() {
          if (failHistory) throw new Error("history unavailable");
          return messages
            .filter((message) => message.roomId === filter.roomId)
            .sort((first, second) => {
              const timestampOrder =
                new Date(second.timestamp) - new Date(first.timestamp);
              return timestampOrder ||
                String(second._id).localeCompare(String(first._id));
            })
            .slice(0, this.maxResults);
        },
      };
    },
  };

  return {
    messages,
    get historyFilter() {
      return historyFilter;
    },
    set failInsert(value) {
      failInsert = value;
    },
    set failHistory(value) {
      failHistory = value;
    },
    collection(name) {
      assert.equal(name, "chatMessages");
      return collection;
    },
  };
}

async function send(socket, text, requestId = "request-1") {
  let response;
  await socket.trigger("chat:send", text, requestId, (result) => {
    response = result;
  });
  return response;
}

async function run() {
  assert.deepEqual(validateChatText("  hello  "), {
    success: true,
    text: "hello",
  });
  assert.equal(validateChatText(" \n ").success, false);
  assert.equal(validateChatText(42).success, false);
  assert.equal(validateChatText("x".repeat(MAX_CHAT_MESSAGE_LENGTH)).success, true);
  assert.equal(
    validateChatText("x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1)).success,
    false
  );

  const sender = {
    id: "socket-one",
    name: "Trusted server name",
    avatarColor: "#abcdef",
    roomId: "lounge",
  };
  const players = new Map([[sender.id, sender]]);
  const socket = createSocket(sender.id);
  const io = createIo();
  const db = createChatDatabase();
  registerChatHandlers(socket, { db, players, io });

  assert.equal((await send(socket, "   ")).success, false);
  assert.equal((await send(socket, "x".repeat(501))).success, false);
  assert.equal((await send(socket, "valid", "")).success, false);
  assert.equal(db.messages.length, 0, "invalid messages are not persisted");

  const sent = await send(socket, "  hello room  ");
  assert.equal(sent.success, true);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0]._id, sent.id);
  assert.equal(db.messages[0].senderId, sender.id);
  assert.equal(db.messages[0].name, "Trusted server name");
  assert.equal(db.messages[0].avatarColor, "#abcdef");
  assert.equal(db.messages[0].roomId, "lounge");
  assert.equal(db.messages[0].text, "hello room");
  assert(db.messages[0].timestamp instanceof Date);
  assert.deepEqual(io.events[0].destination, "room:lounge");
  assert.equal(io.events[0].payload.name, "Trusted server name");
  assert.equal(io.events[0].payload.roomId, "lounge");

  const duplicate = await send(socket, "hello room");
  assert.equal(duplicate.success, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.id, sent.id);
  assert.equal(db.messages.length, 1, "retries do not insert a second message");
  assert.equal(io.events.length, 1, "duplicate messages are not rebroadcast");

  const historyMessages = [];
  for (let index = 0; index < CHAT_HISTORY_LIMIT + 10; index += 1) {
    historyMessages.push({
      _id: `history-${String(index).padStart(3, "0")}`,
      senderId: "history-sender",
      name: "History",
      roomId: "lounge",
      text: `message-${index}`,
      timestamp: new Date(index * 1000),
    });
  }
  historyMessages.push({
    _id: "another-room",
    senderId: "other",
    name: "Other room",
    roomId: "meeting-room",
    text: "private",
    timestamp: new Date(1000000),
  });
  const historyDb = createChatDatabase(historyMessages);
  const history = await loadRecentChatHistory(historyDb, "lounge");
  assert.equal(historyDb.historyFilter.roomId, "lounge");
  assert.equal(history.length, CHAT_HISTORY_LIMIT);
  assert.equal(history[0].text, "message-10");
  assert.equal(history.at(-1).text, `message-${CHAT_HISTORY_LIMIT + 9}`);
  assert(history.every((message) => message.roomId === "lounge"));
  assert.equal(typeof history[0].timestamp, "string");

  await sendRoomChatHistory(socket, historyDb, players, "lounge");
  const historyEvent = socket.events.find(
    (event) => event.event === "chat:history"
  );
  assert.equal(historyEvent.payload.roomId, "lounge");
  assert(historyEvent.payload.messages.every((message) => message.roomId === "lounge"));
  await sendRoomChatHistory(socket, historyDb, players, "meeting-room");
  assert.equal(
    socket.events.filter((event) => event.event === "chat:history").length,
    1,
    "a socket cannot request a room history it has not joined"
  );

  db.failInsert = true;
  const failedSend = await send(socket, "not persisted", "request-failure");
  assert.equal(failedSend.success, false);
  assert.equal(io.events.length, 1, "database failures are not broadcast");

  historyDb.failHistory = true;
  const failingHistorySocket = createSocket(sender.id);
  await sendRoomChatHistory(failingHistorySocket, historyDb, players, "lounge");
  assert.equal(
    failingHistorySocket.events[0].event,
    "chat:history:error",
    "history query failures are reported to the requesting client"
  );

  console.log("Chat history tests passed");
}

run().catch((error) => {
  console.error("Chat history tests failed:", error);
  process.exitCode = 1;
});
