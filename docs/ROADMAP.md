# ProxiSpeak — Plan to 5 November

Mid-review completion · Vivek's branch · the build roadmap

## Q1 — Can we merge Vivek's branch and fix everything?

**A raw merge: no.** A test merge of `feature/vivek-frontend` into `main` (in a
scratch clone) failed with **6 conflicted files / 46 hunks** — `client/src/useVoiceChat.js`
alone has 19. The conflicts are structural: `main` uses `server/lib/` + `server/tests/`,
Vivek uses the `server/` root, so every require and file path clashes, and the merged
tree does not parse. Resolving by "keep both" would re-introduce the
duplicate-declaration crash and ship two signaling protocols (`webrtc:*` and `voice:*`)
at once.

**Porting his useful work: yes.** Same approach as his avatar colour — re-implement
the idea on `main`, cleanly. His only remaining worthwhile bits are small: a master
speaker-volume control and an "audio paused → Resume" prompt.

**Fixing bugs: yes.** A full sweep — parse every file, run both test suites, bundle
the client, hunt duplicate declarations — is straightforward.

**His room catalog: not a merge, a build.** It is a picker with no room separation:
the server has no `roomId` on players and does no room filtering. Real rooms are a
genuine feature (room-scoped worlds), listed as deferred below.

## Q2 — What to do today (25 Oct)

Two of the four mid-review deliverables are already complete and evidenced
(Proximity Calculations, WebRTC Integration). The other two are built but need a
machine with MongoDB and two browsers — the sandbox can't run either. So today's
actions are:

- Run the Spatial Audit and capture the log: `cd server && npm install && npm run audit`
  → expect `RESULT: PASS`. Paste the output into `docs/MID-REVIEW.md`.
- Run the Audio Check in two browser windows (see the run-book) and capture a short
  screen recording showing both peers connected.
- Sign off the checklist in `docs/MID-REVIEW.md`.
- Decide Vivek's branch: do **not** merge; port the two small UX bits if wanted.

Everything else is already in the repo: the evidence pack (`Mid-Review-Evidence.docx`),
the captured results in `docs/MID-REVIEW.md`, and the fallback benchmark
(`server/spatial-benchmark.js`).

## Q3 — The roadmap to 5 November

The mockup is a full product; the project today is its technical core (proximity,
spatial voice, presence, avatar colour). The plan reaches the "looks like the mockup"
tier by 5 Nov and defers the three large items.

| Phase | Focus | Days | Outcome |
|---|---|---|---|
| 1 | Mid-review + Vivek port + full bug sweep | 25–27 Oct | Review ready; main clean; bugs fixed |
| 2 | Landing page + office-map restyle + proximity rings | 28–30 Oct | It looks like the product |
| 3 | People list & presence + profile/avatar + audio settings | 31 Oct–2 Nov | The core panels work |
| 4 | Integration, polish, demo + final review | 3–5 Nov | Submission ready |

### Mockup coverage by phase

| Mockup panel | Where it lands | Status today |
|---|---|---|
| 1 Landing page | Phase 2 | not built |
| 2 Office map + sidebar/zones | Phase 2 | partial (canvas only) |
| 3 Proximity voice rings | Phase 2 | audio works; no rings |
| 6 People list & presence | Phase 3 | partial (nearby list) |
| 8 Audio & settings | Phase 3 | partial (mute) |
| 9 Profile & custom avatar | Phase 3 | partial (name + colour) |
| 5 Chat sidebar | Deferred | not built |
| 7 Rooms / spaces | Deferred | not built |
| 4 Meeting room (video) | Deferred | not built |

## Deferred, and the risks

- **Deferred** (largest items, most risk): Rooms / spaces — needs room-scoped worlds,
  not a picker. Chat sidebar — Vivek's world chat was off-brief. Video — a meeting
  room with video is a big lift.
- **Risk — art assets:** the office map and character sprites are drawn artwork; the
  layout can be built, but the visuals need assets (a designer or a sourced tileset).
- **Risk — deadline:** ~10 days. Phases 2 and 3 are the bulk; if time slips, cut
  Phase 3 extras before Phase 2, since "looks like the product" matters most for the
  review.
- Keep `main` and `revanth` in lockstep: fast-forward `revanth` to `main` after each
  merge so the demo branch never drifts.

## Immediate next step

Port Vivek's volume + resume-audio prompt onto `main`, then run the full bug sweep
(parse, both test suites, client bundle, duplicate check) and report.
