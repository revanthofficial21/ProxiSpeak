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
