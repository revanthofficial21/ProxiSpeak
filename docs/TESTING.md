# Testing and verifying a feature

Three layers, cheapest first. When you add something, run them in this order —
each one catches a different class of mistake, and the cheap ones fail fast.

## 1. Does it even parse and build?

```bash
npm --prefix client run build
node --check server/index.js
```

Catches syntax errors, bad imports, missing exports. Seconds.

## 2. Do the units behave?

```bash
npm test          # from the repo root: server suites + client suites
```

The server runner executes test scripts covering player persistence, reconnect
claims, room changes, proximity, signaling authorization, Meeting Room event
validation and room isolation, notes/action-item validation, persistence and
authorization, room/world chat delivery, screen sharing, rate limits, layouts,
and activity notifications. The client runner executes
activity tests, an app-rendering smoke test, and occlusion geometry tests.

**This is where a new feature should get its first test.** If the feature has
logic that can be pulled out of React and out of the socket handler — a distance,
a filter, a sort, a validation — extract it and test it directly.

## 3. Does the app actually work?

```bash
npm --prefix client test
```

The smoke tests render the **real** app in jsdom, click through the landing page,
assert the world canvas and movement keys, and simulate a multi-player
`world:state` payload. They verify player-list/count updates and that a
`player:joined` event from another room is ignored.

They exist because two bugs shipped that every other check passed:

- a server field renamed `roomId` → `room` while the client still read `roomId`
  (silent, caught by the contract test in layer 2)
- the draw loop running once before its canvas existed, leaving a blank world and
  dead keys (caught by these smoke tests)

Both were **valid code**. Neither was visible to parsing, bundling or unit tests.
That is the gap this layer covers.

## When a test cannot reach it

Some things genuinely need a browser and a second person. Check them by hand, and
say in your notes that you did:

- **Voice** — two windows, both enable the mic, walk within 100px. Watch the level
  meters: the peer's bar moves when the other person speaks.
- **Meeting call** — join the call in the Meeting Room from two browsers; check
  audio/video and participant join/leave updates, raise and lower hands, and
  verify the five reaction buttons broadcast temporary reactions to both tabs.
  Edit and save the shared notes in one tab and confirm the other updates; add
  an action item with an assignee and due date, then mark it complete and
  pending. Reload and rejoin to verify the notes and action items persist.
- **Occlusion** — put a desk between the two avatars and the voice should go dull.
- **Screen share** — Meeting Room, click Share screen. Needs a standalone Chrome,
  Edge or Firefox: embedded previews (VS Code, Electron) cannot capture the screen.
- **Multi-instance mesh** — two servers with `REDIS_URL` set, one client on each.
- **MongoDB spatial audit** — run `npm --prefix server run audit` against a
  configured database; `audit:local` is a MongoDB-free geometry benchmark.

## The habit

Before you say a feature works, answer three questions:

1. **What test proves it?** If none, write one — or say plainly that there isn't one.
2. **What did you actually run?** "It builds" is not "it works".
3. **What did you not check?** Naming the gap is what makes the rest trustworthy.

A feature with a test and a stated limitation is worth more than one described as
"done" with neither.
