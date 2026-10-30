# Final Review — ProxiSpeak

Proximity-based spatial voice for a virtual office. This document states what was
built, what was proven, what was not, and how to demonstrate it.

Written 30 October 2026, ahead of the 5 November submission.

---

## The short version

ProxiSpeak is a browser virtual office where you hear the people near you and
nothing else. You move an avatar around a shared 2D office; audio fades with
distance, pans with direction, and muffles when furniture is in the way. Spaces
scope both hearing and chat, a Meeting Room call works regardless of distance,
and screens can be shared into it.

It runs on Node + Socket.IO + MongoDB, with WebRTC for the audio itself and an
optional Redis adapter for running several server instances.

**Built:** all four brief weeks. **Proven:** the first two, plus the spatial
audit and the audio check. **Not yet proven:** the multi-instance mesh and the
sound occlusion — both need a browser and, for the mesh, a Redis. Neither is
code work; both are demonstrations.

---

## Brief coverage

| Week | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Signaling, movement, MongoDB geospatial schema | ✅ | `world:state`, `player:move`, 2dsphere index |
| 2 | Proximity (`$near`, 100px) + WebRTC audio | ✅ | 7 proximity tests; peer reached `connected`; audio heard |
| 3 | Mesh scaling (Redis) + dynamic attenuation | 🟡 | Attenuation ✅ in the mixer; mesh **built, not yet run on two instances** |
| 4 | Room persistence + sound-blocking obstacles + polish | 🟡 | Layouts ✅ in MongoDB; obstacles ✅ built, **not yet heard**; stereo pan ✅; 60 FPS unmeasured |

### What each week actually contains

**Week 1 — signaling and movement.** Socket.IO position broadcast with the world
state on connect, keyboard movement at 240 px/s, a 1000×600 world with furniture
collision, and a MongoDB `2dsphere` index on player positions.

**Week 2 — proximity and audio.** A `$near` query gated at 100 px with
**hysteresis** (connect at 100, disconnect at 115) so hovering at the edge does not
tear down and rebuild the peer connection. WebRTC audio with offer/answer
signaling, ICE buffering, and a spatial mixer built on the Web Audio API.

**Week 3 — attenuation and mesh.** Distance attenuation and stereo panning run in
a single `requestAnimationFrame` loop over per-peer `GainNode` and
`StereoPannerNode` chains. The mesh is Socket.IO's Redis adapter, attached only
when `REDIS_URL` is set and failing soft when Redis is unreachable. Each client
connects to its **eight nearest** peers — a full mesh does not scale.

**Week 4 — persistence, obstacles, polish.** Each room owns its layout (zones,
furniture, plants) in MongoDB, served by `GET /api/rooms/:id/layout` and validated
strictly, with the built-in layout as a fallback. Sound occlusion raycasts the
line between two players against that same furniture: 35% gain and an 800 Hz
low-pass when something is in the way.

---

## Evidence

| Claim | How it was shown |
|---|---|
| Spatial queries under 20 ms | `npm run audit` → **PASS**, 200/200 correct, server query max **1.00 ms** (round-trip ~26 ms, printed separately) |
| Two browsers hear each other | Peer reached state `connected`; audio confirmed by ear and by the live level meters |
| Proximity gating works | Live server log: `Nearby players for rev : 1` on approach |
| Reconnect restores state | Log: `Player name: revanth` → `MongoDB matched: 1` |
| Nothing regressed | **13 server suites + 4 client suites**, all passing |
| Client↔server contracts | Static contract test compares every client destructure against the server's payload |

The audit judges the **20 ms budget on database execution time**, not the network
round-trip — measuring the round-trip would have been a meaningless pass.

---

## The demo — ten minutes

Run the server (`npm run dev:server`) and the client (`npm run dev:client`), then
open **http://localhost:5173 in a standalone Chrome, Edge or Firefox**. Embedded
previews (VS Code's built-in browser, Electron) cannot capture the screen and
will fail the screen-share step.

1. **Landing** — the product story, then **Enter the office**.
2. **Two windows** — set different names in each; both appear in People.
3. **Walk together** — the proximity rings light green under 40 px, blue under 75,
   red up to 100. Voice is loud, then quiet, then gone.
4. **Enable microphone** in both — the level meters move when the other person
   speaks. *(This is the proof that audio flows, even when echo cancellation makes
   it inaudible on one machine.)*
5. **Occlusion** — put a desk between the two avatars. The voice should go
   noticeably duller. **This is the differentiator.**
6. **Rooms** — switch one window to the Meeting Room. Hearing and chat stop
   crossing between you; the room cards show the headcount.
7. **Meeting Room** — Join call, then Share screen from one window; the other
   shows the video tile.
8. **Chat** — send a message in the room; the typing indicator appears before it,
   and the unread badge counts it when you are looking elsewhere.

---

## Deploying

The code is deployment-ready; the credentials are not included.

**Requirements**

- **A host** — Render, Railway, Fly.io, or a VPS. Node 20+.
- **MongoDB** — Atlas free tier is enough. Set `MONGODB_URI`.
- **HTTPS** — mandatory. `getUserMedia` and `getDisplayMedia` refuse to run on
  plain HTTP except on localhost.
- **A TURN server** — **not optional for real use.** Without it, two people behind
  different symmetric NATs connect, exchange offers, and hear nothing. Metered,
  Twilio and a self-hosted coturn all work. Set `VITE_TURN_URL`,
  `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`.

**Steps**

```bash
# server
cd server && npm ci
MONGODB_URI=... CORS_ORIGIN=https://your-domain npm start

# client
cd client && npm ci
VITE_SERVER_URL=https://api.your-domain VITE_TURN_URL=... npm run build
# serve dist/ behind HTTPS
```

A `Dockerfile` and `.dockerignore` are in `server/`. `server/.env.example` and
`client/.env.example` list every variable.

**Optional: several instances**

```bash
REDIS_URL=redis://localhost:6379 npm run dev:server
```

---

## Known gaps

Named plainly, because a review that hides them is worth less than one that does
not.

1. **The mesh has never run on two instances.** The adapter, the cap and the
   fallback are all tested in isolation. Proving it needs a Redis and two
   processes.
2. **The occlusion has never been heard.** The geometry has 14 tests; the audio
   effect needs two browsers and a desk.
3. **No camera video.** The mockup's Meeting Room shows faces; this shows screens.
   Video was never in the brief.
4. **The office is top-down, not isometric.** The mockup's art is a hand-drawn
   isometric tileset. Reproducing it needs art assets, not code — roughly three to
   four days, deliberately not spent.
5. **`server/index.js` has no handler tests.** The pure logic is extracted and
   tested; the wiring is checked by static tests (the payload contracts and the
   room-channel symmetry). Three separate bugs reached the branch through this
   gap — all caught, none by a unit test.
6. **No authentication.** Anyone who can reach the server can join as any name.
   Acceptable for an internal demo, not for a public deployment.

---

## Honest assessment

The engineering is finished and defensible: proximity gating with hysteresis,
a spatial mixer, sound occlusion that no competing product does, room-scoped
presence and chat, persisted room layouts, an optional multi-instance mesh, and
seventeen test suites that run in seconds.

What is missing is **evidence for two claims**, not code. Those two demos are a
couple of hours of work, and they convert "we built it" into "we showed it". Do
them before the review, not during it.
