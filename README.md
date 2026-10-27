# ProxiSpeak — Geospatial Proximity Audio Ecosystem

A real-time virtual collaboration space where you move an avatar around a 2D
office and hear the people near you — spatially, organically, the way you would
in a real room.

**Stack:** React + Vite · HTML5 Canvas · WebRTC · Web Audio API · Node.js +
Express · Socket.IO · MongoDB (geospatial)

---

## 1. Overview

Remote collaboration tools like Zoom force everyone into a rigid "room" where
one person speaks at a time. They lose the spontaneous, spatial dynamics of a
real office — where you can hear a conversation happening nearby and simply walk
over to join it.

ProxiSpeak rebuilds that dynamic in the browser. Users log into a shared 2D
overhead map of a virtual office, move their avatars around, and — as they get
closer to someone — a WebRTC audio connection is established automatically. The
Node.js backend continuously calculates the distance between avatars using
MongoDB geospatial queries and orchestrates the peer-to-peer audio mesh, aiming
to keep the experience seamless for 50+ concurrent users in one space.

## 2. Key Modules

| Module | Responsibility |
|---|---|
| **Geospatial Engine** (MongoDB) | Tracks every avatar's X/Y in real time and groups users by physical proximity (`$near` / `$geoWithin`). |
| **Signaling Server** (Node.js + Socket.IO) | Orchestrates WebRTC peer handshakes, forwarding offers/answers/ICE **only** between users within earshot. |
| **Spatial Audio Mixer** (Web Audio API) | Adjusts gain (volume) and stereo panning of each peer's audio by relative distance. *(in progress — Week 3/4)* |
| **2D Virtual World** (React + Canvas) | High-performance rendering of the office map and live avatar movement. |

## 3. Architecture

```
        positions + signaling (Socket.IO, over WebSocket)
   ┌──────────────────────────────────────────────────────────┐
   │                                                          ▼
┌──┴───────────────┐                                   ┌───────────────┐
│   Browser A      │                                   │  Node.js      │
│  React + Canvas  │                                   │  Express +    │
│  WebRTC + WebAudio                                   │  Socket.IO    │
└──┬───────────────┘                                   └───────┬───────┘
   │                                                           │
   │  WebRTC audio (peer-to-peer, only within 100px)           │  $near query
   │                                                           │  + 2d index
   │                                                           ▼
┌──┴───────────────┐                                   ┌───────────────┐
│   Browser B      │                                   │   MongoDB     │
│  React + Canvas  │                                   │  players      │
└──────────────────┘                                   │  location[x,y]│
                                                       └───────────────┘
```

- **Positions and signaling** travel over Socket.IO through the server.
- **Audio** flows directly browser-to-browser (WebRTC), never through the server.
- The server's only job in the audio path is deciding **who is close enough** to
  be connected, using a MongoDB `$near` query.

## 4. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, HTML5 Canvas, WebRTC (`getUserMedia`, `RTCPeerConnection`), Socket.IO client |
| Backend | Node.js, Express 5, Socket.IO 4 |
| Database | MongoDB (geospatial `2d` index + `$near`) |
| Realtime | Socket.IO (WebSocket) |
| Audio (planned) | Web Audio API (gain + stereo panning) |

## 5. Project Structure

```
ProxiSpeak/
├── client/                     # React frontend
│   ├── src/
│   │   ├── App.jsx             # Canvas world, movement, nearby + audio UI
│   │   ├── useVoiceChat.js     # WebRTC peer connections and voice signaling
│   │   ├── App.css             # Styling
│   │   ├── main.jsx            # React entry point
│   │   └── index.css
│   ├── index.html
│   └── vite.config.js
│
├── server/                     # Node.js backend
│   ├── index.js                # Express + Socket.IO: movement, proximity, WebRTC signaling relay
│   ├── db.js                   # MongoDB connection helper
│   ├── proximity.js            # Pure-JS proximity oracle (reference implementation)
│   ├── proximity.test.js       # Proximity unit tests
│   ├── roomHandler.js          # Validated Socket.IO room switching
│   ├── roomHandler.test.js     # Room switching and isolation tests
│   ├── roomUtils.js             # Room channels and membership helpers
│   └── audit.js                # Spatial audit — correctness + latency benchmark
│
├── WebRTC-Research.md          # WebRTC research notes
├── MID-REVIEW.md               # Mid-review run-book + evidence checklist
└── README.md
```

