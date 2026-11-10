ProxiSpeak — Geospatial Proximity Audio Ecosystem
A real-time virtual collaboration space where you move an avatar around a 2D
office and hear the people near you — spatially, organically, the way you would
in a real room.

Stack: React + Vite · HTML5 Canvas · WebRTC · Web Audio API · Node.js +
Express · Socket.IO · MongoDB (geospatial)
1. Overview
Remote collaboration tools like Zoom force everyone into a rigid "room" where
one person speaks at a time. They lose the spontaneous, spatial dynamics of a
real office — where you can hear a conversation happening nearby and simply walk
over to join it.

ProxiSpeak rebuilds that dynamic in the browser. Users log into a shared 2D
overhead map of a virtual office, move their avatars around, and — as they get
closer to someone — a WebRTC audio connection is established automatically. The
Node.js backend continuously calculates the distance between avatars using
MongoDB geospatial queries and relays WebRTC signaling only to eligible peers
in the same space. Audio is sent directly between browsers.
2. Key Modules
Module	Responsibility
Geospatial Engine (MongoDB)	Tracks every avatar's X/Y in real time and groups users by physical proximity ($near / $geoWithin).
Signaling Server (Node.js + Socket.IO)	Orchestrates WebRTC peer handshakes, forwarding offers/answers/ICE only between users within earshot.
Spatial Audio Mixer (Web Audio API)	Adjusts gain, stereo pan, and occlusion for remote peer audio; includes master volume and a resume-audio control.
2D Virtual World (React + Canvas)	High-performance rendering of the office map and live avatar movement.


3. Architecture
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
- Positions and signaling travel over Socket.IO through the server.
- Audio flows directly browser-to-browser (WebRTC), never through the server.
- The server's only job in the audio path is deciding who is close enough to
  be connected, using a MongoDB $near query.
4. Tech Stack
Layer	Technology
Frontend	React 19, Vite, HTML5 Canvas, WebRTC (getUserMedia, RTCPeerConnection), Socket.IO client
Backend	Node.js, Express 5, Socket.IO 4
Database	MongoDB (geospatial 2d index + $near)
Realtime	Socket.IO (WebSocket)
Audio	Web Audio API (distance gain, stereo panning, occlusion, master volume)


5. Project Structure
ProxiSpeak/
├── client/                     # React frontend
│   ├── src/
│   │   ├── App.jsx             # Canvas, profiles, rooms, chat, peer signaling + UI
│   │   ├── MeetingNotes.jsx    # Shared Meeting Room notes and action items
│   │   ├── BreakoutRooms.jsx   # Meeting Room breakout controls and chat
│   │   ├── useVoiceChat.js     # Microphone, spatial mixer, volume, audio resume
│   │   ├── useScreenShare.js   # Meeting Room screen sharing
│   │   ├── App.css             # Styling
│   │   ├── main.jsx            # React entry point
│   │   └── index.css
│   ├── index.html
│   └── vite.config.js
│
├── server/                     # Node.js backend
│   ├── index.js                # Express + Socket.IO: presence, chat, movement + signaling
│   ├── lib/db.js               # MongoDB connection helper
│   ├── lib/player-persistence.js # Position, profile and reconnect persistence
│   ├── lib/rooms.js             # Room membership and presence snapshots
│   ├── lib/meeting-call.js      # Meeting call membership and signaling rules
│   ├── lib/meeting-notes.js     # Meeting notes persistence and authorized events
│   ├── lib/breakout-rooms.js    # Breakout membership, host controls and chat
│   ├── lib/proximity.js         # Pure-JS proximity oracle
│   ├── tests/                   # Backend unit tests
│   └── audit.js                # Spatial audit — correctness + latency benchmark
│
├── docs/WebRTC-Research.md     # WebRTC research notes
├── docs/MID-REVIEW.md          # Mid-review run-book + evidence checklist
└── README.md
6. How It Works
1. Connect. A browser opens a Socket.IO connection; the server assigns it a
   non-overlapping spawn slot and stores the player in MongoDB with a
   location: [x, y] field. Players enter the Lounge by default and can switch
   between the Lounge, Meeting Room, and Focus Space.
   The online-player list reports each connected player's current room.
