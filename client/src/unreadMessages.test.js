import assert from "node:assert/strict";
import test from "node:test";
import {
  clearUnreadCount,
  incrementUnreadCount,
  recordUnreadMessage,
} from "./unreadMessages.js";

function message(id, roomId, senderId = "other-user") {
  return { id, roomId, senderId };
}

test("counts only messages in rooms other than the currently viewed room", () => {
  const seenMessageIds = new Set();
  let unreadCounts = {};

  const currentRoomMessage = message("current-1", "lounge");
  if (
    recordUnreadMessage(
      currentRoomMessage,
      "lounge",
      "my-user",
      seenMessageIds
    )
  ) {
    unreadCounts = incrementUnreadCount(
      unreadCounts,
      currentRoomMessage.roomId
    );
  }

  const otherRoomMessage = message("meeting-1", "meeting-room");
  if (
    recordUnreadMessage(
      otherRoomMessage,
      "lounge",
      "my-user",
      seenMessageIds
    )
  ) {
    unreadCounts = incrementUnreadCount(
      unreadCounts,
      otherRoomMessage.roomId
    );
  }

  assert.deepEqual(unreadCounts, { "meeting-room": 1 });
});

test("does not count the current user's own messages", () => {
  const seenMessageIds = new Set();

  assert.equal(
    recordUnreadMessage(
      message("own-1", "meeting-room", "my-user"),
      "lounge",
      "my-user",
      seenMessageIds
    ),
    false
  );
});

test("updates the viewed room on switching and clears only that room", () => {
  const seenMessageIds = new Set();
  let unreadCounts = { lounge: 2, "meeting-room": 1 };
  const nextMessage = message("lounge-3", "lounge");
  const currentRoomId = "meeting-room";

  if (
    recordUnreadMessage(
      nextMessage,
      currentRoomId,
      "my-user",
      seenMessageIds
    )
  ) {
    unreadCounts = incrementUnreadCount(unreadCounts, nextMessage.roomId);
  }

  assert.equal(unreadCounts.lounge, 3);

  const openedRoomId = "lounge";
  assert.equal(
    recordUnreadMessage(
      message("lounge-4", openedRoomId),
      openedRoomId,
      "my-user",
      seenMessageIds
    ),
    false
  );
  unreadCounts = clearUnreadCount(unreadCounts, openedRoomId);

  assert.deepEqual(unreadCounts, { "meeting-room": 1 });
});

test("does not count a repeated message ID more than once", () => {
  const seenMessageIds = new Set();
  let unreadCounts = {};
  const incomingMessage = message("duplicate-1", "meeting-room");

  for (let delivery = 0; delivery < 2; delivery += 1) {
    if (
      recordUnreadMessage(
        incomingMessage,
        "lounge",
        "my-user",
        seenMessageIds
      )
    ) {
      unreadCounts = incrementUnreadCount(
        unreadCounts,
        incomingMessage.roomId
      );
    }
  }

  assert.deepEqual(unreadCounts, { "meeting-room": 1 });
});
