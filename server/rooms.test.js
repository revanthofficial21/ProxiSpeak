const {
  ROOM_NAMES,
  DEFAULT_ROOM,
  normalizeRoomName,
  roomChannel,
  getPlayersInRoom,
  arePlayersInSameRoom,
  getNearbyPlayersInRoom,
} = require("./rooms");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    console.error(`FAIL  ${label}`);
    failures += 1;
  }
}

const players = new Map([
  ["lounge-a", { id: "lounge-a", room: "Lounge" }],
  ["lounge-b", { id: "lounge-b", room: "Lounge" }],
  ["focus", { id: "focus", room: "Focus Space" }],
]);

check(
  "the configured rooms include the default and required spaces",
  DEFAULT_ROOM === "Lounge" &&
    ["Lounge", "Meeting Room", "Focus Space"].every((room) =>
      ROOM_NAMES.includes(room)
    )
);

check(
  "room names accept only exact allow-listed values",
  normalizeRoomName("Meeting Room") === "Meeting Room" &&
    normalizeRoomName("meeting room") === null &&
    normalizeRoomName("Other Space") === null &&
    roomChannel("Focus Space") === "space:Focus Space" &&
    roomChannel("Other Space") === null
);

check(
  "room player snapshots exclude players in other rooms",
  getPlayersInRoom(players, "Lounge").map((player) => player.id).join(",") ===
    "lounge-a,lounge-b" &&
    getPlayersInRoom(players, "Meeting Room").length === 0
);

check(
  "proximity and signaling can only pair players in the same valid room",
  arePlayersInSameRoom(players.get("lounge-a"), players.get("lounge-b")) &&
    !arePlayersInSameRoom(players.get("lounge-a"), players.get("focus")) &&
    !arePlayersInSameRoom(
      { id: "invalid", room: "Unknown" },
      { id: "invalid-2", room: "Unknown" }
    )
);

const nearbyPlayers = new Map([
    ["meeting-a", { id: "meeting-a", room: "Meeting Room", x: 10, y: 10 }],
    ["meeting-b", { id: "meeting-b", room: "Meeting Room", x: 60, y: 10 }],
    ["lounge", { id: "lounge", room: "Lounge", x: 15, y: 10 }],
    ["meeting-far", { id: "meeting-far", room: "Meeting Room", x: 300, y: 10 }],
]);
const nearbyMeetingPlayers = getNearbyPlayersInRoom(
    nearbyPlayers,
    nearbyPlayers.get("meeting-a")
);

check(
    "nearby lookup uses live players and excludes other rooms",
    nearbyMeetingPlayers.length === 1 &&
      nearbyMeetingPlayers[0].id === "meeting-b" &&
      nearbyMeetingPlayers[0].distance === 50 &&
      getNearbyPlayersInRoom(nearbyPlayers, {
        id: "invalid",
        room: "Unknown",
        x: 10,
        y: 10,
      }).length === 0
);

console.log(
  failures === 0
    ? "All room tests passed"
    : `${failures} room test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
