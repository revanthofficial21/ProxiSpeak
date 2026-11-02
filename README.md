PROXISPEAK — WEEK 3 CODE GUIDE
================================

Project Name:
ProxiSpeak — Geospatial Proximity Audio Ecosystem

Project Description:
ProxiSpeak is a real-time virtual collaboration application. Users appear as avatars in a shared 2D virtual office. The project uses React, Canvas, Node.js, Express, and Socket.IO. Its intended functionality includes voice communication between nearby users using WebRTC.

WEEK 3 OBJECTIVES
=================

The Week 3 code focuses on preparing and integrating proximity-based voice communication.

Main objectives:

1. Integrate WebRTC-based voice communication.
2. Request microphone access from the browser.
3. Establish peer-to-peer audio connections.
4. Exchange WebRTC offers, answers, and ICE candidates through Socket.IO signalling.
5. Provide microphone enable/disable controls.
6. Support mute/unmute functionality.
7. Provide speaker-volume controls.
8. Adjust remote audio volume based on the distance between players.
9. Handle peer connections and disconnections.
10. Prepare the application for multi-browser voice testing.

PROJECT FILES
=============

1. client/src/App.jsx

Purpose:
- Renders the virtual office and player avatars.
- Connects the frontend to the Socket.IO server.
- Handles player movement and position updates.
- Displays nearby-player information.
- Provides the voice-control interface.
- Provides microphone, mute, and speaker-volume controls.

2. client/src/useVoiceChat.js

Purpose:
- Contains the WebRTC voice-communication logic.
- Requests access to the microphone.
- Creates and manages peer connections.
- Handles WebRTC offers and answers.
- Exchanges ICE candidates through Socket.IO.
- Manages incoming audio streams.
- Supports microphone enable/disable and mute controls.
- Applies distance-based audio attenuation.
- Cleans up audio streams and peer connections when necessary.

3. server/index.js

Purpose:
- Runs the Node.js and Express backend.
- Creates the Socket.IO server.
- Manages connected players.
- Receives and broadcasts player-position updates.
- Handles player connection and disconnection events.
- Relays WebRTC signalling messages between clients.

IMPORTANT:
The server must use the same Socket.IO event names and message formats expected by the frontend voice hook. Preserve the existing player-management and movement functionality when integrating WebRTC signalling.

TECHNOLOGIES USED
=================

- React
- Vite
- JavaScript
- HTML Canvas API
- CSS
- Node.js
- Express
- Socket.IO
- WebRTC
- Web Audio API
- npm
- Git and GitHub

HOW VOICE COMMUNICATION WORKS
=============================

1. A user opens the ProxiSpeak application.
2. The frontend connects to the backend using Socket.IO.
3. The user enables the microphone and grants browser permission.
4. The application identifies nearby players using the available player-position and proximity information.
5. The clients exchange WebRTC signalling information through the server.
6. WebRTC establishes a peer-to-peer audio connection when negotiation succeeds.
7. Incoming audio is played through the browser.
8. The application adjusts remote audio volume according to player distance.
9. When a player disconnects or leaves the relevant proximity range, the application updates its connection state and handles the associated audio connection.

WEBRTC SIGNALLING
=================

WebRTC uses signalling to exchange the information required to establish a peer-to-peer connection.

Offer:
A client creates an offer describing its connection capabilities and sends it to the other client through the signalling server.

Answer:
The receiving client processes the offer, creates an answer, and returns it through the signalling server.

ICE Candidates:
ICE candidates provide possible network paths that WebRTC can use to establish the connection.

Peer Connection:
RTCPeerConnection manages the WebRTC connection between two browser clients.

Microphone:
The browser's getUserMedia API requests access to the user's microphone.

Audio Processing:
The Web Audio API can control the volume of incoming audio using audio nodes such as GainNode.

DISTANCE-BASED AUDIO ATTENUATION
================================

Distance-based audio attenuation adjusts the volume of a remote participant according to the distance between avatars.

The intended behaviour is:

- Nearby players should be easier to hear.
- Audio volume should decrease as the distance increases.
- Audio should become inaudible when the player is beyond the configured hearing range.

The current voice-hook implementation uses a distance threshold of 100 coordinate units for its attenuation calculation.

Actual audio behaviour depends on successful WebRTC connections, valid player positions, browser audio playback, and compatible frontend/backend signalling.

LOCAL SETUP
===========

Prerequisites:

- Node.js
- npm
- Visual Studio Code
- A modern browser
- Microphone access

Start the backend:

1. Open a terminal in the project directory.
2. Navigate to the server folder.
3. Install the dependencies if they are not already installed.
4. Start the backend using the script defined in server/package.json.

Example:

cd server
npm install
npm run dev

Start the frontend in a separate terminal:

cd client
npm install
npm run dev

Open the local frontend URL displayed by Vite. The default development URL is usually:

http://localhost:5173

The frontend's default backend URL in the supplied App.jsx is:

http://localhost:3000

If the project uses a different port or environment configuration, follow the actual project settings.

TESTING CHECKLIST
=================

Perform these checks before marking the Week 3 implementation as complete.

[ ] The backend starts without errors.
[ ] The frontend starts without errors.
[ ] The frontend connects to the correct backend.
[ ] Two browser windows can join the same virtual world.
[ ] Both users can see each other's avatars.
[ ] Player movement updates are synchronized.
[ ] The browser requests microphone permission.
[ ] Both users can enable their microphones.
[ ] WebRTC offers and answers are exchanged successfully.
[ ] ICE candidate exchange works.
[ ] A peer-to-peer connection is established.
[ ] Incoming audio can be heard in the other browser.
[ ] Mute and unmute work correctly.
[ ] Speaker-volume controls work correctly.
[ ] Audio volume changes as the distance between avatars changes.
[ ] Peer connections are cleaned up when users disconnect.

Do not mark a test as successful until it has actually been performed.

TROUBLESHOOTING
===============

1. Backend connection refused

Check whether the backend is running and whether the frontend is connecting to the correct port.

2. EADDRINUSE error

This error indicates that another process is already using the requested port. Identify the process before deciding whether it should be stopped. Do not start multiple backend instances on the same port.

3. Microphone access denied

Check the browser's microphone permissions and verify that the correct microphone is selected.

4. No remote audio

Check the browser console and backend terminal for errors. Verify that both clients are connected, microphone permission is granted, and the WebRTC signalling event names and payloads match on both sides.

5. Audio does not change with distance

Check whether the current positions of both players are available to the voice hook and whether the audio attenuation calculation is receiving valid coordinates.

6. Audio playback is blocked

Some browsers restrict audio playback until the user interacts with the page. Follow the application's audio-resume control if one is provided.

7. Two players appear, but voice does not work

Seeing two avatars confirms only that the relevant player-state functionality is working. It does not prove that WebRTC negotiation or audio transmission is successful.

CURRENT IMPLEMENTATION STATUS
=============================

This guide documents the intended Week 3 functionality and the responsibilities of the relevant code files.

The code must be tested in the actual project environment before the voice-communication implementation can be considered verified.

Report the results of the browser, microphone, WebRTC, and distance-based audio tests accurately. Distinguish implemented functionality from functionality that remains untested or incomplete.

END OF README
=============
