# ProxiSpeak — WebRTC Research and Testing Report

## 1. Introduction

ProxiSpeak is a location-based audio web application designed to support real-time communication between users based on their proximity in a virtual environment.

The purpose of this task is to research WebRTC technology, understand its core concepts, and test its implementation for real-time voice communication between users.

This report documents the WebRTC concepts studied, browser tests performed, implementation work, and ProxiSpeak integration testing.

## 2. Microphone Access Testing

**Browser:** Google Chrome

| Test Item | Result |
|---|---|
| Microphone permission | Passed |
| Microphone access | Successful |
| Error message | None observed |

### Observation

The browser successfully requested microphone permission, and access was granted.

### Conclusion

The microphone test confirmed that browser-based microphone access worked in the tested environment.

## 3. Peer Connection Demo Testing

| Test Item | Result |
|---|---|
| Demo opened | Yes |
| Start button tested | Yes |
| Call button tested | Yes |
| Connection result | Successful |
| Error message | None observed |

### Observation

The standalone peer connection demo completed successfully during testing.

### Conclusion

The demo provided practical experience with establishing a WebRTC connection.

**Note:** This test was performed separately from the ProxiSpeak application.

## 4. WebRTC Signaling Concepts

### 4.1 Offer

An offer contains session information describing the communication capabilities proposed by the initiating peer. It is created using `createOffer()`.

### 4.2 Answer

An answer responds to a received offer. It is created using `createAnswer()` and exchanged through the signaling mechanism.

### 4.3 Signaling Server

A signaling server transfers connection setup information between peers. It does not carry the actual audio stream in a typical WebRTC peer-to-peer connection.

### 4.4 ICE Candidates

Interactive Connectivity Establishment (ICE) helps peers identify possible network paths for establishing a connection.

### 4.5 RTCPeerConnection

`RTCPeerConnection` is a browser API used to manage WebRTC peer connections, including session negotiation, media tracks, and connectivity.

## 5. ICE Candidate Testing

**Test tool:** Official WebRTC Trickle ICE sample

| Test Item | Result |
|---|---|
| Candidate gathering started | Yes |
| ICE candidates appeared | Yes |
| Gathering completed | Yes |
| Errors observed | None visible |

### Observations

- Host ICE candidates were gathered.
- A server-reflexive (`srflx`) candidate was also gathered.
- The candidate-gathering process completed successfully.

### Conclusion

The test demonstrated how WebRTC gathers possible network paths before establishing peer connectivity.

The successful gathering of candidates does not, by itself, confirm that a connection between two remote peers will succeed.

## 6. Important WebRTC API Methods

### 6.1 RTCPeerConnection

`RTCPeerConnection` manages the connection between two WebRTC peers.

### 6.2 createOffer()

The `createOffer()` method creates an offer describing the initiating peer's proposed session capabilities.

### 6.3 createAnswer()

The `createAnswer()` method creates a response to an offer received from another peer.

### 6.4 addIceCandidate()

The `addIceCandidate()` method supplies a remote ICE candidate to the peer connection to help establish connectivity.

### 6.5 API Summary

| Method / API | Purpose |
|---|---|
| RTCPeerConnection | Manages the peer connection |
| createOffer() | Creates the connection offer |
| createAnswer() | Creates an answer to an offer |
| addIceCandidate() | Adds a remote ICE candidate |

## 7. Browser Compatibility Testing Checklist

### Objective

To prepare a checklist for testing basic WebRTC functionality across different browsers.

| Test ID | Test Case | Chrome | Edge | Firefox |
|---|---|---|---|---|
| TC01 | Open the WebRTC demo | Tested | Not tested | Not tested |
| TC02 | Grant microphone permission | Tested | Not tested | Not tested |
| TC03 | Run the peer connection demo | Tested | Not tested | Not tested |
| TC04 | Gather ICE candidates | Tested | Not tested | Not tested |

### Testing Notes

- **Chrome:** Initial microphone, peer connection demo, and ICE candidate tests were completed.
- **Edge:** Testing pending.
- **Firefox:** Testing pending.

