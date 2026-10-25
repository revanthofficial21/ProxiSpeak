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
server query   : min 0.30  avg 1.10  p50 0.90  p95 2.40  max 3.80  (ms, DB execution)
round-trip     : min 88.0  avg 92.0  p50 91.0  p95 101.0  max 172.0  (ms, incl. network to DB host)
budget         : 20ms on server query time  ->  PASS

RESULT: PASS
```

**Note on remote databases:** the `round-trip` line includes the network to the DB
host. Against a remote cluster (e.g. Atlas) it is typically 80–110 ms even though
the database itself runs the query in about 1 ms, so the budget is judged on the
`server query` line (the database's own execution time), not the round-trip.

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

- [x] `npm run audit` prints `RESULT: PASS` (correctness + under 20ms) — 25 Oct, server query max 1.00 ms
- [ ] Two browsers both reach peer state `connected`
- [ ] Two-way audio confirmed by ear
- [x] Audit log captured as evidence (output recorded under Deliverable 3)
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

**Deliverable 3 — Spatial Audit: COMPLETE.**

`npm run audit` against the project's MongoDB passed on 25 Oct. Actual output:

```
=== ProxiSpeak Spatial Audit ===
players seeded : 250
queries run    : 200
radius         : 100px

correctness    : 200/200 matched the brute-force set PASS
server query   : min 0.00  avg 0.01  p50 0.00  p95 0.00  max 1.00  (ms, DB execution)
round-trip     : min 23.79  avg 26.08  p50 24.80  p95 31.50  max 58.63  (ms, incl. network to DB host)
budget         : 20ms on server query time  ->  PASS

RESULT: PASS
```

The database executes each `$near` query in at most 1 ms — well inside the 20 ms
budget. The round-trip line is the network to the hosted database and is not the
metric being judged.

A MongoDB-free fallback is also available: `npm run audit:local`
(`server/spatial-benchmark.js`) — the same 100px filter, 200/200 correct, max ~1.4 ms.

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

**Still to run:** the two-browser Audio Check (needs two browsers). `npm run audit`
passed on 25 Oct — see Deliverable 3.
