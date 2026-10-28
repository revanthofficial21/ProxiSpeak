import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTypingIndicator,
  updateTypingUsers,
} from "./typingIndicators.js";

const startTyping = (playerId, displayName, roomId = "lounge") => ({
  playerId,
  displayName,
  roomId,
  isTyping: true,
});

test("tracks multiple typing users and formats the indicator", () => {
  let typingUsers = {};
  typingUsers = updateTypingUsers(
    typingUsers,
    startTyping("player-one", "Vivek"),
    "lounge",
    "me"
  );
  typingUsers = updateTypingUsers(
    typingUsers,
    startTyping("player-two", "Naseema"),
    "lounge",
    "me"
  );

  assert.equal(formatTypingIndicator(typingUsers), "Vivek and Naseema are typing…");
});

test("ignores notifications from other rooms and the current user", () => {
  const typingUsers = {};

  assert.equal(
    updateTypingUsers(
      typingUsers,
      startTyping("player-one", "Vivek", "meeting-room"),
      "lounge",
      "me"
    ),
    typingUsers
  );
  assert.equal(
    updateTypingUsers(
      typingUsers,
      startTyping("me", "Me"),
      "lounge",
      "me"
    ),
    typingUsers
  );
});

test("repeated start notifications do not duplicate users and stop removes them", () => {
  let typingUsers = updateTypingUsers(
    {},
    startTyping("player-one", "Vivek"),
    "lounge",
    "me"
  );
  typingUsers = updateTypingUsers(
    typingUsers,
    startTyping("player-one", "Vivek"),
    "lounge",
    "me"
  );
  assert.equal(Object.keys(typingUsers).length, 1);

  typingUsers = updateTypingUsers(
    typingUsers,
    { playerId: "player-one", roomId: "lounge", isTyping: false },
    "lounge",
    "me"
  );
  assert.deepEqual(typingUsers, {});
});
