const {
  MEETING_ROOM,
  canJoinMeetingCall,
  getMeetingCallParticipants,
  canRelayWebRtcSignal,
  relayWebRtcSignal,
} = require("../lib/meeting-call");

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
  ["a", { id: "a", name: "Alice", room: MEETING_ROOM }],
  ["b", { id: "b", name: "Bob", room: MEETING_ROOM }],
  ["lounge", { id: "lounge", name: "Lee", room: "Lounge" }],
]);
const proximity = new Map([["a", new Set(["lounge"])]]);
const callMembers = new Set(["a", "b"]);

check(
  "only connected players currently in Meeting Room may join a call",
  canJoinMeetingCall(players.get("a")) &&
    !canJoinMeetingCall(players.get("lounge")) &&
    !canJoinMeetingCall(null)
);

check(
  "participant lists are derived from connected server-side players",
  getMeetingCallParticipants(callMembers, players)
    .map(({ id }) => id)
    .join(",") === "a,b"
);

check(
  "call signaling requires both participants and same-room membership",
  canRelayWebRtcSignal("a", "b", players, proximity, callMembers) &&
    !canRelayWebRtcSignal("a", "lounge", players, proximity, callMembers) &&
    !canRelayWebRtcSignal(
      "a",
      "b",
      players,
      proximity,
      new Set(["a"])
    )
);

check(
  "proximity signaling remains limited to same-room connected peers",
  canRelayWebRtcSignal(
    "a",
    "lounge",
    new Map([
      ["a", { id: "a", room: "Lounge" }],
      ["lounge", { id: "lounge", room: "Lounge" }],
    ]),
    new Map([["a", new Set(["lounge"])] ]),
    new Set()
  ) &&
    !canRelayWebRtcSignal(
      "a",
      "missing",
      players,
      proximity,
      callMembers
    )
);

const relayedSignals = [];
const relayResult = relayWebRtcSignal({
  io: {
    to: (id) => ({
      emit: (event, payload) => relayedSignals.push({ id, event, payload }),
    }),
  },
  event: "webrtc:offer",
  fromId: "a",
  toId: "b",
  payload: { sdp: { type: "offer" } },
  players,
  proximityState: proximity,
  meetingCallParticipants: callMembers,
});
check(
  "permitted meeting signals relay with the sender id",
  relayResult &&
    relayedSignals.length === 1 &&
    relayedSignals[0].id === "b" &&
    relayedSignals[0].payload.from === "a" &&
    relayedSignals[0].payload.sdp.type === "offer"
);
const deniedRelay = relayWebRtcSignal({
  io: {
    to: () => ({ emit: () => relayedSignals.push({ unexpected: true }) }),
  },
  event: "webrtc:offer",
  fromId: "a",
  toId: "lounge",
  payload: { sdp: { type: "offer" } },
  players,
  proximityState: proximity,
  meetingCallParticipants: callMembers,
});
check(
  "signals outside proximity or a valid meeting call are not relayed",
  !deniedRelay && relayedSignals.length === 1
);

console.log(
  failures === 0
    ? "All meeting call tests passed"
    : `${failures} meeting call test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
