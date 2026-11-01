const {
  createChatMessage,
  deliverChatMessage,
  MAX_CHAT_MESSAGE_LENGTH,
} = require("../lib/chat");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    console.error(`FAIL  ${label}`);
    failures += 1;
  }
}

const player = { id: "socket-1", name: "Trusted Player" };
const message = createChatMessage(player, "  Hello, world!  ", 1);

check(
  "chat message uses the connected player's name and trims message text",
  message?.id === 1 &&
    message.senderName === "Trusted Player" &&
    message.text === "Hello, world!"
);

check(
  "chat messages accept the maximum allowed length",
  createChatMessage(player, "x".repeat(MAX_CHAT_MESSAGE_LENGTH), 2)?.text
    .length === MAX_CHAT_MESSAGE_LENGTH
);

check(
  "chat messages reject empty, oversized, and non-string content",
  createChatMessage(player, "  ", 3) === null &&
    createChatMessage(player, "x".repeat(MAX_CHAT_MESSAGE_LENGTH + 1), 4) ===
      null &&
    createChatMessage(player, { text: "spoofed" }, 5) === null
);

check(
  "chat messages require a connected player and use a safe fallback name",
  createChatMessage(null, "Hello", 6) === null &&
    createChatMessage({ id: "socket-2", name: "" }, "Hello", 7)
      ?.senderName === "Player"
);

const loungeMessages = [];
const meetingMessages = [];
const worldMessages = [];
const roomSinks = {
  Lounge: loungeMessages,
  "Meeting Room": meetingMessages,
};
const sendRoomMessage = (room, payload) => {
  const recipients = roomSinks[room];
  if (!recipients) return false;
  recipients.push(payload);
  return true;
};

const roomMessage = { scope: "room", room: "Lounge", text: "Room hello" };
check(
  "room messages are delivered only to the sender's room",
  deliverChatMessage({
    scope: "room",
    message: roomMessage,
    room: "Lounge",
    emitWorld: (payload) => worldMessages.push(payload),
    emitRoom: sendRoomMessage,
  }) &&
    loungeMessages[0] === roomMessage &&
    meetingMessages.length === 0 &&
    worldMessages.length === 0
);

const worldMessage = { scope: "world", text: "Everyone hello" };
const connectedUsers = [loungeMessages, meetingMessages];
check(
  "world messages reach users in different rooms",
  deliverChatMessage({
    scope: "world",
    message: worldMessage,
    room: null,
    emitWorld: (payload) => connectedUsers.forEach((inbox) => inbox.push(payload)),
    emitRoom: sendRoomMessage,
  }) &&
    loungeMessages.includes(worldMessage) &&
    meetingMessages.includes(worldMessage)
);

check(
  "room messages with an invalid room are not delivered",
  !deliverChatMessage({
    scope: "room",
    message: { text: "Invalid room" },
    room: null,
    emitWorld: () => {},
    emitRoom: sendRoomMessage,
  })
);

console.log(
  failures === 0
    ? "All chat tests passed"
    : `${failures} chat test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
