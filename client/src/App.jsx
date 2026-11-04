import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  addActivityNotification,
  getUnreadActivityCount,
  markActivityNotificationsRead,
  subscribeToActivityNotifications,
} from "./activity-notifications.js";
import useVoiceChat from "./useVoiceChat";
import useScreenShare from "./useScreenShare";
import useAudioDevices from "./useAudioDevices";
import Landing from "./Landing";
import { furnitureOf, zonesOf, plantsOf } from "./office";
import useRoomLayout from "./useRoomLayout";
import "./App.css";

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
const SPEED = 240;
const DEFAULT_AVATAR_COLOR = "#6ee7b7";

const AVATAR_RADIUS = 20;
const ROOMS = ["Lounge", "Meeting Room", "Focus Space"];

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];
if (import.meta.env.VITE_TURN_URL) {
  ICE_SERVERS.push({
    urls: import.meta.env.VITE_TURN_URL,
    username: import.meta.env.VITE_TURN_USERNAME,
    credential: import.meta.env.VITE_TURN_CREDENTIAL,
  });
}
const AVATAR_PALETTE = {
  mint: { fill: "#6ee7b7", stroke: "#34d399" },
  blue: { fill: "#93c5fd", stroke: "#60a5fa" },
  violet: { fill: "#c4b5fd", stroke: "#a78bfa" },
  coral: { fill: "#fb7185", stroke: "#f43f5e" },
  gold: { fill: "#fbbf24", stroke: "#f59e0b" },
};

async function getMeetingMedia(existingAudioTrack) {
  if (existingAudioTrack?.readyState === "live") {
    try {
      const videoStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: true,
      });

      return {
        stream: new MediaStream([
          existingAudioTrack,
          ...videoStream.getVideoTracks(),
        ]),
        warning: "",
      };
    } catch (error) {
      if (!["NotFoundError", "NotAllowedError"].includes(error.name)) {
        throw error;
      }
      return {
        stream: new MediaStream([existingAudioTrack]),
        warning:
          error.name === "NotAllowedError"
            ? "Camera permission was denied; joining with microphone only."
            : "No camera was found; joining with microphone only.",
      };
    }
  }

  try {
    return {
      stream: await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      }),
      warning: "",
    };
  } catch (error) {
    if (error.name !== "NotFoundError") throw error;

    const [audioResult, videoResult] = await Promise.allSettled([
      navigator.mediaDevices.getUserMedia({ audio: true, video: false }),
      navigator.mediaDevices.getUserMedia({ audio: false, video: true }),
    ]);
    const tracks = [];
    if (audioResult.status === "fulfilled") {
      tracks.push(...audioResult.value.getAudioTracks());
    }
    if (videoResult.status === "fulfilled") {
      tracks.push(...videoResult.value.getVideoTracks());
    }
    if (tracks.length === 0) {
      throw audioResult.reason || videoResult.reason;
    }

    const stream = new MediaStream(tracks);
    return {
      stream,
      warning:
        tracks.some((track) => track.kind === "audio") &&
        tracks.some((track) => track.kind === "video")
          ? ""
          : `No ${tracks[0].kind === "audio" ? "camera" : "microphone"} found; joining with ${tracks[0].kind}-only media.`,
    };
  }
}

const pendingOfferConnections = new WeakSet();

function sendOffer(socket, peerId, peerConnection) {
  if (pendingOfferConnections.has(peerConnection)) return;
  pendingOfferConnections.add(peerConnection);

  const offerWhenReady = () => {
    if (peerConnection.signalingState !== "stable") {
      peerConnection.addEventListener(
        "signalingstatechange",
        offerWhenReady,
        { once: true }
      );
      return;
    }

    peerConnection
      .createOffer()
      .then((offer) => peerConnection.setLocalDescription(offer))
      .then(() =>
        socket.emit("webrtc:offer", {
          to: peerId,
          sdp: peerConnection.localDescription,
        })
      )
      .then(() => pendingOfferConnections.delete(peerConnection))
      .catch((error) => {
        pendingOfferConnections.delete(peerConnection);
        console.error("Failed to create offer:", error.message);
      });
  };

  offerWhenReady();
}

function withDistanceFromPlayer(player, localPlayer) {
  const hasCoordinates =
    Number.isFinite(player?.x) &&
    Number.isFinite(player?.y) &&
    Number.isFinite(localPlayer?.x) &&
    Number.isFinite(localPlayer?.y);

  return {
    ...player,
    distance: hasCoordinates
      ? Math.round(Math.hypot(player.x - localPlayer.x, player.y - localPlayer.y))
      : null,
  };
}

function getDisplayCoordinate(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function hasSameNearbyDisplay(currentPlayers, nextPlayers) {
  return (
    currentPlayers.length === nextPlayers.length &&
    currentPlayers.every((player, index) => {
      const nextPlayer = nextPlayers[index];
      return (
        player.id === nextPlayer.id &&
        player.name === nextPlayer.name &&
        player.avatarPrefs?.color === nextPlayer.avatarPrefs?.color &&
        player.distance === nextPlayer.distance &&
        getDisplayCoordinate(player.x) === getDisplayCoordinate(nextPlayer.x) &&
        getDisplayCoordinate(player.y) === getDisplayCoordinate(nextPlayer.y)
      );
    })
  );
}

function applyLocalProfile(players, response, color, socket) {
  const localPlayer = players.get(socket.id);
  if (!localPlayer) return;

  players.set(socket.id, {
    ...localPlayer,
    name: response.name,
    avatarPrefs: response.restored ? { color } : localPlayer.avatarPrefs,
    ...(response.restored &&
    Number.isFinite(response.position?.x) &&
    Number.isFinite(response.position?.y)
      ? { x: response.position.x, y: response.position.y }
      : {}),
  });
}
// Renders one shared screen — local preview or a remote peer's stream.
function ScreenShareVideo({ share, isLocal }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    video.srcObject = share.stream || null;
    if (share.stream) {
      video.play().catch((error) => {
        console.warn("Screen share playback needs user interaction:", error);
      });
    }
    return () => {
      video.srcObject = null;
    };
  }, [share.stream]);

  return (
    <article className="screen-share-tile">
      <div className="screen-share-tile-heading">
        <strong>{isLocal ? "Your screen" : share.name}</strong>
        {isLocal && <span>Sharing</span>}
      </div>
      {share.stream ? (
        <video
          ref={videoRef}
          autoPlay
          controls
          muted={isLocal}
          playsInline
          aria-label={`${share.name}'s shared screen`}
        />
      ) : (
        <p className="screen-share-pending">Connecting to shared screen…</p>
      )}
    </article>
  );
}


function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Each piece of furniture is drawn by kind — the server validates the kind before
// it ever reaches here, so an unknown one is simply skipped.
function drawDesk(ctx, piece) {
  ctx.fillStyle = "#334155";
  roundRect(ctx, piece.x, piece.y, piece.width, piece.height, 6);
  ctx.fill();
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#0ea5e9";
  ctx.fillRect(piece.x + 44, piece.y + 10, 34, 20);
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.arc(piece.x + piece.width / 2, piece.y + piece.height + 16, 12, 0, Math.PI * 2);
  ctx.fill();
}