Results should be recorded only after the relevant tests have been performed.

## 8. ProxiSpeak Implementation Work

### 8.1 Frontend WebRTC Module

A `useVoiceChat.js` module was added under `client/src`.

The module includes code for:

- Requesting microphone access using `getUserMedia()`.
- Creating peer connections using `RTCPeerConnection`.
- Creating and exchanging offers and answers.
- Sending and receiving ICE candidates.
- Managing remote audio playback.
- Enabling and disabling voice chat.
- Muting the microphone and adjusting speaker volume.
- Tracking peer connection states.

**Implementation status:** Code added and tested as part of the ProxiSpeak application.

### 8.2 Backend Signaling

The `server/index.js` file includes Socket.IO event handlers for player management and WebRTC signaling.

The signaling events include:

| Event | Purpose |
|---|---|
| `voice:join` | Registers a user as a voice-chat participant |
| `voice:leave` | Removes a participant from voice chat |
| `voice:request-peer` | Requests a connection with another participant |
| `voice:peer` | Notifies a client about another voice participant |
| `voice:peer-left` | Notifies clients when a participant leaves |
| `webrtc:offer` | Relays a WebRTC offer |
| `webrtc:answer` | Relays a WebRTC answer |
| `webrtc:ice-candidate` | Relays an ICE candidate |

The backend also includes player events for movement, player names, avatar colours, and disconnect cleanup.

**Implementation status:** Signaling handlers added and tested during ProxiSpeak integration testing.

### 8.3 Dependencies

The client configuration includes:

- React
- React DOM
- Socket.IO Client
- Vite

The server configuration includes:

- Express
- Socket.IO
- CORS
- MongoDB driver
- dotenv
- nodemon

The server package configuration includes `start` and `dev` scripts pointing to `index.js`.

## 9. ProxiSpeak Integration and Multiplayer Testing

### Testing Environment

- Application: ProxiSpeak
- Frontend: Local development server
- Testing method: Two separate browser windows
- Voice proximity threshold: 100 pixels

### 9.1 Multiplayer Testing Results

| Test ID | Test Case | Result |
|---|---|---|
| TC01 | Both players appear in the same virtual office | Passed |
| TC02 | Players move between desks and enter the meeting room | Passed |
| TC03 | Player positions update in real time | Passed |
| TC04 | Nearby-player detection updates when players approach or move away | Passed |
| TC05 | WebRTC voice communication connects when players are within the 100-pixel proximity range | Passed |

### Observations

- Both browser sessions successfully appeared in the same virtual office.
- Player movement worked correctly around the office furniture.
- Players could enter the meeting room.
- Player positions updated in real time.
- Nearby-player detection responded to changes in player distance.
- Voice communication worked when players were within the configured proximity range.

### Conclusion

All five two-browser multiplayer validation checks passed during testing.

The results confirmed that the tested ProxiSpeak build supported real-time player movement, proximity detection, and nearby-player voice communication.

## 10. Remaining Work

The following activities may be considered for further validation:

1. Test WebRTC functionality in Microsoft Edge.
2. Test WebRTC functionality in Mozilla Firefox.
3. Perform additional voice-disconnection and reconnection tests.
4. Test under different network conditions.
5. Record any issues found during future testing.

These activities are additional validation tasks. They do not change the successful results of the five ProxiSpeak tests documented in Section 9.

## 11. Conclusion

The work completed provided practical experience with microphone access, WebRTC peer connection demos, ICE candidate gathering, signaling concepts, and important WebRTC APIs.

The ProxiSpeak frontend voice-chat module and backend signaling handlers were integrated and tested.

Testing with two separate browser windows confirmed that both players could enter the same virtual office, move around the environment, receive real-time position updates, detect nearby players, and communicate through WebRTC voice when within the configured 100-pixel proximity range.

**Final Testing Result:** All five ProxiSpeak multiplayer validation checks passed successfully. Additional cross-browser and network-condition testing remains available for future validation.
