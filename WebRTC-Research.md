# ProxiSpeak — WebRTC Research and Testing Report

## 1. Introduction

ProxiSpeak is a location-based audio web application designed to help users discover and listen to audio content associated with nearby places.

The purpose of this task is to research WebRTC technology and prepare the foundation for real-time voice communication between users.

This report documents the WebRTC concepts studied, browser tests performed, implementation work, and remaining integration tests.

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
The peer connection demo completed successfully during the test.

### Conclusion
The demo provided practical exposure to establishing a WebRTC connection.

**Note:** This result refers to the standalone demo, not the completed ProxiSpeak voice-chat integration.

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

**Implementation status:** Code added. End-to-end integration has not yet been verified.

### 8.2 Backend Signaling

The `server/index.js` file was updated with Socket.IO event handlers for player management and basic WebRTC signaling.

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

The backend also includes existing player events for movement, player names, avatar colours, and disconnect cleanup.

**Implementation status:** Signaling handlers added. Runtime behavior and compatibility with the frontend remain to be verified.

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

**Note:** The presence of a dependency or script does not confirm that the application has been successfully executed or integrated.

## 9. ProxiSpeak Testing Status

| Test Item | Status |
|---|---|
| Standalone microphone test | Completed |
| Standalone peer connection demo | Completed |
| ICE candidate gathering | Completed |
| WebRTC research and API study | Completed |
| Frontend voice-chat module | Code added; integration not verified |
| Backend signaling handlers | Code added; runtime not verified |
| ProxiSpeak frontend and backend integration | Pending verification |
| Two-browser ProxiSpeak voice call | Pending verification |
| Voice connection when users are nearby | Pending verification |
| Voice connection cleanup when users leave | Pending verification |

### Important Testing Note

The standalone WebRTC demo was successful. However, that result does not establish that the newly added ProxiSpeak frontend and backend code works together.

The end-to-end voice call, signaling compatibility, and nearby-player voice behavior must be verified before the integration can be marked complete.

## 10. Remaining Work

The following activities remain:

1. Verify that the frontend and backend signaling event names and payloads match.
2. Run the backend and frontend in a suitable environment.
3. Test voice communication using two browser sessions.
4. Verify offer/answer exchange and ICE candidate delivery.
5. Check microphone muting, audio playback, and peer disconnection.
6. Record the actual test results and fix any issues found.

## 11. Conclusion

The work completed so far provided practical experience with microphone access, WebRTC peer connection demos, ICE candidate gathering, and important WebRTC APIs.

The ProxiSpeak frontend voice-chat module and backend signaling handlers have also been added to prepare for voice communication.

The next priority is to verify the integration between the frontend and backend and complete end-to-end testing. Until those tests succeed, the ProxiSpeak voice-chat integration must be considered pending rather than fully completed.
