# ProxiSpeak — Current Roadmap

Status snapshot: 1 November 2026. Features listed as implemented exist in the
repository; automated checks are listed separately from manual browser checks.

## Implemented

- Landing page and a Canvas-based shared office with keyboard movement,
  furniture collision, zones, and avatar colors.
- MongoDB player records with validated position fields, room, connection state,
  timestamps, profile preferences, and serialized reconnect claims.
- Room-scoped presence, proximity, chat, unread counts, activity notifications,
  and server-validated room changes.
- WebRTC proximity audio, Meeting Room calls, and Meeting Room screen sharing.
- Web Audio spatial gain, stereo pan, furniture occlusion, master speaker volume,
  device selection, and a Resume audio action.
- Room layout documents seeded and loaded from MongoDB, with a client fallback.
- Optional Socket.IO Redis adapter, deployment examples, and graceful server
  lifecycle handling.

## Remaining work / limitations

- Add authenticated identity; display-name restoration is not authentication.
- Add an authorized workflow to edit and persist room layouts; current layouts
  are seeded/loaded, not user-editable.
- Run live browser checks for proximity audio, Meeting Room audio/video,
  screen sharing, device selection, and autoplay recovery on supported browsers.
- Validate the optional Redis adapter with multiple running server instances.
- Measure capacity and frame rate before making scalability or performance
  claims. Automated tests do not establish a 50-user capacity target.
- Configure HTTPS, production TURN credentials, MongoDB, and hosting before
  public deployment.

## Validation commands

```bash
npm --prefix client test
npm --prefix server test
npm --prefix client run build
```

The test suites cover application smoke behavior and pure server/client logic.
They do not replace the live browser checks above or a MongoDB-backed spatial
audit. See [TESTING.md](./TESTING.md) for the current verification procedure.
