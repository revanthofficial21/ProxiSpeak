const {
  createActivityNotification,
  createRoomSwitchNotification,
  getNewProximityEntries,
  isCurrentPlayerSession,
} = require("./activity");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    console.error(`FAIL  ${label}`);
    failures += 1;
  }
}

const player = {
  id: "socket-a",
  socketId: "socket-a",
  name: "Naseema",
  room: "Lounge",
};
const timestamp = new Date("2026-10-28T08:00:00.000Z");
const joined = createActivityNotification(
  "player-joined",
  player,
  "Lounge",
  "join-1",
  timestamp
);
const left = createActivityNotification(
  "player-left",
  player,
  "Lounge",
  "leave-1",
  timestamp
);
const nearby = createActivityNotification(
  "proximity-enter",
  player,
  "Lounge",
  "nearby-1",
  timestamp
);

check(
  "join and disconnect notifications have human-readable server timestamps",
  joined?.message === "Naseema joined Lounge" &&
    joined.type === "player-joined" &&
    joined.playerName === "Naseema" &&
    joined.room === "Lounge" &&
    joined.timestamp === timestamp.toISOString() &&
    left?.message === "Naseema left Lounge" &&
    left.type === "player-left" &&
    nearby?.message === "Naseema is now nearby" &&
    nearby.type === "proximity-enter"
);

const switched = createRoomSwitchNotification(
  player,
  "Lounge",
  "Meeting Room",
  "switch-1",
  timestamp
);
check(
  "room-switch notification names the validated source and destination",
  switched?.type === "room-switch" &&
    switched.message === "Naseema moved from Lounge to Meeting Room" &&
    switched.room === "Meeting Room" &&
    switched.fromRoom === "Lounge" &&
    switched.toRoom === "Meeting Room"
);

const initialEntries = getNewProximityEntries(new Set(), new Set(["socket-b"]));
const repeatedEntries = getNewProximityEntries(
  new Set(["socket-b"]),
  new Set(["socket-b"])
);
check(
  "proximity notifications only arise on outside-to-inside transitions",
  initialEntries.length === 1 &&
    initialEntries[0] === "socket-b" &&
    repeatedEntries.length === 0
);

const players = new Map([["socket-a", player]]);
check(
  "stale or replaced sessions cannot produce a leave event",
  isCurrentPlayerSession(players, "socket-a", player) &&
    !isCurrentPlayerSession(players, "old-socket", player) &&
    !isCurrentPlayerSession(players, "socket-a", {
      ...player,
      socketId: "old-socket",
    })
);

check(
  "invalid activity types, rooms, players, and room transitions are rejected",
  createActivityNotification(
    "client-custom",
    player,
    "Lounge",
    "bad",
    timestamp
  ) === null &&
    createActivityNotification(
      "player-joined",
      player,
      "Private Room",
      "bad",
      timestamp
    ) === null &&
    createActivityNotification(
      "player-joined",
      { id: "", name: "Naseema" },
      "Lounge",
      "bad",
      timestamp
    ) === null &&
    createRoomSwitchNotification(
      player,
      "Private Room",
      "Lounge",
      "bad",
      timestamp
    ) === null &&
    createRoomSwitchNotification(
      player,
      "Lounge",
      "Lounge",
      "bad",
      timestamp
    ) === null
);

console.log(
  failures === 0
    ? "All activity tests passed"
    : `${failures} activity test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
