import test from "node:test";
import assert from "node:assert/strict";
import {
  addActivityNotification,
  getUnreadActivityCount,
  markActivityNotificationsRead,
  MAX_ACTIVITY_NOTIFICATIONS,
  subscribeToActivityNotifications,
} from "./activity-notifications.js";

function notification(id, timestamp) {
  return {
    id,
    type: "player-joined",
    playerName: "Naseema",
    message: "Naseema joined Lounge",
    room: "Lounge",
    timestamp,
  };
}

test("notifications are sorted newest-first and duplicate ids are ignored", () => {
  const older = notification("older", "2026-10-28T08:00:00.000Z");
  const newer = notification("newer", "2026-10-28T08:01:00.000Z");
  const list = addActivityNotification(
    addActivityNotification([], older),
    newer
  );

  assert.deepEqual(list.map(({ id }) => id), ["newer", "older"]);
  assert.equal(addActivityNotification(list, newer), list);
});

test("notification list is limited and unread count can be cleared", () => {
  let list = [];
  for (let index = 0; index < MAX_ACTIVITY_NOTIFICATIONS + 5; index += 1) {
    list = addActivityNotification(
      list,
      notification(
        `notification-${index}`,
        new Date(2026, 9, 28, 8, index).toISOString()
      )
    );
  }

  assert.equal(list.length, MAX_ACTIVITY_NOTIFICATIONS);
  assert.equal(getUnreadActivityCount(list), MAX_ACTIVITY_NOTIFICATIONS);
  const readList = markActivityNotificationsRead(list);
  assert.equal(getUnreadActivityCount(readList), 0);
  assert.equal(list.every(({ read }) => read === false), true);
});

test("malformed notification payloads are ignored", () => {
  assert.deepEqual(
    addActivityNotification([], {
      ...notification("invalid", "not-a-date"),
      room: "Private Room",
    }),
    []
  );
});

test("activity listener is removed during socket cleanup", () => {
  const listeners = new Set();
  const socket = {
    on(event, listener) {
      assert.equal(event, "activity:notification");
      listeners.add(listener);
    },
    off(event, listener) {
      assert.equal(event, "activity:notification");
      listeners.delete(listener);
    },
  };
  const received = [];
  const unsubscribe = subscribeToActivityNotifications(socket, (item) =>
    received.push(item)
  );
  const handler = Array.from(listeners)[0];
  handler(notification("activity-1", "2026-10-28T08:00:00.000Z"));

  assert.equal(listeners.size, 1);
  assert.equal(received.length, 1);
  unsubscribe();
  assert.equal(listeners.size, 0);
});