## 6. How It Works

1. **Connect.** A browser opens a Socket.IO connection; the server assigns it a
   non-overlapping spawn slot and stores the player in MongoDB with a
   `location: [x, y]` field.
2. **Move.** The client moves the avatar locally (WASD / arrow keys, with
   furniture collision) and broadcasts `player:move` (throttled ~40 ms). The
   server clamps the position, persists it, and broadcasts `player:moved`.
3. **Proximity.** On each move the server runs a MongoDB `$near` query with a
   **100px** `$maxDistance` and the player's room ID to find who is within
   earshot in that room, and emits `proximity:enter` / `proximity:leave` to
   **both** players as they come into or leave range.
4. **Signaling.** Clients exchange `voice:offer` / `voice:answer` /
   `voice:ice-candidate` through the server, which **relays them only between
   nearby players in the same room**. The peer with the lower socket id
   initiates, avoiding glare. `voice:leave` tears down the peer when voice is
   disabled, players leave proximity, or a player switches rooms.
5. **Audio.** A `RTCPeerConnection` is established per nearby peer; remote audio
   plays through its own audio element. *(Next: route it through the Web Audio
   API for distance-based gain and panning.)*
6. **Rooms.** Players join `open-world`, `meeting-room`, or `lounge` through
   Socket.IO room membership. Presence, movement, nearby-player updates, chat,
   and voice signaling are isolated to players in that room.
7. **Screen sharing.** In the Meeting Room, participants can explicitly start
   browser screen capture and share it with that room through separate,
   room-validated WebRTC connections. Capture stops on the browser's stop
   control, when leaving the room, or on disconnect.

## 7. Data Model

The `players` collection (MongoDB):

| Field | Type | Notes |
|---|---|---|
| `socketId` | string | Socket.IO connection id (primary key) |
| `name` | string | Display name |
| `x`, `y` | number | Avatar position in the 1000×600 world |
| `location` | `[x, y]` | Geospatial point — indexed with a `2d` index (`min: 0, max: 1000`) |
| `roomId` | string | Current room; used to scope proximity queries and presence |
| `connected` | boolean | Whether the player is currently connected |
| `createdAt` / `updatedAt` | Date | Timestamps |

The `rooms` collection stores the available room catalog. The server creates
the built-in rooms (`open-world`, `meeting-room`, and `lounge`) idempotently
with unique IDs and room names, then serves the catalog at `GET /api/rooms`.
The `room:join` event validates selections against this catalog, persists the
player's `roomId`, and moves their Socket.IO membership. Presence, movement,
chat, nearby-player detection, and voice signaling are room-scoped.

The `chatMessages` collection stores each message's ID, sender ID and name,
room ID, text, and timestamp. The server enforces a 500-character limit and
stores messages before broadcasting them. On connection and room changes, the
server loads the latest 100 messages for that room and returns them in
chronological order. A sender-scoped client message ID and unique MongoDB index
make retries idempotent.

## 8. Realtime Events

**Client → Server**

| Event | Payload |
|---|---|
| `room:join` | `roomId` (callback returns success/error and active room ID) |
| `screen:start` / `screen:stop` | Start or stop a Meeting Room share |
| `screen:watch` | `{ sharerId }` |
| `screen:offer` / `screen:answer` | WebRTC descriptions with target and share IDs |
| `screen:ice-candidate` | Room-restricted ICE candidate |
| `player:setName` | `name` |
| `player:move` | `{ x, y }` |
| `chat:send` | `text`, unique client message ID (callback returns success/error) |
| `voice:ready` | `{ targetId }` |
| `voice:offer` | `{ targetId, offer }` |
| `voice:answer` | `{ targetId, answer }` |
| `voice:ice-candidate` | `{ targetId, candidate }` |
| `voice:leave` | `{ targetId }` |

**Server → Client**

| Event | Payload |
|---|---|
| `world:state` | array of players in the current room |
| `chat:history` | `{ roomId, messages }` (up to 100 messages, oldest first) |
| `chat:history:error` | `{ roomId, error }` |
| `chat:message` | Persisted message for the sender's room |
| `screen:available` / `screen:stopped` | Room-local screen-share presence |
| `screen:offer` / `screen:answer` / `screen:ice-candidate` | Screen WebRTC signaling |
| `player:joined` / `player:moved` / `player:left` | player / id |
| `player:renamed` | player |
| `player:nearby` | array of nearby players |
| `proximity:enter` / `proximity:leave` | peer / peer id |
| `voice:ready` | `{ fromId }` |
| `voice:offer` / `voice:answer` | `{ fromId, offer }` / `{ fromId, answer }` |
| `voice:ice-candidate` | `{ fromId, candidate }` |
| `voice:leave` | `{ fromId }` |