2. Profile. Players can save a display name and allow-listed avatar color.
   On later connections in the same browser, the saved display name is sent
   again so the server can restore a unique inactive player record and its
   preferences. Profile updates are scoped to the active socket; restoration
   claims only a unique inactive record.
3. Move. The client moves the avatar locally (WASD / arrow keys, with
   furniture collision) and broadcasts player:move (throttled ~40 ms). The
   server clamps the position, persists it, and broadcasts player:moved.
4. Proximity. On each changed position the server runs a MongoDB $near query with a
   100px $maxDistance to find who is within earshot, and emits
   player:nearby and proximity:enter / proximity:leave only for valid
   same-room peers.
5. Chat. World Chat broadcasts globally. Room chat is delivered only to
   players in the sender's current room; players in other rooms receive unread
   counts, which clear when they open that room.
6. Signaling. Clients exchange webrtc:offer / webrtc:answer / webrtc:ice
   through the server, which relays only between same-room nearby players or
   members of a validated Meeting Room call.
7. Audio. The client maintains a peer connection for nearby players and routes
   remote streams through the Web Audio mixer for distance-based gain, stereo
   pan, furniture occlusion, and master-volume control. A Resume audio action
   is shown when browser autoplay policy suspends playback.
8. Meeting calls. Players in Meeting Room can join an audio/video call. Call
   participants reuse the existing peer connections; camera tracks are
   shared only with participants in the same main or breakout room. A
   microphone track already captured for proximity audio is reused rather than
   captured again. Call
   participants can raise or lower a hand and send 👍, 👏, 😂, ❤️, or 🙌
   reactions. Hand status appears beside participant names, and reactions
   briefly appear for everyone in the Meeting Room.
9. Meeting notes. Active Meeting Room call participants share a persisted note
   and action-item list. Notes can be edited; action items have a title,
   participant assignee, optional due date, and pending/completed status. Note
   and action changes are broadcast to the call participants in real time.
10. Breakout rooms. The first call participant is the host. The host can create
    and close rooms, assign call participants, and move them back to the main
    Meeting Room; assigned participants can join or leave their room. Voice,
    video, and chat are isolated to the main group or the participant's active
    breakout room. Breakout state and chat are transient and reset when all call
    participants leave.
7. Data Model
The players collection (MongoDB):
Field	Type	Notes
socketId	string	Socket.IO connection id (primary key)
name	string	Display name
room	string	Validated space name
x, y	number	Avatar position in the 1000×600 world
location	[x, y]	Geospatial point — indexed with a 2d index (min: 0, max: 1000)
avatarPrefs	object	Validated avatar choices, currently { color: "mint" | "blue" | "violet" | "coral" | "gold" }
connected	boolean	Whether the socket session is currently connected
createdAt / updatedAt	Date	Record creation and last update timestamps

The `meetingNotes` collection stores the Meeting Room's shared record under
`_id: "Meeting Room"`, with note `content`, an `actionItems` array, and
timestamps. Each action item has a server-generated ID, title, assignee display
name, optional `YYYY-MM-DD` due date, completion status, and creation time.


Players can save their display name (1–30 characters) and avatar color from
the profile form. Preferences are stored in MongoDB and restored when exactly
one inactive record matches the returning display name. The browser remembers
the last saved display name locally so a reconnect can request that restoration.
Avatar preferences are allow-listed by the server, and profile writes are
bound to the active socket; reconnect restoration only claims a unique,
inactive record.
The active room is authoritative in the server's live session; MongoDB records
the last room alongside a movement save, but that value is not restored on
reconnect. Presence is visible across rooms; movement, proximity audio, and
chat remain isolated to players in the same room.
8. Realtime Events
Client → Server
Event	Payload
player:setName	name
player:setAvatarPrefs	{ color }
player:joinRoom	allow-listed room name
meeting:join / meeting:leave	join or leave the Meeting Room call
meeting:hand	{ raised: boolean }
meeting:reaction	{ emoji } (👍, 👏, 😂, ❤️, or 🙌)
meeting:notes:load	load the persisted note and action items
meeting:notes:update	{ content }
meeting:action:create	{ title, assignee, dueDate? }
meeting:action:update	{ id, completed }
breakout:load	load breakout state (active call participants)
breakout:create	{ name } (host only)
breakout:close	{ roomId } (host only)
breakout:assign	{ participantId, roomId } (host only)
breakout:join	{ roomId } (assigned participant)
breakout:leave	no payload (current participant)
breakout:move-back	{ participantId } (host only)
breakout:chat:send	{ text } (current breakout member)
chat:send	message text (current room)
world-chat:send	message text (World Chat)
player:move	{ x, y }
webrtc:offer	{ to, sdp }
webrtc:answer	{ to, sdp }
webrtc:ice	{ to, candidate }