function drawMeetingTable(ctx, piece) {
  ctx.fillStyle = "#7c5a1e";
  roundRect(ctx, piece.x, piece.y, piece.width, piece.height, 14);
  ctx.fill();
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#1e293b";
  const seats = Math.max(2, Math.floor(piece.width / 70));
  const step = seats > 1 ? (piece.width - 90) / (seats - 1) : 0;
  for (let i = 0; i < seats; i += 1) {
    const cx = piece.x + 45 + i * step;
    ctx.beginPath();
    ctx.arc(cx, piece.y - 14, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, piece.y + piece.height + 14, 11, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDiscussionTable(ctx, piece) {
  const cx = piece.x + piece.width / 2;
  const cy = piece.y + piece.height / 2;
  const radius = piece.width / 2;

  ctx.fillStyle = "#3b3560";
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#a78bfa";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#1e293b";
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * (radius + 13),
      cy + Math.sin(angle) * (radius + 13),
      10,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
}

function drawGameTable(ctx, piece) {
  ctx.fillStyle = "#14532d";
  roundRect(ctx, piece.x, piece.y, piece.width, piece.height, 10);
  ctx.fill();
  ctx.strokeStyle = "#4ade80";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawSofa(ctx, piece) {
  ctx.fillStyle = "#334155";
  roundRect(ctx, piece.x, piece.y, piece.width, piece.height, 10);
  ctx.fill();
  ctx.strokeStyle = "#475569";
  ctx.lineWidth = 2;
  ctx.stroke();
}

const FURNITURE_DRAWERS = {
  desk: drawDesk,
  "meeting-table": drawMeetingTable,
  "discussion-table": drawDiscussionTable,
  "game-table": drawGameTable,
  sofa: drawSofa,
};

// Draws the whole office: floor grid, named zones, furniture and walls. The layout
// comes from the server when it is available, and from the built-in copy otherwise.
function drawOffice(ctx, layout) {
  const zones = zonesOf(layout);
  const furniture = furnitureOf(layout);
  const plants = plantsOf(layout);

  ctx.fillStyle = "#0f1622";
  ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

  ctx.strokeStyle = "rgba(148, 163, 184, 0.06)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD_WIDTH; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= WORLD_HEIGHT; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD_WIDTH, y);
    ctx.stroke();
  }

  for (const zone of zones) {
    ctx.fillStyle = zone.tint;
    ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = zone.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(zone.x + 1, zone.y + 1, zone.w - 2, zone.h - 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = zone.accent;
    ctx.font = "bold 11px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(zone.name.toUpperCase(), zone.x + 12, zone.y + 22);
  }

  for (const piece of furniture) {
    const draw = FURNITURE_DRAWERS[piece.kind];
    if (draw) draw(ctx, piece);
  }

  for (const plant of plants) {
    ctx.fillStyle = "#1f3a2c";
    ctx.beginPath();
    ctx.arc(plant.x, plant.y, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.strokeStyle = "#1e293b";
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, WORLD_WIDTH - 10, WORLD_HEIGHT - 10);
  ctx.lineWidth = 1;
}

function hitsObstacle(x, y, furniture) {
  return furniture.some((obstacle) => {
    const closestX = Math.max(
      obstacle.x,
      Math.min(x, obstacle.x + obstacle.width)
    );
    const closestY = Math.max(
      obstacle.y,
      Math.min(y, obstacle.y + obstacle.height)
    );
    const distanceX = x - closestX;
    const distanceY = y - closestY;

    return (
      distanceX * distanceX + distanceY * distanceY <
      AVATAR_RADIUS * AVATAR_RADIUS
    );
  });
}

export default function App() {
  const canvasRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const socketRef = useRef(null);
  const keysRef = useRef({});
  const gameFocusedRef = useRef(false);
  const playersRef = useRef(new Map());
  const nearbyRef = useRef(new Set());
  const peersRef = useRef(new Map());
  const pendingPeersRef = useRef(new Set());
  const pendingOffersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const profileSyncSocketRef = useRef(null);
  const audioEnabledRef = useRef(false);
  const meetingStreamRef = useRef(null);
  const meetingAudioTrackRef = useRef(null);
  const meetingParticipantsRef = useRef(new Set());
  const meetingCallActiveRef = useRef(false);
  const localMeetingVideoRef = useRef(null);
  const meetingReactionTimersRef = useRef(new Map());
  const meetingReactionIdRef = useRef(0);


  const [showLanding, setShowLanding] = useState(true);
  const [activeView, setActiveView] = useState("office");
  const [micDeviceId, setMicDeviceId] = useState("");
  const [speakerDeviceId, setSpeakerDeviceId] = useState("");
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [appPeerStates, setAppPeerStates] = useState({});
  const [playerCount, setPlayerCount] = useState(0);
  const [players, setPlayers] = useState([]);
  const [nearbyPlayers, setNearbyPlayers] = useState([]);
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem("proxispeak.playerName") || ""
  );
  const [avatarColor, setAvatarColor] = useState("mint");
  const [avatarPrefsDirty, setAvatarPrefsDirty] = useState(false);
  const [nameError, setNameError] = useState("");
  const [meetingCallJoined, setMeetingCallJoined] = useState(false);
  const [meetingCallBusy, setMeetingCallBusy] = useState(false);
  const [meetingStream, setMeetingStream] = useState(null);
  const [remoteVideoStreams, setRemoteVideoStreams] = useState({});
  const [meetingMicEnabled, setMeetingMicEnabled] = useState(true);
  const [meetingCameraEnabled, setMeetingCameraEnabled] = useState(true);
  const [meetingHasMicrophone, setMeetingHasMicrophone] = useState(false);
  const [meetingHasCamera, setMeetingHasCamera] = useState(false);
  const [meetingCallError, setMeetingCallError] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatError, setChatError] = useState("");
  const [currentRoom, setCurrentRoom] = useState(ROOMS[0]);
  const [roomSwitching, setRoomSwitching] = useState(false);
  const [onlinePlayers, setOnlinePlayers] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [activityNotifications, setActivityNotifications] = useState([]);
  const currentRoomRef = useRef(currentRoom);
  const unreadActivityCount = getUnreadActivityCount(activityNotifications);

  const [savedName, setSavedName] = useState("");
  const [status, setStatus] = useState("");
  const [savedStatus, setSavedStatus] = useState("");
  const [statusError, setStatusError] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [rooms, setRooms] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState("");
  // The room's furniture comes from the server; the built-in copy is the fallback.
  const roomId =
    rooms.find((room) => room.name === activeRoomId)?.id || "open-world";
  const { layout, layoutRef } = useRoomLayout(roomId);
  const [roomsError, setRoomsError] = useState("");
  const [roomError, setRoomError] = useState("");
  const [meetingParticipants, setMeetingParticipants] = useState([]);
  const [meetingHandRaised, setMeetingHandRaised] = useState(false);
  const [meetingReactions, setMeetingReactions] = useState([]);

  const {
    voiceEnabled,
    voiceStatus,
    peerLevels,
    micLevel,
    muted,
    speakerVolume,
    audioOutputBlocked,
    enableVoice,
    disableVoice,
    toggleMute,
    changeSpeakerVolume,
    changeOutputDevice,
    resumeAudio,
    streamRef: localStreamRef,
    attachRemoteStream,
    detachRemoteStream,
  } = useVoiceChat(socket, playersRef, {
    micDeviceId,
    obstacles: furnitureOf(layout),
    preserveTrackRef: meetingAudioTrackRef,
    meetingParticipantsRef,
  });
  const peerStates = appPeerStates;

  const { microphones, speakers } = useAudioDevices(voiceEnabled);

  const {
    isSharing,
    startingShare,
    screenShares,
    screenShareError,
    startScreenShare,
    stopScreenShare,
  } = useScreenShare(socket, activeRoomId);

  const updatePlayerCount = useCallback(() => {
    setPlayerCount(playersRef.current.size);
  }, []);

  // Tear down a single peer connection and its audio mix.
  const closePeer = useCallback((peerId) => {
    pendingPeersRef.current.delete(peerId);
    pendingOffersRef.current.delete(peerId);
    pendingCandidatesRef.current.delete(peerId);

    const pc = peersRef.current.get(peerId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peersRef.current.delete(peerId);
    }

    detachRemoteStream(peerId);

    setRemoteVideoStreams((current) => {
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });

    setAppPeerStates((current) => {
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, [detachRemoteStream]);

  // Create (or return) the RTCPeerConnection for a nearby peer.
  const createPeer = useCallback((peerId, initiator) => {
    const socket = socketRef.current;
    if (!socket) return null;

    const existingPeer = peersRef.current.get(peerId);
    const pc = existingPeer || new RTCPeerConnection({ iceServers: ICE_SERVERS });
    let addedMeetingTrack = false;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        if (
          !pc.getSenders().some((sender) => sender.track?.id === track.id)
        ) {
          pc.addTrack(track, localStreamRef.current);
        }
      });
    }

    if (meetingParticipantsRef.current.has(peerId) && meetingStreamRef.current) {
      meetingStreamRef.current.getTracks().forEach((track) => {
        if (
          pc.getSenders().some((sender) => sender.track?.id === track.id)
        ) {
          return;
        }
        pc.addTrack(track, meetingStreamRef.current);
        addedMeetingTrack = true;
      });
    }

    if (existingPeer) {
      if (addedMeetingTrack && initiator) sendOffer(socket, peerId, pc);
      return pc;
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc:ice", { to: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;

      attachRemoteStream(peerId, stream);
      const refreshPeerStatus = () => {
        setAppPeerStates((current) => ({
          ...current,
          [peerId]: {
            connectionState:
              peersRef.current.get(peerId)?.connectionState ||
              current[peerId]?.connectionState ||
              "closed",
            receivingAudio: stream
              .getAudioTracks()
              .some(
                (track) =>
                  track.readyState === "live" && track.enabled && !track.muted
              ),
          },
        }));
      };
      stream.getAudioTracks().forEach((track) => {
        track.onmute = refreshPeerStatus;
        track.onunmute = refreshPeerStatus;
        track.onended = refreshPeerStatus;
      });
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        setRemoteVideoStreams((current) => ({
          ...current,
          [peerId]: stream,
        }));
        videoTracks.forEach((track) => {
          track.onended = () => {
            setRemoteVideoStreams((current) => {
              if (!(peerId in current)) return current;
              const next = { ...current };
              delete next[peerId];
              return next;
            });
          };
        });
      }
      refreshPeerStatus();
    };

    pc.onconnectionstatechange = () => {
      setAppPeerStates((current) => ({
        ...current,
        [peerId]: {
          connectionState: pc.connectionState,
          receivingAudio: current[peerId]?.receivingAudio || false,
        },
      }));
    };

    peersRef.current.set(peerId, pc);
    setAppPeerStates((current) => ({
      ...current,
      [peerId]: {
        connectionState: pc.connectionState,
        receivingAudio: current[peerId]?.receivingAudio || false,
      },
    }));

    // The peer with the lower id offers, so both sides agree who initiates.
    if (initiator) {
      sendOffer(socket, peerId, pc);
    }

    return pc;
  }, [attachRemoteStream, localStreamRef]);

  // Apply ICE candidates that arrived before the remote description was set.
  const flushCandidates = useCallback(async (peerId, pc) => {
    const queue = pendingCandidatesRef.current.get(peerId);
    if (!queue || queue.length === 0) return;

    pendingCandidatesRef.current.delete(peerId);
    for (const candidate of queue) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error("Failed to add buffered ICE candidate:", error.message);
      }
    }
  }, []);

  const answerOffer = useCallback(
    async (from, sdp) => {
      const pc = createPeer(from, false);
      if (!pc) return;

      try {
        await pc.setRemoteDescription(sdp);
        await flushCandidates(from, pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current?.emit("webrtc:answer", {
          to: from,
          sdp: pc.localDescription,
        });
      } catch (error) {
        console.error("Failed to handle offer:", error.message);
      }
    },
    [createPeer, flushCandidates]
  );

  const handleOffer = useCallback(
    ({ from, sdp }) => {
      if (typeof from !== "string" || !sdp) return;

      // If our mic isn't on yet, hold the offer until it is — otherwise we'd
      // answer without our audio track and could never be heard.
      if (
        !audioEnabledRef.current &&
        !meetingCallActiveRef.current
      ) {
        pendingOffersRef.current.set(from, sdp);
        return;
      }

      answerOffer(from, sdp);
    },
    [answerOffer]
  );

  const handleAnswer = useCallback(
    async ({ from, sdp }) => {
      const pc = peersRef.current.get(from);
      if (!pc || !sdp) return;

      try {
        await pc.setRemoteDescription(sdp);
        await flushCandidates(from, pc);
      } catch (error) {
        console.error("Failed to handle answer:", error.message);
      }
    },
    [flushCandidates]
  );

  const handleIce = useCallback(async ({ from, candidate }) => {
    if (typeof from !== "string" || !candidate) return;

    const pc = peersRef.current.get(from);

    // Buffer until the peer exists and its remote description is set — an
    // addIceCandidate before that throws and the candidate would be lost.
    if (!pc || !pc.remoteDescription) {
      const queue = pendingCandidatesRef.current.get(from) || [];
      queue.push(candidate);
      pendingCandidatesRef.current.set(from, queue);
      return;
    }

    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      console.error("Failed to add ICE candidate:", error.message);
    }
  }, []);

  useEffect(() => {
    audioEnabledRef.current = voiceEnabled;
    if (!voiceEnabled) {
      for (const peerId of peersRef.current.keys()) {
        if (!meetingParticipantsRef.current.has(peerId)) closePeer(peerId);
      }
      return;
    }

    const activeSocket = socketRef.current;
    if (!activeSocket) return;

    const pending = new Set([
      ...pendingPeersRef.current,
      ...nearbyRef.current,
    ]);
    pendingPeersRef.current.clear();
    pending.forEach((peerId) =>
      createPeer(peerId, activeSocket.id < peerId)
    );

    const offers = Array.from(pendingOffersRef.current.entries());
    pendingOffersRef.current.clear();
    offers.forEach(([from, sdp]) => answerOffer(from, sdp));
  }, [voiceEnabled, createPeer, answerOffer, closePeer]);

  const removeMeetingTracks = useCallback((peerId) => {
    const pc = peersRef.current.get(peerId);
    if (!pc || !meetingStreamRef.current) return;

    let removedTrack = false;
    const meetingTrackIds = new Set(
      meetingStreamRef.current.getTracks().map((track) => track.id)
    );
    for (const sender of pc.getSenders()) {
      if (!sender.track || !meetingTrackIds.has(sender.track.id)) continue;
      if (
        sender.track === meetingAudioTrackRef.current &&
        audioEnabledRef.current
      ) {
        continue;
      }
      pc.removeTrack(sender);
      removedTrack = true;
    }

    if (!nearbyRef.current.has(peerId)) {
      closePeer(peerId);
      return;
    }

    const socket = socketRef.current;
    if (
      removedTrack &&
      socket?.id &&
      socket.id < peerId &&
      pc.signalingState === "stable"
    ) {
      sendOffer(socket, peerId, pc);
    }
  }, [closePeer]);

  const clearMeetingReactions = useCallback(() => {
    for (const timer of meetingReactionTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    meetingReactionTimersRef.current.clear();
    setMeetingReactions([]);
  }, []);

  const cleanupMeetingCall = useCallback((notifyServer = true) => {
    if (notifyServer) socketRef.current?.emit("meeting:leave");
    clearMeetingReactions();
    const participantIds = Array.from(meetingParticipantsRef.current);
    meetingCallActiveRef.current = false;
    meetingParticipantsRef.current.clear();

    participantIds.forEach(removeMeetingTracks);

    const audioTrack = meetingAudioTrackRef.current;
    for (const track of meetingStreamRef.current?.getTracks() || []) {
      if (track === audioTrack && audioEnabledRef.current) continue;
      track.stop();
    }
    meetingStreamRef.current = null;
    setMeetingStream(null);
    if (!audioEnabledRef.current) meetingAudioTrackRef.current = null;

    if (localMeetingVideoRef.current) {
      localMeetingVideoRef.current.srcObject = null;
    }
    setMeetingCallJoined(false);
    setMeetingParticipants([]);
    setMeetingHandRaised(false);
    setRemoteVideoStreams({});
    setMeetingMicEnabled(false);
    setMeetingCameraEnabled(false);
    setMeetingHasMicrophone(false);
    setMeetingHasCamera(false);
    setMeetingCallError("");
  }, [clearMeetingReactions, removeMeetingTracks]);

  const toggleMeetingHand = useCallback(() => {
    const raised = !meetingHandRaised;
    setMeetingHandRaised(raised);
    socketRef.current?.emit("meeting:hand", { raised }, (response) => {
      if (response?.success) return;
      setMeetingHandRaised(!raised);
      setMeetingCallError(
        response?.error || "Could not update your hand status."
      );
    });
  }, [meetingHandRaised]);

  const sendMeetingReaction = useCallback((emoji) => {
    socketRef.current?.emit("meeting:reaction", { emoji }, (response) => {
      if (response?.success) return;
      setMeetingCallError(response?.error || "Could not send your reaction.");
    });
  }, []);

  const joinMeetingCall = useCallback(async () => {
    if (currentRoom !== "Meeting Room" || meetingCallBusy) return;
    const socket = socketRef.current;
    if (!socket?.connected) return;

    setMeetingCallBusy(true);
    setMeetingCallError("");
    let acquiredStream;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMeetingCallBusy(false);
      setMeetingCallError(
        "Microphone and camera access requires a secure browser context."
      );
      return;
    }

    try {
      const existingAudioTrack =
        localStreamRef.current?.getAudioTracks()[0] ||
        (meetingAudioTrackRef.current?.readyState === "live"
          ? meetingAudioTrackRef.current
          : null);
      const media = await getMeetingMedia(existingAudioTrack);
      acquiredStream = media.stream;
      meetingStreamRef.current = acquiredStream;
      setMeetingStream(acquiredStream);
      meetingAudioTrackRef.current =
        acquiredStream.getAudioTracks()[0] || null;
      setMeetingHasMicrophone(acquiredStream.getAudioTracks().length > 0);
      setMeetingHasCamera(acquiredStream.getVideoTracks().length > 0);
      acquiredStream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          setMeetingHasMicrophone(false);
          setMeetingMicEnabled(false);
          setMeetingCallError("The microphone disconnected.");
        };
      });
      acquiredStream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setMeetingHasCamera(false);
          setMeetingCameraEnabled(false);
          setMeetingCallError("The camera disconnected.");
        };
      });
      setMeetingMicEnabled(
        acquiredStream.getAudioTracks()[0]?.enabled === true
      );
      setMeetingCameraEnabled(
        acquiredStream.getVideoTracks()[0]?.enabled === true
      );
      if (media.warning) setMeetingCallError(media.warning);

      socket.timeout(10000).emit("meeting:join", (timeoutError, response) => {
        setMeetingCallBusy(false);
        if (timeoutError || !response?.success) {
          const sharedTrack = existingAudioTrack;
          for (const track of acquiredStream.getTracks()) {
            if (track !== sharedTrack || !audioEnabledRef.current) {
              track.stop();
            }
          }
          meetingStreamRef.current = null;
          setMeetingStream(null);
          meetingAudioTrackRef.current = audioEnabledRef.current
            ? sharedTrack
            : null;
          setMeetingMicEnabled(false);
          setMeetingCameraEnabled(false);
          setMeetingHasMicrophone(false);
          setMeetingHasCamera(false);
          setMeetingCallError(
            response?.error ||
              (timeoutError
                ? "The meeting call request timed out."
                : "Could not join the meeting call.")
          );
          return;
        }

        meetingCallActiveRef.current = true;
        const participants = Array.isArray(response.participants)
          ? response.participants.filter(
              (participant) =>
                participant &&
                typeof participant.id === "string" &&
                participant.id !== socket.id
            )
          : [];
        meetingParticipantsRef.current = new Set(
          participants.map((participant) => participant.id)
        );
        setMeetingParticipants(participants);
        setMeetingHandRaised(
          participants.find((participant) => participant.id === socket.id)
            ?.handRaised === true
        );
        setMeetingCallJoined(true);
        participants.forEach((participant) =>
          createPeer(participant.id, socket.id < participant.id)
        );
      });
    } catch (error) {
      if (acquiredStream) {
        const sharedTrack = localStreamRef.current?.getAudioTracks()[0];
        acquiredStream.getTracks().forEach((track) => {
          if (track !== sharedTrack || !audioEnabledRef.current) track.stop();
        });
      }
      meetingStreamRef.current = null;
      setMeetingStream(null);
      meetingAudioTrackRef.current =
        localStreamRef.current?.getAudioTracks()[0] || null;
      setMeetingHasMicrophone(false);
      setMeetingHasCamera(false);
      setMeetingCallBusy(false);
      setMeetingCallError(
        error.name === "NotAllowedError" || error.name === "SecurityError"
          ? "Microphone or camera permission was denied. Check browser permissions."
          : error.message || "Could not access a microphone or camera."
      );
    }
  }, [createPeer, currentRoom, meetingCallBusy, localStreamRef]);

  const toggleMeetingMicrophone = useCallback(() => {
    const tracks = meetingStreamRef.current?.getAudioTracks() || [];
    const track = tracks.find((candidate) => candidate.readyState === "live");
    if (!track) return;
    const nextEnabled = !track.enabled;
    tracks.forEach((candidate) => {
      candidate.enabled = nextEnabled;
    });
    setMeetingMicEnabled(nextEnabled);
    if (audioEnabledRef.current && muted !== !nextEnabled) toggleMute();
  }, [muted, toggleMute]);

  const toggleMeetingCamera = useCallback(() => {
    const tracks = meetingStreamRef.current?.getVideoTracks() || [];
    const track = tracks.find((candidate) => candidate.readyState === "live");
    if (!track || track.readyState !== "live") return;
    const nextEnabled = !track.enabled;
    tracks.forEach((candidate) => {
      candidate.enabled = nextEnabled;
    });
    setMeetingCameraEnabled(nextEnabled);
  }, []);

  const setName = useCallback((event) => {
    event.preventDefault();
    const name = playerName.trim();
    if (!name) {
      setNameError("Enter a player name.");
      return;
    }

    const socket = socketRef.current;
    if (!socket?.connected) {
      setNameError("Connect to the server before setting your name.");
      return;
    }

    socket.emit("player:setName", name, (response) => {
      if (!response?.success) {
        setNameError(response?.error || "Could not save your name.");
        return;
      }
      setPlayerName(response.name);
      localStorage.setItem("proxispeak.playerName", response.name);
      const selectedColor =
        response.restored && !avatarPrefsDirty
          ? response.avatarPrefs?.color || "mint"
          : avatarColor;
      applyLocalProfile(playersRef.current, response, selectedColor, socket);

      if (response.restored && !avatarPrefsDirty) {
        setAvatarColor(selectedColor);
        localStorage.setItem("proxispeak.avatarColor", selectedColor);
        setAvatarPrefsDirty(false);
        setNameError("");
        return;
      }

      socket.emit(
        "player:setAvatarPrefs",
        { color: selectedColor },
        (prefsResponse) => {
          if (!prefsResponse?.success) {
            setNameError(
              prefsResponse?.error || "Could not save avatar preferences."
            );
            return;
          }
          localStorage.setItem("proxispeak.avatarColor", selectedColor);
          setAvatarPrefsDirty(false);
          setNameError("");
        }
      );
    });
  }, [avatarColor, avatarPrefsDirty, playerName]);

  const sendChatMessage = useCallback((event) => {
    event.preventDefault();
    const text = chatDraft.trim();
    const socket = socketRef.current;
    if (!text || !socket?.connected) return;

    socket.emit("chat:send", text, (response) => {
      if (!response?.success) {
        setChatError(response?.error || "Could not send message.");
        return;
      }
      setChatDraft("");
      setChatError("");
    });
  }, [chatDraft]);

  const joinRoom = useCallback((event) => {
    const room = event.target.value;
    const socket = socketRef.current;
    if (!socket?.connected || !ROOMS.includes(room)) return;

    setRoomSwitching(true);
    setRoomError("");
    if (meetingCallJoined && room !== currentRoom) cleanupMeetingCall();
    socket.emit("player:joinRoom", room, (response) => {
      setRoomSwitching(false);
      if (!response?.success) {
        setRoomError(response?.error || "Could not switch rooms.");
        return;
      }
      clearMeetingReactions();
      setCurrentRoom(response.room);
      currentRoomRef.current = response.room;
      setUnreadCounts((current) => ({ ...current, [response.room]: 0 }));
    });
  }, [cleanupMeetingCall, clearMeetingReactions, currentRoom, meetingCallJoined]);

  // Socket.IO connection and multiplayer events
  useEffect(() => {
    const peers = peersRef.current;
    const reactionTimers = meetingReactionTimersRef.current;
    const client = io(SERVER_URL);
    const socket = client;
    const handleActivityNotification = (notification) => {
      setActivityNotifications((current) =>
        addActivityNotification(current, notification)
      );
    };
    socketRef.current = client;
    setSocket(client);

    client.on("connect", () => setConnected(true));
    client.on("disconnect", () => {
      setConnected(false);
      profileSyncSocketRef.current = null;
      setOnlinePlayers([]);
      setNearbyPlayers([]);
      nearbyRef.current = new Set();
      playersRef.current.clear();
      cleanupMeetingCall(false);
      meetingAudioTrackRef.current = null;
      audioEnabledRef.current = false;
      for (const peerId of peersRef.current.keys()) closePeer(peerId);
      pendingPeersRef.current.clear();
      pendingOffersRef.current.clear();
      pendingCandidatesRef.current.clear();
      updatePlayerCount();
    });

    socket.on("room:state", ({ room, players } = {}) => {
      if (!ROOMS.includes(room) || !Array.isArray(players)) return;

      playersRef.current = new Map(
        players
          .filter((player) => player && typeof player.id === "string")
          .map((player) => [player.id, player])
      );
      nearbyRef.current.clear();
      for (const peerId of peersRef.current.keys()) closePeer(peerId);
      pendingPeersRef.current.clear();
      pendingOffersRef.current.clear();
      pendingCandidatesRef.current.clear();
      setCurrentRoom(room);
      currentRoomRef.current = room;
      setUnreadCounts((current) => ({ ...current, [room]: 0 }));
      setNearbyPlayers([]);
      setChatMessages([]);
      setRoomError("");
      updatePlayerCount();

      if (profileSyncSocketRef.current !== socket.id) {
        profileSyncSocketRef.current = socket.id;
        const savedName = localStorage
          .getItem("proxispeak.playerName")
          ?.trim();
        if (savedName) {
          socket.emit("player:setName", savedName, (response) => {
            if (!response?.success) {
              profileSyncSocketRef.current = null;
              setNameError(response?.error || "Could not restore your profile.");
              return;
            }

            const savedColor = localStorage.getItem(
              "proxispeak.avatarColor"
            );
            const color = response.restored
              ? response.avatarPrefs?.color || "mint"
              : Object.prototype.hasOwnProperty.call(AVATAR_PALETTE, savedColor)
                ? savedColor
                : "mint";
            applyLocalProfile(playersRef.current, response, color, socket);
            setPlayerName(response.name);
            setAvatarColor(color);
            localStorage.setItem("proxispeak.playerName", response.name);
            localStorage.setItem("proxispeak.avatarColor", color);

            if (!response.restored) {
              socket.emit("player:setAvatarPrefs", { color }, (prefsResponse) => {
                if (!prefsResponse?.success) {
                  setNameError(
                    prefsResponse?.error || "Could not restore avatar preferences."
                  );
                }
              });
            }
          });
        }
      }
    });

    socket.on("world:state", (players) => {
      if (!Array.isArray(players)) return;
      playersRef.current = new Map(
        players
          .filter((player) => player && typeof player.id === "string")
          .map((player) => [player.id, player])
      );
      setPlayers(Array.from(playersRef.current.values()));
      updatePlayerCount();
    });

    socket.on("presence:state", (players) => {
      if (!Array.isArray(players)) return;
      setOnlinePlayers(
        players.filter(
          (player) =>
            player &&
            typeof player.id === "string" &&
            ROOMS.includes(player.room)
        )
      );
    });

    socket.on("player:joined", (player) => {
      if (
        !player ||
        typeof player.id !== "string" ||
        player.room !== currentRoomRef.current
      ) {
        return;
      }
      playersRef.current.set(player.id, player);
      setPlayers(Array.from(playersRef.current.values()));
      updatePlayerCount();
    });
    socket.on("player:moved", (player) => {
      if (!player || typeof player.id !== "string" || player.id === socket.id) {
        return;
      }
      playersRef.current.set(player.id, player);
      if (nearbyRef.current.has(player.id)) {
        const updatedNearbyPlayer = withDistanceFromPlayer(
          player,
          playersRef.current.get(socket.id)
        );
        setNearbyPlayers((current) => {
          const index = current.findIndex(
            (nearbyPlayer) => nearbyPlayer.id === player.id
          );
          if (index === -1) return current;

          const next = [...current];
          next[index] = updatedNearbyPlayer;
          return hasSameNearbyDisplay(current, next) ? current : next;
        });
      }
      updatePlayerCount();

    });
    socket.on("player:renamed", (player) => {
      if (!player || typeof player.id !== "string") return;
      const existing = playersRef.current.get(player.id);
      const updatedPlayer =
        player.id === socket.id && existing
          ? { ...existing, name: player.name }
          : player;
      playersRef.current.set(player.id, updatedPlayer);
      setPlayers(Array.from(playersRef.current.values()));
      setMeetingParticipants((current) =>
        current.map((participant) =>
          participant.id === player.id
            ? { ...participant, name: player.name }
            : participant
        )
      );
      const updatedNearbyPlayer = withDistanceFromPlayer(
        updatedPlayer,
        playersRef.current.get(socket.id)
      );
      setNearbyPlayers((current) =>
        current.map((nearbyPlayer) =>
          nearbyPlayer.id === player.id ? updatedNearbyPlayer : nearbyPlayer
        )
      );
    });

    socket.on("player:avatarPrefs", (player) => {
      if (!player || typeof player.id !== "string") return;
      playersRef.current.set(player.id, player);
      const updatedPlayer = withDistanceFromPlayer(
        player,
        playersRef.current.get(socket.id)
      );
      setNearbyPlayers((current) =>
        current.map((nearbyPlayer) =>
          nearbyPlayer.id === player.id ? updatedPlayer : nearbyPlayer
        )
      );
    });

    socket.on("chat:message", (message) => {
      if (
        !message ||
        (typeof message.id !== "string" &&
          !Number.isSafeInteger(message.id)) ||
        typeof message.senderName !== "string" ||
        typeof message.text !== "string" ||
        (message.scope !== "world" && message.scope !== "room")
      ) {
        return;
      }
      if (message.scope === "world") {
        setMessages((current) => [...current.slice(-199), message]);
      } else if (message.room === currentRoomRef.current) {
        setChatMessages((current) => [...current.slice(-99), message]);
      }
    });

    socket.on("player:status", ({ id, status: nextStatus } = {}) => {
      if (typeof id !== "string") return;
      const existing = playersRef.current.get(id);
      if (!existing) return;

      const updatedPlayer = { ...existing, status: nextStatus || "" };
      playersRef.current.set(id, updatedPlayer);
      setPlayers(Array.from(playersRef.current.values()));
      setNearbyPlayers((current) =>
        current.map((player) =>
          player.id === id ? { ...player, status: updatedPlayer.status } : player
        )
      );
    });

    socket.on("chat:unread", ({ room } = {}) => {
      if (!ROOMS.includes(room) || room === currentRoomRef.current) return;
      setUnreadCounts((current) => ({
        ...current,
        [room]: (current[room] || 0) + 1,
      }));
    });

    const unsubscribeActivityNotifications =
      subscribeToActivityNotifications(socket, handleActivityNotification);

    socket.on("player:nearby", (list) => {
      const safe = Array.isArray(list)
        ? list.filter(
            (player) =>
              player &&
              typeof player.id === "string" &&
              Number.isFinite(player.x) &&
              Number.isFinite(player.y)
          )
        : [];
      const localPlayer = playersRef.current.get(socket.id);
      const nextNearbyPlayers = safe.map((player) =>
        withDistanceFromPlayer(player, localPlayer)
      );
      nearbyRef.current = new Set(safe.map((player) => player.id));
      setNearbyPlayers((current) =>
        hasSameNearbyDisplay(current, nextNearbyPlayers)
          ? current
          : nextNearbyPlayers
      );
    });

    socket.on("player:avatarColorUpdated", (player) => {
      if (!player || typeof player.id !== "string") return;
      const existing = playersRef.current.get(player.id);
      playersRef.current.set(
        player.id,
        existing ? { ...existing, avatarColor: player.avatarColor } : player
      );
      setPlayers(Array.from(playersRef.current.values()));
      if (player.id === socket.id) {
        setAvatarColor(player.avatarColor || DEFAULT_AVATAR_COLOR);
      }
    });
    socket.on("player:left", (id) => {
      if (typeof id !== "string") return;

      playersRef.current.delete(id);
      nearbyRef.current.delete(id);
      setPlayers(Array.from(playersRef.current.values()));
      setNearbyPlayers((current) => current.filter((p) => p.id !== id));
      meetingParticipantsRef.current.delete(id);
      setMeetingParticipants((current) =>
        current.filter((participant) => participant.id !== id)
      );
      removeMeetingTracks(id);
      closePeer(id);
      updatePlayerCount();
    });

    socket.on("meeting:participant-joined", (participant) => {
      if (
        !meetingCallActiveRef.current ||
        !participant ||
        typeof participant.id !== "string" ||
        participant.id === socket.id
      ) {
        return;
      }

      meetingParticipantsRef.current.add(participant.id);
      setMeetingParticipants((current) =>
        current.some((candidate) => candidate.id === participant.id)
          ? current.map((candidate) =>
              candidate.id === participant.id
                ? { ...candidate, ...participant }
                : candidate
            )
          : [...current, { ...participant, handRaised: participant.handRaised === true }]
      );
      createPeer(participant.id, socket.id < participant.id);
    });

    socket.on("meeting:hand", (handUpdate) => {
      if (
        currentRoomRef.current !== "Meeting Room" ||
        !handUpdate ||
        typeof handUpdate.id !== "string" ||
        typeof handUpdate.raised !== "boolean"
      ) {
        return;
      }
      if (handUpdate.id === socket.id) {
        setMeetingHandRaised(handUpdate.raised);
        return;
      }
      setMeetingParticipants((current) =>
        current.map((participant) =>
          participant.id === handUpdate.id
            ? { ...participant, handRaised: handUpdate.raised }
            : participant
        )
      );
    });

    socket.on("meeting:reaction", (reaction) => {
      if (
        currentRoomRef.current !== "Meeting Room" ||
        !reaction ||
        typeof reaction.id !== "string" ||
        typeof reaction.name !== "string" ||
        !["👍", "👏", "😂", "❤️", "🙌"].includes(reaction.emoji)
      ) {
        return;
      }
      const reactionId = ++meetingReactionIdRef.current;
      setMeetingReactions((current) => [
        ...current,
        { ...reaction, reactionId },
      ]);
      const timer = window.setTimeout(() => {
        meetingReactionTimersRef.current.delete(reactionId);
        setMeetingReactions((current) =>
          current.filter((entry) => entry.reactionId !== reactionId)
        );
      }, 2600);
      meetingReactionTimersRef.current.set(reactionId, timer);
    });

    socket.on("meeting:participant-left", (participantId) => {
      if (typeof participantId !== "string") return;
      meetingParticipantsRef.current.delete(participantId);
      setMeetingParticipants((current) =>
        current.filter((participant) => participant.id !== participantId)
      );
      setRemoteVideoStreams((current) => {
        if (!(participantId in current)) return current;
        const next = { ...current };
        delete next[participantId];
        return next;
      });
      removeMeetingTracks(participantId);
    });

    // Proximity drives the audio sessions.
    socket.on("proximity:enter", (peer) => {
      if (!peer || typeof peer.id !== "string") return;

      playersRef.current.set(peer.id, peer);
      nearbyRef.current.add(peer.id);
      const nextNearbyPlayer = withDistanceFromPlayer(
        peer,
        playersRef.current.get(socket.id)
      );
      setNearbyPlayers((current) =>
        current.some((nearbyPlayer) => nearbyPlayer.id === peer.id)
          ? current.map((nearbyPlayer) =>
              nearbyPlayer.id === peer.id ? nextNearbyPlayer : nearbyPlayer
            )
          : [...current, nextNearbyPlayer]
      );

      if (!audioEnabledRef.current) {
        pendingPeersRef.current.add(peer.id);
        return;
      }

      createPeer(peer.id, socket.id < peer.id);
    });
    client.on("proximity:leave", (peerId) => {
      if (typeof peerId !== "string") return;
      nearbyRef.current.delete(peerId);
      setNearbyPlayers((current) =>
        current.filter((nearbyPlayer) => nearbyPlayer.id !== peerId)
      );
      pendingPeersRef.current.delete(peerId);
      if (!meetingParticipantsRef.current.has(peerId)) closePeer(peerId);
    });

    socket.on("webrtc:offer", handleOffer);
    socket.on("webrtc:answer", handleAnswer);
    socket.on("webrtc:ice", handleIce);
    socket.on("webrtc:leave", ({ from } = {}) => {
      if (typeof from === "string") closePeer(from);
    });

    return () => {
      unsubscribeActivityNotifications();
      for (const timer of reactionTimers.values()) {
        window.clearTimeout(timer);
      }
      reactionTimers.clear();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      for (const peerId of peers.keys()) closePeer(peerId);
      audioEnabledRef.current = false;
    };
  }, [
    updatePlayerCount,
    createPeer,
    closePeer,
    handleOffer,
    handleAnswer,
    handleIce,
    cleanupMeetingCall,
    removeMeetingTracks,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const canvasWrap = canvasWrapRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !canvasWrap || !ctx) return undefined;

    let animationId;
    let lastSent = 0;
    let previousFrame = performance.now();

    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase();
      if (!gameFocusedRef.current) return;
      if (
        ![
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
          "w",
          "a",
          "s",
          "d",
        ].includes(key)
      ) {
        return;
      }
      if (key.startsWith("arrow")) event.preventDefault();
      keysRef.current[key] = true;
    };

    const clearKeys = () => {
      keysRef.current = {};
    };
    const handleKeyUp = (event) => {
      keysRef.current[event.key.toLowerCase()] = false;
    };
    const handleFocus = () => {
      gameFocusedRef.current = true;
    };
    const handleBlur = () => {
      gameFocusedRef.current = false;
      clearKeys();
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", clearKeys);
    canvasWrap.addEventListener("focus", handleFocus);
    canvasWrap.addEventListener("blur", handleBlur);

    function draw(timestamp) {
      const client = socketRef.current;
      const current = client ? playersRef.current.get(client.id) : null;
      const keys = keysRef.current;
      const deltaTime = Math.min((timestamp - previousFrame) / 1000, 0.05);
      previousFrame = timestamp;

      if (current && client?.connected) {
        let dx = 0;
        let dy = 0;
        if (keys.arrowleft || keys.a) dx -= 1;
        if (keys.arrowright || keys.d) dx += 1;
        if (keys.arrowup || keys.w) dy -= 1;
        if (keys.arrowdown || keys.s) dy += 1;

        if (dx !== 0 || dy !== 0) {
          const length = Math.hypot(dx, dy);
          const distance = SPEED * deltaTime;
          const stepX = (dx / length) * distance;
          const stepY = (dy / length) * distance;
          const nextX = Math.max(
            AVATAR_RADIUS,
            Math.min(WORLD_WIDTH - AVATAR_RADIUS, current.x + stepX)
          );
          const nextY = Math.max(
            AVATAR_RADIUS,
            Math.min(WORLD_HEIGHT - AVATAR_RADIUS, current.y + stepY)
          );

          // If we somehow start inside furniture, let the player walk out.
          const furniture = furnitureOf(layoutRef.current);
          const stuck = hitsObstacle(current.x, current.y, furniture);
          if (stuck || !hitsObstacle(nextX, current.y, furniture)) {
            current.x = nextX;
          }
          if (stuck || !hitsObstacle(current.x, nextY, furniture)) {
            current.y = nextY;
          }

          if (timestamp - lastSent > 40) {
            client.emit("player:move", { x: current.x, y: current.y });
            lastSent = timestamp;
          }
        }
      }

      // Background
      ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.fillStyle = "#101827";
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      drawOffice(ctx, layoutRef.current);
      const me = current;

      for (const player of playersRef.current.values()) {
        const isMe = player.id === client?.id;
        if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) continue;

        // Graded proximity ring: green close, blue medium, red far.
        if (!isMe && nearbyRef.current.has(player.id) && me) {
          const distance = Math.hypot(player.x - me.x, player.y - me.y);
          const ringColor =
            distance < 40 ? "#34d399" : distance < 75 ? "#38bdf8" : "#f87171";
          ctx.beginPath();
          ctx.arc(player.x, player.y, 34, 0, Math.PI * 2);
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.globalAlpha = 0.12;
          ctx.fillStyle = ringColor;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
        }

        ctx.beginPath();
        ctx.arc(player.x, player.y, AVATAR_RADIUS, 0, Math.PI * 2);
        const avatarColors =
          AVATAR_PALETTE[player.avatarPrefs?.color] || {
            fill: player.avatarColor || DEFAULT_AVATAR_COLOR,
            stroke: player.avatarColor || DEFAULT_AVATAR_COLOR,
          };
        ctx.fillStyle = avatarColors.fill;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(player.x, player.y, 27, 0, Math.PI * 2);
        ctx.strokeStyle = avatarColors.stroke;
        ctx.globalAlpha = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = "#f8fafc";
        ctx.font = "13px Arial";
        ctx.textAlign = "center";
        ctx.fillText(
          isMe ? "You" : player.name || `Player ${player.id.slice(0, 4)}`,
          player.x,
          player.y - 34
        );
      }

      animationId = requestAnimationFrame(draw);
    }

    draw(performance.now());

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", clearKeys);
      canvasWrap.removeEventListener("focus", handleFocus);
      canvasWrap.removeEventListener("blur", handleBlur);
    };
    // The canvas does not exist while the landing page is up, so this effect has to
    // re-run when the landing closes — otherwise the world never draws and the
    // keyboard handlers are never attached.
  }, [showLanding]);

  const handleSetName = (event) => {
    event.preventDefault();
    const name = playerName.trim();

    if (!name) {
      setNameError("Enter a player name.");
      return;
    }

    const client = socketRef.current;
    if (!client?.connected) {
      setNameError("Connect to the server before setting your name.");
      return;
    }

    client.emit("player:setName", name, (response) => {
      if (!response?.success) {
        setNameError(response?.error || "Could not save your name.");
        return;
      }
      setSavedName(response.name || name);
      setNameError("");
    });
  };

  const handleSetAvatarColor = (event) => {
    const color = event.target.value;
    setAvatarColor(color);

    const client = socketRef.current;
    if (!client?.connected) return;

    client.emit("player:setAvatarColor", color, (response) => {
      if (!response?.success) {
        setNameError(response?.error || "Could not save your avatar colour.");
      }
    });
  };

  const handleSetStatus = (event) => {
    event.preventDefault();

    const client = socketRef.current;
    if (!client?.connected) {
      setStatusError("Connect to the server before saving a status.");
      return;
    }

    client.emit("player:setStatus", status, (response) => {
      if (!response?.success) {
        setStatusError(response?.error || "Could not save your status.");
        return;
      }
      setSavedStatus(response.status || "");
      setStatusError("");
    });
  };

  const handleSendChat = (event) => {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;

    const client = socketRef.current;
    if (!client?.connected) {
      setChatError("Connect to the server before chatting.");
      return;
    }

    client.emit("world-chat:send", text, (response) => {
      if (!response?.success) {
        setChatError(response?.error || "Could not send your message.");
        return;
      }
      setChatInput("");
      setChatError("");
    });
  };

  const handleJoinRoom = (roomId) => {
    const client = socketRef.current;
    if (!client?.connected) {
      setRoomError("Connect to the server before switching spaces.");
      return;
    }

    client.emit("player:joinRoom", roomId, (response) => {
      if (!response?.success) {
        setRoomError(response?.error || "Could not switch space.");
        return;
      }
      setRoomError("");
      clearMeetingReactions();
      setActiveRoomId(response.room);
      setMeetingParticipants([]);
    });
  };

  const handleMeetingJoin = () => {
    const client = socketRef.current;
    if (!client?.connected) return;

    client.emit("meeting:join", (response) => {
      if (!response?.success) {
        setRoomError(response?.error || "Could not join the call.");
        return;
      }
      setMeetingParticipants(response.participants || []);
      setRoomError("");
    });
  };

  const handleMeetingLeave = () => {
    const client = socketRef.current;
    if (!client?.connected) return;
    client.emit("meeting:leave", () => setMeetingParticipants([]));
  };

  useEffect(() => {
    let cancelled = false;

    async function loadRooms() {
      try {
        const response = await fetch(
          `${SERVER_URL.replace(/\/$/, "")}/api/rooms`
        );
        if (!response.ok) {
          throw new Error(`Space list failed (${response.status})`);
        }
        const result = await response.json();
        if (cancelled) return;

        const list = Array.isArray(result.rooms)
          ? result.rooms.filter(
              (room) =>
                room &&
                typeof room.id === "string" &&
                typeof room.name === "string"
            )
          : [];

        setRooms(list);
        setActiveRoomId((current) =>
          list.some((room) => room.id === current)
            ? current
            : list[0]?.id || ""
        );
      } catch (error) {
        if (!cancelled) setRoomsError(error.message);
      }
    }

    loadRooms();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeRoom = rooms.find((room) => room.id === activeRoomId);

  if (showLanding) {
    return <Landing onEnter={() => setShowLanding(false)} />;
  }

  return (
    <main className="app" data-view={activeView}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">P</div>
          <div>
            <h1>ProxiSpeak</h1>
            <p>Spatial collaboration</p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Sections">
          {[
            ["office", "Office"],
            ["people", "People"],
            ["rooms", "Rooms"],
            ["chat", "Chat"],
            ["settings", "Settings"],
          ].map(([view, label]) => (
            <button
              key={view}
              type="button"
              className={
                activeView === view ? "nav-item is-active" : "nav-item"
              }
              aria-current={activeView === view ? "page" : undefined}
              onClick={() => setActiveView(view)}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="sidebar-profile">
          <span
            className="profile-avatar"
            style={{ backgroundColor: avatarColor }}
            aria-hidden="true"
          >
            {(savedName || playerName || "?").trim().charAt(0).toUpperCase() ||
              "?"}
          </span>
          <div className="sidebar-profile-text">
            <strong>{savedName || "Set a name"}</strong>
            <span className={`presence ${connected ? "online" : "offline"}`}>
              <span className="status-dot" />
              {connected ? "Online" : "Connecting…"}
            </span>
          </div>
        </div>
      </aside>

      <div className="app-main">
      <header className="topbar">
        <div className="topbar-room">
          <span className="live-dot" />
          <strong>{activeRoom?.name || "Open World"}</strong>
          <span className="topbar-sub">Spatial audio office</span>
        </div>
        <div className="topbar-actions">
          <span className="online-count">
            {players.length} online
          </span>
          <button
            type="button"
            className="leave-button"
            onClick={() => setShowLanding(true)}
          >
            Leave Office
          </button>
        </div>
      </header>

      <section className="intro" data-panel="office">
        <div>
          <p className="eyebrow">YOUR SHARED SPACE</p>
          <h2>Meet in the same world.</h2>
          <p className="description">
            Move around the canvas and see other connected players in real time.
          </p>
        </div>
        <div className="player-count">
          <span className="count-number">{players.length}</span>
          <span className="count-label">
            Player{playerCount === 1 ? "" : "s"} in this space
          </span>
        </div>
      </section>

      <div className="world-layout">
        <section className="world-card">
          <div className="world-toolbar">
            <div>
              <span className="live-dot" />
              <strong>{currentRoom}</strong>
              <span className="world-subtitle"> · shared space</span>
            </div>
            <label className="room-select-label">
              <span>Space</span>
              <select
                aria-label="Select space"
                value={currentRoom}
                disabled={!connected || roomSwitching || meetingCallBusy}
                onChange={joinRoom}
              >
                {ROOMS.map((room) => (
                  <option key={room} value={room}>
                    {room}
                    {unreadCounts[room] ? ` (${unreadCounts[room]} unread)` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            ref={canvasWrapRef}
            className="canvas-wrap"
            tabIndex={0}
            aria-label="Game world. Click here, then use WASD or arrow keys to move."
            onClick={() => canvasWrapRef.current?.focus()}
          >
            <canvas
              ref={canvasRef}
              width={WORLD_WIDTH}
              height={WORLD_HEIGHT}
              className="world-canvas"
            />
          </div>

          <div className="world-footer">
            <div className="controls">
              <span className="key">W</span>
              <span className="key">A</span>
              <span className="key">S</span>
              <span className="key">D</span>
              <span className="controls-label">or arrow keys to move</span>
            </div>
            <span className="footer-note">Multiplayer movement prototype</span>
          </div>
        </section>

        <aside className="chat-panel" aria-label={`${currentRoom} chat`}>
          <strong>{currentRoom} chat</strong>
          <div className="chat-messages" role="log" aria-live="polite">
            {chatMessages.length === 0 ? (
              <p className="chat-empty">No messages yet. Say hello!</p>
            ) : (
              chatMessages.map((message) => (
                <p className="chat-message" key={message.id}>
                  <strong>{message.senderName}</strong>
                  <span>{message.text}</span>
                </p>
              ))
            )}
          </div>
          <form className="chat-composer" onSubmit={sendChatMessage}>
            <input
              aria-label="Chat message"
              maxLength={500}
              value={chatDraft}
              onChange={(event) => {
                setChatDraft(event.target.value);
                setChatError("");
              }}
              placeholder="Write a message"
            />
            <button type="submit" disabled={!connected || !chatDraft.trim()}>
              Send
            </button>
          </form>
          {chatError && <p className="chat-error" role="alert">{chatError}</p>}
        </aside>
      </div>
      <section className="presence-panel" aria-label="Online players">
        <strong>Online players ({onlinePlayers.length})</strong>
        {onlinePlayers.length === 0 ? (
          <p className="chat-empty">No players are online.</p>
        ) : (
          <ul>
            {onlinePlayers.map((player) => (
              <li key={player.id}>
                <span>{player.name || `Player ${player.id.slice(0, 4)}`}</span>
                <span>{player.room}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="name-panel" data-panel="settings">
        <div className="profile-preview">
          <span
            className="profile-avatar"
            style={{ backgroundColor: avatarColor }}
            aria-hidden="true"
          >
            {(savedName || playerName || "?").trim().charAt(0).toUpperCase() ||
              "?"}
          </span>
          <div className="profile-preview-text">
            <strong>{savedName || "Your profile"}</strong>
            <span className="profile-status">
              {savedStatus || "Add a status so people know what you're up to."}
            </span>
          </div>
        </div>
        <form className="player-name-form" onSubmit={handleSetName}>
          <label htmlFor="player-name">
            {savedName ? `You are "${savedName}"` : "Set your display name"}
          </label>
          <input
            id="player-name"
            type="text"
            value={playerName}
            placeholder="Enter your name"
            maxLength={30}
            onChange={(event) => setPlayerName(event.target.value)}
          />
          <label htmlFor="avatar-color" className="avatar-color-label">
            <span
              className="avatar-color-swatch"
              style={{ backgroundColor: avatarColor }}
              aria-hidden="true"
            />
            Avatar colour
            <input
              id="avatar-color"
              type="color"
              value={avatarColor}
              disabled={!connected}
              onChange={handleSetAvatarColor}
              aria-label="Choose avatar colour"
            />
          </label>
          <button type="submit" disabled={!connected}>
            Save name
          </button>
        </form>
        <form className="player-name-form" onSubmit={handleSetStatus}>
          <label htmlFor="player-status">Status</label>
          <input
            id="player-status"
            type="text"
            value={status}
            placeholder="e.g. Building the spatial mixer"
            maxLength={80}
            onChange={(event) => setStatus(event.target.value)}
          />
          <button type="submit" disabled={!connected}>
            Save status
          </button>
        </form>
        {nameError && <p className="form-error">{nameError}</p>}
        {statusError && <p className="form-error">{statusError}</p>}
      </section>
      <section className="activity-panel" aria-label="Activity notifications">
        <div className="activity-panel-heading">
          <strong>
            Activity
            {unreadActivityCount > 0 && (
              <span className="activity-badge" aria-label={`${unreadActivityCount} unread`}>
                {unreadActivityCount > 99 ? "99+" : unreadActivityCount}
              </span>
            )}
          </strong>
          <div>
            <button
              type="button"
              onClick={() =>
                setActivityNotifications(markActivityNotificationsRead)
              }
              disabled={unreadActivityCount === 0}
            >
              Mark all read
            </button>
            <button
              type="button"
              onClick={() => setActivityNotifications([])}
              disabled={activityNotifications.length === 0}
            >
              Clear
            </button>
          </div>
        </div>
        {activityNotifications.length === 0 ? (
          <p className="chat-empty">No recent activity.</p>
        ) : (
          <ul className="activity-list" aria-live="polite">
            {activityNotifications.map((notification) => (
              <li
                className={notification.read ? "activity-read" : "activity-unread"}
                key={notification.id}
              >
                <span>{notification.message}</span>
                <span className="activity-details">
                  {notification.room}
                  <time dateTime={notification.timestamp}>
                    {new Date(notification.timestamp).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {roomError && <p className="room-error" role="alert">{roomError}</p>}

      <section className="audio-panel">
        <strong>Profile</strong>
        <form className="player-name-form" onSubmit={setName}>
          <label htmlFor="player-name">Display name</label>
          <input
            id="player-name"
            maxLength={30}
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            placeholder="Enter your player name"
          />
          <label htmlFor="avatar-color">Avatar color</label>
          <select
            id="avatar-color"
            value={avatarColor}
            onChange={(event) => {
              setAvatarColor(event.target.value);
              setAvatarPrefsDirty(true);
            }}
          >
            <option value="mint">Mint</option>
            <option value="blue">Blue</option>
            <option value="violet">Violet</option>
            <option value="coral">Coral</option>
            <option value="gold">Gold</option>
          </select>
          <button type="submit" disabled={!connected}>
            Save profile
          </button>
        </form>
        {nameError && <p role="alert">{nameError}</p>}
      </section>

      <section className="meeting-panel">
        <div className="meeting-panel-heading">
          <div>
            <strong>Meeting Room call</strong>
            <p>
              {currentRoom === "Meeting Room"
                ? meetingCallJoined
                  ? `${meetingParticipants.length + 1} participant${meetingParticipants.length === 0 ? "" : "s"} in the call`
                  : "Start an audio and video call with people in the Meeting Room."
                : "Switch to Meeting Room to start or join a call."}
            </p>
          </div>
          {meetingCallJoined ? (
            <button
              type="button"
              className="meeting-leave-button"
              onClick={() => cleanupMeetingCall()}
            >
              Leave call
            </button>
          ) : (
            <button
              type="button"
              onClick={joinMeetingCall}
              disabled={
                !connected ||
                currentRoom !== "Meeting Room" ||
                meetingCallBusy
              }
            >
              {meetingCallBusy ? "Joining…" : "Join call"}
            </button>
          )}
        </div>

        {currentRoom === "Meeting Room" && meetingReactions.length > 0 && (
          <div className="meeting-reaction-overlay" aria-live="polite">
            {meetingReactions.map((reaction) => (
              <span
                className="meeting-reaction-pop"
                key={reaction.reactionId}
              >
                <span aria-hidden="true">{reaction.emoji}</span>
                <span>{reaction.name}</span>
              </span>
            ))}
          </div>
        )}

        {meetingCallJoined && (
          <>
            <div className="meeting-controls">
              <button
                type="button"
                onClick={toggleMeetingMicrophone}
                disabled={!meetingHasMicrophone}
              >
                {meetingMicEnabled ? "Mute microphone" : "Enable microphone"}
              </button>
              <button
                type="button"
                onClick={toggleMeetingCamera}
                disabled={!meetingHasCamera}
              >
                {meetingCameraEnabled ? "Turn camera off" : "Enable camera"}
              </button>
              <button
                type="button"
                className={meetingHandRaised ? "meeting-hand-raised" : ""}
                onClick={toggleMeetingHand}
                aria-pressed={meetingHandRaised}
              >
                {meetingHandRaised ? "Lower hand" : "Raise hand"}
              </button>
              <div className="meeting-reaction-buttons" aria-label="Send a reaction">
                {["👍", "👏", "😂", "❤️", "🙌"].map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    onClick={() => sendMeetingReaction(emoji)}
                    aria-label={`Send ${emoji} reaction`}
                    title={`Send ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            <div className="meeting-video-grid">
              <article className="meeting-video-tile">
                {meetingHasCamera ? (
                  <video
                    ref={(element) => {
                      localMeetingVideoRef.current = element;
                      if (element && element.srcObject !== meetingStream) {
                        element.srcObject = meetingStream;
                      }
                    }}
                    autoPlay
                    muted
                    playsInline
                  />
                ) : (
                  <div className="meeting-video-placeholder">
                    Camera unavailable
                  </div>
                )}
                <div className="meeting-video-caption">
                  <div className="meeting-video-name">
                    <strong>{playerName || "You"}</strong>
                    {meetingHandRaised && (
                      <span className="meeting-hand-indicator" title="Hand raised">
                        ✋
                      </span>
                    )}
                  </div>
                  <span>You · {meetingMicEnabled ? "Mic on" : "Mic off"}</span>
                </div>
              </article>

              {meetingParticipants.map((participant) => {
                const connectionState =
                  peerStates[participant.id]?.connectionState || "connecting";
                return (
                  <article className="meeting-video-tile" key={participant.id}>
                    {remoteVideoStreams[participant.id] ? (
                      <video
                        ref={(element) => {
                          if (
                            element &&
                            element.srcObject !==
                              remoteVideoStreams[participant.id]
                          ) {
                            element.srcObject =
                              remoteVideoStreams[participant.id];
                          }
                        }}
                        autoPlay
                        muted
                        playsInline
                      />
                    ) : (
                      <div className="meeting-video-placeholder">
                        Camera unavailable
                      </div>
                    )}
                    <div className="meeting-video-caption">
                      <div className="meeting-video-name">
                        <strong>{participant.name}</strong>
                        {participant.handRaised && (
                          <span
                            className="meeting-hand-indicator"
                            title="Hand raised"
                          >
                            ✋
                          </span>
                        )}
                      </div>
                      <span>
                        {connectionState === "connected"
                          ? "Connected"
                          : connectionState === "failed" ||
                              connectionState === "disconnected"
                            ? "Connection lost"
                            : "Connecting…"}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
        {meetingCallError && (
          <p className="meeting-call-error" role="alert">
            {meetingCallError}
          </p>
        )}
      </section>

      <section className="nearby-panel" data-panel="office">
        <strong>Nearby players (within 100px): {nearbyPlayers.length}</strong>
        {nearbyPlayers.length === 0 ? (
          <p>No one nearby yet — move closer to another avatar.</p>
        ) : (
          <ul>
            {nearbyPlayers.map((player) => {
              const connectionState =
                peerStates[player.id]?.connectionState;
              const voiceStatus =
                connectionState === "connected"
                  ? "Connected"
                  : connectionState === "new" ||
                      connectionState === "connecting"
                    ? "Connecting"
                    : "Disconnected";
              const isReceivingAudio =
                peerStates[player.id]?.receivingAudio || false;

              return (
                <li className="nearby-player" key={player.id}>
                  <div className="nearby-player-heading">
                    <div className="nearby-player-identity">
                      <strong className="nearby-player-name">
                        {player.name || `Player ${player.id.slice(0, 4)}`}
                      </strong>
                      <span className="nearby-player-distance">
                        {Number.isFinite(player.distance)
                          ? `${player.distance} px`
                          : "Distance unavailable"}
                      </span>
                    </div>
                    <span
                      className={`voice-status voice-status-${voiceStatus.toLowerCase()}`}
                      aria-label={`Voice connection ${voiceStatus.toLowerCase()}`}
                    >
                      <span className="voice-status-dot" aria-hidden="true" />
                      {voiceStatus}
                    </span>
                  </div>
                  <div className="nearby-player-details">
                    <span
                      className={
                        isReceivingAudio
                          ? "audio-receiving"
                          : "audio-not-receiving"
                      }
                      aria-live="polite"
                    >
                      {isReceivingAudio
                        ? "Microphone audio receiving"
                        : "No microphone audio"}
                    </span>
                    <span className="nearby-player-coordinates">
                      X: {getDisplayCoordinate(player.x) ?? "—"}, Y:{" "}
                      {getDisplayCoordinate(player.y) ?? "—"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <p className="note">
        Enable your microphone to talk with players nearby.
      </p>
      <section className="audio-panel" data-panel="office">
        <strong>Proximity Voice Chat</strong>
        <p>{voiceStatus}</p>
        <button
          type="button"
          disabled={!connected}
          onClick={voiceEnabled ? disableVoice : enableVoice}
        >
          {voiceEnabled ? "Disable Microphone" : "Enable Microphone"}
        </button>
        {voiceEnabled && (
          <button type="button" onClick={toggleMute}>
            {muted ? "Unmute" : "Mute"}
          </button>
        )}
        {audioOutputBlocked && (
          <button type="button" className="resume-audio" onClick={resumeAudio}>
            Resume audio
          </button>
        )}
        <label htmlFor="speaker-volume" className="speaker-volume">
          Speaker volume
          <input
            id="speaker-volume"
            type="range"
            min="0"
            max="100"
            value={speakerVolume}
            onChange={(event) => changeSpeakerVolume(event.target.value)}
          />
          <span>{speakerVolume}%</span>
        </label>
        <p>
          Enable your microphone and move within 100 pixels of another player
          to connect.
        </p>
        {voiceEnabled && (
          <div className="mic-meter">
            <span className="meter-label">Your mic</span>
            <span className="meter-track">
              <span
                className="meter-fill"
                style={{ width: `${Math.round(micLevel * 100)}%` }}
              />
            </span>
          </div>
        )}
        {(microphones.length > 0 || speakers.length > 0) && (
          <div className="device-pickers">
            {microphones.length > 0 && (
              <label className="device-picker">
                Microphone
                <select
                  value={micDeviceId}
                  onChange={(event) => setMicDeviceId(event.target.value)}
                >
                  <option value="">Default microphone</option>
                  {microphones.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {speakers.length > 0 && (
              <label className="device-picker">
                Speaker
                <select
                  value={speakerDeviceId}
                  onChange={(event) => {
                    setSpeakerDeviceId(event.target.value);
                    changeOutputDevice(event.target.value);
                  }}
                >
                  <option value="">Default speaker</option>
                  {speakers.map((device, index) => (
                    <option key={device.deviceId || index} value={device.deviceId}>
                      {device.label || `Speaker ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {voiceEnabled && (
              <p className="device-hint">
                Microphone changes apply when you re-enable the mic.
              </p>
            )}
          </div>
        )}
        {Object.keys(peerStates).length > 0 && (
          <ul className="peer-list">
            {Object.entries(peerStates).map(([playerId, state]) => {
              const peer = players.find((p) => p.id === playerId);
              const level = peerLevels[playerId] || 0;
              return (
                <li key={playerId} className="peer-item">
                  <span className="peer-name">
                    {peer?.name || `Player ${playerId.slice(0, 4)}`} — {state}
                  </span>
                  <span className="meter-track peer-meter">
                    <span
                      className="meter-fill"
                      style={{ width: `${Math.round(level * 100)}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="people-panel" data-panel="people">
        <h2>People online</h2>
        {players.length === 0 ? (
          <p className="panel-empty">No one here yet.</p>
        ) : (
          <ul className="people-list">
            {players.map((player) => (
              <li key={player.id} className="people-item">
                <span
                  className="people-avatar"
                  style={{
                    backgroundColor:
                      player.avatarColor || DEFAULT_AVATAR_COLOR,
                  }}
                  aria-hidden="true"
                >
                  {(player.name || "?").trim().charAt(0).toUpperCase() || "?"}
                </span>
                <span className="people-name">
                  {player.id === socket?.id
                    ? `${player.name || "You"} (you)`
                    : player.name || `Player ${player.id.slice(0, 4)}`}
                  {player.status ? (
                    <span className="people-status">{player.status}</span>
                  ) : null}
                </span>
                <span className="people-badges">
                  {(player.id === socket?.id
                    ? micLevel
                    : peerLevels[player.id] || 0) > 0.12 && (
                    <span
                      className="badge badge-speaking"
                      title="Speaking"
                      aria-label="Speaking"
                    />
                  )}
                  {screenShares.some(
                    (share) => share.sharerId === player.id
                  ) && (
                    <span
                      className="badge badge-sharing"
                      title="Sharing screen"
                      aria-label="Sharing screen"
                    >
                      ▭
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rooms-panel" data-panel="rooms">
        <h2>Spaces</h2>
        {roomsError ? (
          <p className="panel-error">{roomsError}</p>
        ) : rooms.length === 0 ? (
          <p className="panel-empty">Loading spaces…</p>
        ) : (
          <div className="rooms-grid">
            {rooms.map((room) => {
              const here = players.filter(
                (player) => player.room === room.name
              ).length;
              const hue = (room.name.length * 47) % 360;

              return (
                <button
                  key={room.id}
                  type="button"
                  className={`room-card${
                    room.name === activeRoomId ? " is-selected" : ""
                  }`}
                  aria-pressed={room.name === activeRoomId}
                  onClick={() => handleJoinRoom(room.name)}
                >
                  <span
                    className="room-card-thumb"
                    aria-hidden="true"
                    style={{
                      background: `linear-gradient(135deg, hsl(${hue} 55% 26%), hsl(${
                        hue + 30
                      } 50% 15%))`,
                    }}
                  />
                  <span className="room-card-body">
                    <strong>{room.name}</strong>
                    <span className="room-card-count">
                      {here} {here === 1 ? "person" : "people"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {activeRoomId === "Meeting Room" && (
          <div className="rooms-list">
            <button type="button" className="room-button" onClick={handleMeetingJoin}>
              Join call
            </button>
            <button type="button" className="room-button" onClick={handleMeetingLeave}>
              Leave call
            </button>
          </div>
        )}
        {meetingParticipants.length > 0 && (
          <p className="panel-note">
            On the call:{" "}
            {meetingParticipants.map((participant, index) => (
              <span className="meeting-room-participant" key={participant.id}>
                {index > 0 ? ", " : ""}
                {participant.name}
                {participant.handRaised && (
                  <span
                    className="meeting-hand-indicator"
                    title="Hand raised"
                  >
                    {" "}✋
                  </span>
                )}
              </span>
            ))}
          </p>
        )}
        {roomError && <p className="panel-error">{roomError}</p>}
        <p className="panel-note">
          Your space scopes who you can hear and chat with.
        </p>
      </section>

      {activeRoomId === "Meeting Room" && (
        <section className="screen-share-panel" data-panel="rooms">
          <div className="screen-share-header">
            <div>
              <strong>Meeting Room screens</strong>
              <p>Share a screen, window or browser tab with this room.</p>
            </div>
            {isSharing ? (
              <button type="button" onClick={stopScreenShare}>
                Stop sharing
              </button>
            ) : (
              <button
                type="button"
                disabled={!connected || startingShare}
                onClick={startScreenShare}
              >
                {startingShare ? "Starting…" : "Share screen"}
              </button>
            )}
          </div>
          {screenShareError && (
            <p className="screen-share-error" role="alert">
              {screenShareError}
            </p>
          )}
          {screenShares.length === 0 ? (
            <p className="screen-share-empty">
              No one is sharing their screen right now.
            </p>
          ) : (
            <div className="screen-share-grid">
              {screenShares.map((share) => (
                <ScreenShareVideo
                  key={share.sharerId}
                  share={share}
                  isLocal={share.sharerId === socket?.id}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="chat-panel" data-panel="chat">
        <h2>World chat</h2>
        <ul className="chat-log">
          {messages.length === 0 ? (
            <li className="chat-empty">No messages yet.</li>
          ) : (
            messages.map((message) => (
              <li key={message.id} className="chat-message">
                <span
                  className="chat-avatar"
                  style={{
                    backgroundColor:
                      message.avatarColor || DEFAULT_AVATAR_COLOR,
                  }}
                  aria-hidden="true"
                />
                <span className="chat-body">
                  <span className="chat-sender">{message.senderName}</span>
                  <span className="chat-text">{message.text}</span>
                </span>
              </li>
            ))
          )}
        </ul>
        <form className="chat-compose" onSubmit={handleSendChat}>
          <input
            type="text"
            value={chatInput}
            placeholder="Type a message…"
            maxLength={500}
            onChange={(event) => setChatInput(event.target.value)}
          />
          <button type="submit" disabled={!connected}>
            Send
          </button>
        </form>
        {chatError && <p className="panel-error">{chatError}</p>}
      </section>
      </div>
    </main>
  );
}