## 9. Getting Started

**Prerequisites:** Node.js 20+, a MongoDB instance (local or Atlas).

### Backend

```bash
cd server
npm install
```

Create `server/.env` with your own MongoDB connection string:

```env
PORT=3000
MONGODB_URI=your_mongodb_connection_string
```

Keep real credentials private and out of version control. Start the backend:

```bash
npm run dev
```

For MongoDB Atlas, make sure the cluster is active, your current public IP is
allowed in the Atlas network access list, and outbound connections to port
27017 are not blocked. If startup reports a TLS handshake failure, check those
network settings and confirm that `MONGODB_URI` is the connection string for
the active cluster. The server always loads configuration from `server/.env`,
even when started from the repository root.

### Frontend

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173` in **two** browser windows, click **Enable
microphone** in each, and move the avatars within 100px to connect.

> `getUserMedia` requires a **secure context** — `localhost` or HTTPS. Two tabs on
> one machine is enough; two *different* machines need HTTPS (or a tunnel).

To verify proximity voice behavior, move the avatars together, apart, and
together again; the microphone button enables or disables local audio, and
voice connections should follow the 100px proximity boundary.

### Scripts

| Directory | Command | Purpose |
|---|---|---|
| `server` | `npm run dev` | Start backend with nodemon |
| `server` | `npm start` | Start backend |
| `server` | `npm test` | Run proximity, room catalog, and room switching tests |
| `server` | `npm run audit` | Run the spatial audit (correctness + latency) |
| `client` | `npm run dev` | Start the Vite dev server |
| `client` | `npm run build` | Production build |

## 10. Progress

| Phase | Focus | Status |
|---|---|---|
| **Week 1** | Signaling & Movement — position broadcast, MongoDB geospatial schema, canvas world, keyboard movement | ✅ Done |
| **Week 2** | Proximity Calculations (`$near`, 100px gating) + WebRTC Integration (`getUserMedia`, peer audio) | ✅ Done |
| **Mid-Review** | Spatial Audit (sub-20ms proof) + Audio Check (two-browser demo) | 🟡 Tooling ready — execution/evidence pending |
| **Week 3** | Room-based multiplayer; Mesh Scaling (Redis Pub/Sub) + Dynamic Attenuation (Web Audio gain) | 🟡 Rooms implemented; scaling and attenuation pending |
| **Week 4** | Room Persistence (layouts + sound-blocking obstacles) + Polish (3D panning, 60 FPS) | ⬜ Not started |

**Working today:** live multiplayer movement in isolated rooms, room-specific
chat and presence, MongoDB `$near` proximity grouping, same-room WebRTC
signaling, and peer-to-peer audio between nearby avatars.

**Not yet built:** the Web Audio spatial mixer (gain/panning), Redis-backed mesh
scaling, room/furniture persistence, and sound occlusion.

## 11. Team & Roles

| Member | Role | Owns |
|---|---|---|
| **Revanth** | Backend & Integration (Lead) | Signaling server, Redis mesh scaling, integration, deployment |
| **Naseema** | Database Developer | Geospatial engine (`$near`, `$geoWithin`, schemas), room persistence |
| **Vivek** | Frontend Developer | 2D virtual world (React + Canvas), rendering, polish |
| **Janakirani Venkatesan** | WebRTC & Spatial Audio | Peer connections, Web Audio mixer, browser testing |

## 12. Roadmap

- **Week 3** — cap the WebRTC mesh to the nearest peers in earshot; add a Redis
  Pub/Sub adapter so Socket.IO can scale across Node instances; hook peer audio
  into the Web Audio API with distance-based gain.
- **Week 4** — persist office layouts and furniture (sound-blocking obstacles) in
  MongoDB; add stereo panning; hold a steady 60 FPS on the canvas.

## 13. Project Information

- **Project:** ProxiSpeak — Geospatial Proximity Audio Ecosystem
- **Group:** 33
- **Assignment Code:** ITS/WEB/1322