Server → Client
Event	Payload
room:state	{ room, players }
meeting:participant-joined / meeting:participant-left	participant / socket id
meeting:hand	{ id, name, raised }
meeting:reaction	{ id, name, emoji }
meeting:notes:state	{ content, actionItems, updatedAt }
breakout:state	{ hostId, participants, rooms }
breakout:chat:message	breakout-scoped chat message
player:joined / player:moved / player:left	player / id
player:renamed	player
player:avatarPrefs	player
chat:message	chat message with `scope` set to `room` or `world`
chat:unread	{ room } for a message in a different room
presence:state	online players with their current room
activity:notification	validated activity item with type, player name, room, message, and server timestamp
player:nearby	array of nearby players
proximity:enter / proximity:leave	peer / peer id


Activity notifications are real-time and in-memory only. Joins and disconnects
are sent to other players in that room; room switches are sent to the source
and destination rooms; proximity entry is sent only to the player being
approached, and only on an outside-to-inside 100px transition. The client keeps
the latest 50 items in newest-first order and supports mark-all-read and clear
actions. Notifications are not stored in MongoDB.
9. Getting Started
Prerequisites: Node.js 20+, a MongoDB instance (local or Atlas).
From the repo root, pass-through scripts mirror the commands below:
npm run install:all, npm run dev:server, npm run dev:client, npm test,
npm run audit, npm run audit:local. The client and server are separate
packages, so a bare npm run … in the root will fail — use these, or cd into
the package first.

Backend
cd server
npm install
# create server/.env
echo "MONGODB_URI=your_mongodb_connection_string" > .env
npm run dev            # http://localhost:3000
Frontend
cd client
npm install
npm run dev            # http://localhost:5173
Open http://localhost:5173 in two browser windows, click Enable
microphone in each, and move the avatars within 100px to connect.
getUserMedia requires a secure context — localhost or HTTPS. Two tabs on
one machine is enough; two different machines need HTTPS (or a tunnel).

Scripts
Directory	Command	Purpose
root	npm run install:all	Install both packages
root	npm run dev:server / dev:client	Start backend / frontend
root	npm test	Run all server and client test suites
root	npm run audit / audit:local	Spatial audit (MongoDB / no MongoDB)
server	npm run dev	Start backend with nodemon
server	npm start	Start backend
server	npm test	Run all backend unit tests (profiles, chat, rooms, proximity, calls, activity)
server	npm run audit	Run the spatial audit (correctness + latency)
server	npm run audit:local	Run the spatial benchmark without MongoDB
client	npm run dev	Start the Vite dev server
client	npm run build	Production build
client	npm run lint	Run the frontend ESLint checks
client	npm test	Run activity, real-app smoke, and occlusion tests


Manual integration checks
Run npm test from server/, and npm test, npm run build, and
npm run lint from client/.
For a browser check, open two tabs at http://localhost:5173, save a profile in
one tab, then move the other tab between rooms. Confirm the online list shows
the room for each player, room chat messages do not appear in other rooms, and
the unread count clears when the relevant room is opened. Reload a tab using a
saved profile name to check profile restoration and color persistence.
For activity notifications, connect a second player in the same room and verify
the joining and disconnecting player appears once in Activity for the other
tab. Switch rooms and check the notification is visible only to players in the
source or destination room. Move into and out of 100px range, then re-enter;
the approached player should get one notification per entry, not one per
movement update. Check that Mark all read clears the badge and Clear empties
the list.
Testing
Three layers — parse/build, unit suites, and client smoke tests that render the
real app. npm test from the repo root runs the suites. See
[TESTING.md](docs/TESTING.md) for how to verify a feature and what each layer
catches.
Scaling across instances
The server runs as a single instance by default. Set REDIS_URL and it attaches
Socket.IO's Redis adapter, so several instances share rooms and events — a player
connected to one process can be heard by a player on another.
REDIS_URL=redis://localhost:6379 npm run dev:server
Each client only opens connections to its eight nearest peers in earshot
(MAX_MESH_PEERS in server/index.js). A full mesh — everyone connected to
everyone — does not scale past a few dozen people in one place, so the cap keeps
bandwidth and CPU bounded as the room fills.

