const {
  createChatMessage,
  createChatUnreadNotification,
  MAX_CHAT_MESSAGE_LENGTH,
} = require("./chat");

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

check(
  "unread notifications include only allow-listed rooms",
  createChatUnreadNotification("Meeting Room")?.room === "Meeting Room" &&
    createChatUnreadNotification("unknown") === null
);

console.log(
  failures === 0
    ? "All chat tests passed"
    : `${failures} chat test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
