# Testing and verifying a feature

Three layers, cheapest first. When you add something, run them in this order —
each one catches a different class of mistake, and the cheap ones fail fast.

## 1. Does it even parse and build?

```bash
cd server && for f in index.js lib/*.js; do node --check "$f"; done
cd client && npm run build
```

Catches syntax errors, bad imports, missing exports. Seconds.

## 2. Do the units behave?

```bash
npm test          # from the repo root: server suites + client suites
```

Eleven server suites and two client suites. These cover the pure logic — the
proximity maths, the room model, the rate limiter, the chat validation, the mesh
cap, the occlusion geometry, and the client↔server payload contracts.

**This is where a new feature should get its first test.** If the feature has
logic that can be pulled out of React and out of the socket handler — a distance,
a filter, a sort, a validation — extract it and test it directly.

## 3. Does the app actually work?

```bash
npm --prefix client test
```

The smoke tests render the **real** app in jsdom, click through the landing page,
and assert the world canvas is drawn and the movement keys are attached.

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
- **Occlusion** — put a desk between the two avatars and the voice should go dull.
- **Screen share** — Meeting Room, click Share screen. Needs a standalone Chrome,
  Edge or Firefox: embedded previews (VS Code, Electron) cannot capture the screen.
- **Multi-instance mesh** — two servers with `REDIS_URL` set, one client on each.

## The habit

Before you say a feature works, answer three questions:

1. **What test proves it?** If none, write one — or say plainly that there isn't one.
2. **What did you actually run?** "It builds" is not "it works".
3. **What did you not check?** Naming the gap is what makes the rest trustworthy.

A feature with a test and a stated limitation is worth more than one described as
"done" with neither.
