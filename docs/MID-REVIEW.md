# Mid-Project Review — Readiness

The mid-project review has two deliverables. This file is the checklist and the
run-book for both.

1. **Spatial Audit** — prove the backend accurately filters and clusters users by
   geospatial coordinates in **under 20ms**.
2. **Audio Check** — demonstrate **two browsers** establishing a WebRTC audio
   connection through the signaling server.

---

## 1. Spatial Audit

**Run it:**

```
cd server
npm install
npm run audit
```

**What it does:** seeds 250 synthetic players across the 1000x600 world, creates
the same `2d` geospatial index the server uses at startup, then runs 200 `$near`
queries. For each query it (a) checks the returned set against a brute-force
distance filter, and (b) measures the query latency.

**Where it connects:** it uses `MONGODB_URI` from `server/.env`. If that is not
set, it falls back to an in-memory MongoDB (needs `mongodb-memory-server`, which
is in devDependencies).

**Expected output:**

```
=== ProxiSpeak Spatial Audit ===
players seeded : 250
queries run    : 200
radius         : 100px

correctness    : 200/200 matched the brute-force set PASS
latency (ms)   : min 1.10  avg 2.30  p50 2.20  p95 3.80  max 6.40
budget         : 20ms  ->  PASS

RESULT: PASS
```

**Evidence to capture:** the console output (screenshot or pasted log).

**Note on "clusters":** the audit proves the *filtering* half — that the backend
correctly returns exactly the players within the radius, fast. The current server
tracks proximity as pairwise enter/leave events; grouping players into discrete
clusters (union-find over the proximity graph) is not implemented yet and is a
Week 3/4 candidate.

---

## 2. Audio Check

**Prerequisites**

- MongoDB running and `MONGODB_URI` set in `server/.env`.
- Server: `cd server && npm install && npm run dev` (listens on port 3000).
- Client: `cd client && npm install && npm run dev`.
- Two browser windows. Use `http://localhost:5173` — `getUserMedia` only works on
  `localhost` or HTTPS. (Two tabs on one machine is enough for this check.)

**Steps**

1. Open the client in both windows.
2. In each window, click **Enable microphone** and allow access.
3. Move the two avatars to within 100px of each other (WASD / arrow keys).
4. Confirm each window's **Proximity audio** panel lists the other peer as
   `connected`, and that you can hear audio from the other window.
5. Move the avatars more than 100px apart — the connection should close and the
   peer should drop off the panel.

**Evidence to capture:** a screen recording (or screenshots) showing both windows
`connected` at once, plus a note that two-way audio was heard.

**Troubleshooting**

- **Mic blocked / no prompt** — you are not on `localhost` or HTTPS.
- **Peer shows `connected` but no audio** — check both sides enabled the mic and
  watch the browser console for errors; check the server log for `$near` errors.
- **No proximity events** — confirm the `2d` index exists with world-sized bounds
  (the server creates it at startup and logs "MongoDB 2d geospatial index ready!").

---

## Sign-off checklist

- [ ] `npm run audit` prints `RESULT: PASS` (correctness + under 20ms)
- [ ] Two browsers both reach peer state `connected`
- [ ] Two-way audio confirmed by ear
- [ ] Audit log captured as evidence
- [ ] Audio Check screenshot / recording captured as evidence

---

## Evidence captured (25 Oct)

**Deliverable 1 — Proximity Calculations: COMPLETE.**
`node tests/proximity.test.js` -> all 7 pass, including "default radius is 100px",
"only B is within 100px of A" and "a player exactly 100px away counts as nearby".
`relaySignal()` gates every `webrtc:*` event on `canRelayWebRtcSignal(...)`, so
offers and answers only reach players in the same space inside the 100px radius
(or members of the Meeting Room call).

**Deliverable 2 — WebRTC Integration: COMPLETE.**
`client/src/useVoiceChat.js` uses `getUserMedia`, `RTCPeerConnection`,
createOffer/createAnswer, set(Local|Remote)Description, addIceCandidate and
`ontrack`. All five `webrtc:*` signaling events are relayed (proximity-gated) by
`server/index.js`.

**Deliverable 3 — Spatial Audit: built, two ways to run it.**
- `npm run audit` — the MongoDB `$near` proof. It could not be executed in the build
  environment (no `mongod`; the sandbox blocks the in-memory server's binary
  download). Run it locally or against Atlas and capture the log.
- `npm run audit:local` — a MongoDB-free benchmark of the same 100px filter
  (`server/spatial-benchmark.js`). Latest output:

```
=== ProxiSpeak Spatial Benchmark (in-memory) ===
players seeded : 250
queries run    : 200
radius         : 100px
correctness    : 200/200 PASS
latency (ms)   : min 0.0243  avg 0.0582  p50 0.0260  p95 0.1929  max 1.4380
budget         : 20ms  -> PASS
RESULT: PASS
```

**Deliverable 4 — Audio Check: built, run pending.**
Run-book above; needs two browsers. Capture the screen recording.

The consolidated pack is `Mid-Review-Evidence.docx`.

---

## Current state (revanth @ 71a2ffd+)

**Test suites — 6/6 pass:** `proximity`, `player-persistence`, `roomCatalog`,
`rooms`, `meeting-call`, `chat` (all run by `npm test`).

**Also built since the mid-review:** people list, world chat, the space catalogue
with real room scoping (`player:joinRoom`), and the Meeting Room call
(`meeting:join` / `meeting:leave` with live participant updates). Switching space
scopes proximity, chat, and WebRTC to that space.

**Still to run (needs a machine with MongoDB and two browsers):** `npm run audit`
and the two-browser Audio Check.
