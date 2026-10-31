import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeActivity, addActivity, MAX_ACTIVITY } from "./activity.js";

const valid = {
  id: "a1",
  type: "player-joined",
  playerName: "Revanth",
  room: "Open World",
  message: "Revanth joined Open World",
  timestamp: "2026-10-30T10:00:00.000Z",
};

test("a valid notification is normalised", () => {
  const result = normalizeActivity(valid);
  assert.equal(result.id, "a1");
  assert.equal(result.type, "player-joined");
  assert.equal(result.message, "Revanth joined Open World");
});

test("surrounding whitespace is trimmed", () => {
  const result = normalizeActivity({
    ...valid,
    playerName: "  Revanth  ",
    message: "  Revanth joined Open World  ",
  });
  assert.equal(result.playerName, "Revanth");
  assert.equal(result.message, "Revanth joined Open World");
});

test("unknown rooms are rejected", () => {
  assert.equal(
    normalizeActivity({ ...valid, room: "Focus Space" }),
    null
  );
});

test("unknown types are rejected", () => {
  assert.equal(normalizeActivity({ ...valid, type: "player-danced" }), null);
});

test("a missing id is rejected", () => {
  assert.equal(normalizeActivity({ ...valid, id: "" }), null);
});

test("an over-long message is rejected", () => {
  assert.equal(
    normalizeActivity({ ...valid, message: "x".repeat(201) }),
    null
  );
});

test("an invalid timestamp is rejected", () => {
  assert.equal(
    normalizeActivity({ ...valid, timestamp: "not-a-date" }),
    null
  );
});

test("null and junk are rejected", () => {
  assert.equal(normalizeActivity(null), null);
  assert.equal(normalizeActivity("nonsense"), null);
  assert.equal(normalizeActivity(undefined), null);
});

test("new notifications go to the front", () => {
  const list = addActivity([], valid);
  const next = addActivity(list, {
    ...valid,
    id: "a2",
    timestamp: "2026-10-30T10:05:00.000Z",
  });
  assert.equal(next[0].id, "a2");
  assert.equal(next[1].id, "a1");
});

test("the same id is not added twice", () => {
  const list = addActivity([], valid);
  const again = addActivity(list, valid);
  assert.equal(again.length, 1);
});

test("the list is capped", () => {
  let list = [];
  for (let index = 0; index < MAX_ACTIVITY + 10; index += 1) {
    list = addActivity(list, {
      ...valid,
      id: `id-${index}`,
      timestamp: new Date(1761820000000 + index * 1000).toISOString(),
    });
  }
  assert.equal(list.length, MAX_ACTIVITY);
});

test("an invalid notification leaves the list untouched", () => {
  const list = addActivity([], valid);
  const unchanged = addActivity(list, { ...valid, id: "bad", room: "Nowhere" });
  assert.equal(unchanged, list);
});