The mesh is optional and fails soft: if REDIS_URL is unset, or Redis is
unreachable, the server logs it and continues as a single instance.
Deploying
Checklist before you deploy:
1. HTTPS is mandatory. getUserMedia only runs in a secure context, so the
   client must be served over HTTPS (or localhost). On plain HTTP the
   microphone button simply does nothing.
2. Set CORS_ORIGIN to your frontend's origin(s), comma-separated. Left
   unset it allows any origin.
3. Set VITE_SERVER_URL at client build time to your public server URL.
4. Add a TURN server via VITE_TURN_URL / VITE_TURN_USERNAME /
   VITE_TURN_CREDENTIAL. STUN alone fails for peers behind symmetric NATs or
   strict corporate firewalls, and it fails silently. This is the most common
   reason a WebRTC app works in a demo and breaks in production.
5. Point MONGODB_URI at your database (Atlas or self-hosted).
Both packages ship a .env.example — copy it to .env and fill it in.

Server — a Dockerfile is included:
docker build -t proxispeak-server ./server
docker run -p 3000:3000 \
  -e MONGODB_URI="mongodb+srv://..." \
  -e CORS_ORIGIN="https://app.example.com" \
  proxispeak-server
Client — npm run build in client/ writes static files to client/dist;
serve them from any static host (Netlify, Vercel, S3, nginx).

Not implemented: authentication and user-editable layout management. Not
validated: Redis multi-instance operation and production deployment.
10. Current Status

Implemented: landing page; multiplayer canvas movement; room-scoped presence,
chat, proximity and signaling; MongoDB player position/profile persistence and
reconnect recovery; avatar preferences; WebRTC proximity audio; Meeting Room
audio/video calls; screen sharing; furniture collision and sound occlusion;
spatial volume/panning controls; activity notifications; optional Redis adapter.

Not implemented or not verified by the automated suites: authentication,
user-editable room layouts, camera video outside Meeting Room calls, and live
multi-browser/Redis deployment checks. Name-based profile restoration is not
authentication. The automated test suites do not replace browser-to-browser
audio, camera, or screen-sharing checks; see [docs/TESTING.md](docs/TESTING.md).
11. Team & Roles
Member	Role	Owns
Revanth	Backend & Integration (Lead)	Signaling server, Redis mesh scaling, integration, deployment
Naseema	Database Developer	Player position persistence, reconnect recovery, room/layout data
Vivek	Frontend Developer	2D virtual world (React + Canvas), rendering, polish
Janakirani Venkatesan	WebRTC & Spatial Audio	Peer connections, Web Audio mixer, browser testing


12. Roadmap
- Add an authorized workflow to edit room layouts and furniture; current layouts
  are seeded and loaded from MongoDB but are not user-editable.
- Validate audio, meeting calls, screen sharing, and Redis scaling with
  multi-browser/manual integration checks.
- Add authentication before deploying beyond a trusted demo.
13. Project Information
- Project: ProxiSpeak — Geospatial Proximity Audio Ecosystem
- Group: 33
- Assignment Code: ITS/WEB/1322
## 14. Render Backend Deployment

1. Connect the ProxiSpeak GitHub repository to Render.
2. Select the team-approved deployment branch.
3. Choose Node as the runtime.
4. Set Root Directory to `server`.
5. Set Build Command to `npm ci`.
6. Set Start Command to `npm start`.
7. Add `MONGODB_URI` with the MongoDB Atlas connection string.
8. Set `CORS_ORIGIN` to the deployed frontend URL.
9. Deploy the web service and verify the server logs.

Keep database credentials private. Configure the frontend `VITE_SERVER_URL` with the deployed backend URL.

