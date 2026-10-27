// First handler-level test on main: exercises the screen-share socket handlers
// with a fake socket and a fake io, so the wiring is covered, not just the
// pure helpers.
const {
  meetingRoomPlayer,
  stopActiveScreenShare,
  removeScreenViewer,
  registerScreenShareHandlers,
} = require("../lib/screen-share");
const { MEETING_ROOM } = require("../lib/meeting-call");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

function makeSocket(id) {
  const handlers = new Map();
  const emitted = [];
  return {
    id,
    on(event, handler) {
      handlers.set(event, handler);
    },
    emit(event, payload) {
      emitted.push({ event, payload });
    },
    fire(event, ...args) {
      const handler = handlers.get(event);
      if (handler) handler(...args);
    },
    emitted,
  };
}

function makeIo() {
  const sent = [];
  return {
    to(target) {
      return {
        emit(event, payload) {
          sent.push({ target, event, payload });
        },
      };
    },
    sent,
  };
}

// --- helpers ------------------------------------------------------------

const players = new Map([
  ["sharer", { id: "sharer", name: "rev", room: MEETING_ROOM }],
  ["viewer", { id: "viewer", name: "pooji", room: MEETING_ROOM }],
  ["outsider", { id: "outsider", name: "someone", room: "Lounge" }],
]);

check(
  "only Meeting Room players pass the gate",
  meetingRoomPlayer(players, "sharer")?.name === "rev" &&
    meetingRoomPlayer(players, "outsider") === null &&
    meetingRoomPlayer(players, "nobody") === null
);

const shares = new Map();
const io = makeIo();

check(
  "stopping a non-existent share is a no-op",
  stopActiveScreenShare("nobody", shares, io) === false
);

shares.set("sharer", { name: "rev", room: MEETING_ROOM, viewers: new Set(["viewer"]) });
check(
  "removeScreenViewer reports and clears the viewer",
  removeScreenViewer("viewer", shares, io) === true &&
    shares.get("sharer").viewers.size === 0
);

shares.set("sharer", { name: "rev", room: MEETING_ROOM, viewers: new Set() });
check(
  "stopActiveScreenShare removes the share and notifies the room",
  stopActiveScreenShare("sharer", shares, io) === true &&
    shares.size === 0 &&
    io.sent.some((m) => m.event === "screen:stopped")
);

// --- handlers -----------------------------------------------------------

const activeShares = new Map();
const io2 = makeIo();
const sharerSocket = makeSocket("sharer");
registerScreenShareHandlers(sharerSocket, {
  players,
  io: io2,
  activeShares,
});

let started = null;
sharerSocket.fire("screen:start", (result) => {
  started = result;
});
check("sharer can start a share", started?.success === true && activeShares.has("sharer"));
check(
  "the room is told a share became available",
  io2.sent.some((m) => m.event === "screen:available" && m.payload.sharerId === "sharer")
);

const outsiderSocket = makeSocket("outsider");
registerScreenShareHandlers(outsiderSocket, {
  players,
  io: io2,
  activeShares,
});
let outsiderStart = null;
outsiderSocket.fire("screen:start", (result) => {
  outsiderStart = result;
});
check(
  "a player outside the Meeting Room cannot share",
  outsiderStart?.success === false && !activeShares.has("outsider")
);

const viewerSocket = makeSocket("viewer");
registerScreenShareHandlers(viewerSocket, {
  players,
  io: io2,
  activeShares,
});

let listed = null;
viewerSocket.fire("screen:list");
listed = viewerSocket.emitted.find((m) => m.event === "screen:list");
check(
  "the viewer sees the active share",
  listed?.payload.shares.length === 1 &&
    listed.payload.shares[0].sharerId === "sharer"
);

viewerSocket.fire("screen:watch", { sharerId: "sharer" });
check(
  "watching registers the viewer",
  activeShares.get("sharer").viewers.has("viewer")
);

const beforeOffer = io2.sent.length;
viewerSocket.fire("screen:offer", {
  targetId: "sharer",
  offer: { type: "offer", sdp: "x" },
});
check(
  "an offer from a non-sharer is dropped",
  io2.sent.length === beforeOffer
);

sharerSocket.fire("screen:offer", {
  targetId: "viewer",
  offer: { type: "offer", sdp: "x" },
});
check(
  "the sharer's offer reaches the viewer",
  io2.sent.some(
    (m) => m.event === "screen:offer" && m.target === "viewer"
  )
);

viewerSocket.fire("screen:answer", {
  targetId: "sharer",
  answer: { type: "answer", sdp: "y" },
});
check(
  "the viewer's answer reaches the sharer",
  io2.sent.some(
    (m) => m.event === "screen:answer" && m.target === "sharer"
  )
);

const beforeIce = io2.sent.length;
outsiderSocket.fire("screen:ice-candidate", {
  targetId: "sharer",
  shareId: "sharer",
  candidate: { candidate: "z" },
});
check(
  "ICE from outside the room is dropped",
  io2.sent.length === beforeIce
);

viewerSocket.fire("screen:ice-candidate", {
  targetId: "sharer",
  shareId: "sharer",
  candidate: { candidate: "z" },
});
check(
  "ICE from a registered viewer reaches the sharer",
  io2.sent.some(
    (m) => m.event === "screen:ice-candidate" && m.target === "sharer"
  )
);

sharerSocket.fire("screen:stop");
check(
  "stopping removes the share",
  !activeShares.has("sharer") &&
    io2.sent.some((m) => m.event === "screen:stopped")
);

console.log(
  failures === 0
    ? "All screen share tests passed"
    : `${failures} screen share test(s) failed`
);
process.exitCode = failures === 0 ? 0 : 1;
