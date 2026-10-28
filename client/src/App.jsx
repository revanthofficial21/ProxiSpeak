import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import useVoiceChat from "./useVoiceChat";
import useScreenShare from "./useScreenShare";
import useAudioDevices from "./useAudioDevices";
import Landing from "./Landing";
import {
  ZONES,
  desks,
  meetingTable,
  discussionTable,
  gameTable,
  sofas,
  plants,
  obstacles,
} from "./office";
import "./App.css";

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
const SPEED = 240;
const AVATAR_RADIUS = 20;
const DEFAULT_AVATAR_COLOR = "#6ee7b7";

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

// Draws the whole office: floor grid, named zones, furniture and walls.
function drawOffice(ctx) {
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

  for (const zone of ZONES) {
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

  for (const desk of desks) {
    ctx.fillStyle = "#334155";
    roundRect(ctx, desk.x, desk.y, desk.width, desk.height, 6);
    ctx.fill();
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#0ea5e9";
    ctx.fillRect(desk.x + 44, desk.y + 10, 34, 20);
    ctx.fillStyle = "#1e293b";
    ctx.beginPath();
    ctx.arc(desk.x + desk.width / 2, desk.y + desk.height + 16, 12, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#7c5a1e";
  roundRect(ctx, meetingTable.x, meetingTable.y, meetingTable.width, meetingTable.height, 14);
  ctx.fill();
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#1e293b";
  for (let i = 0; i < 4; i += 1) {
    const cx = meetingTable.x + 45 + i * 70;
    ctx.beginPath();
    ctx.arc(cx, meetingTable.y - 14, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, meetingTable.y + meetingTable.height + 14, 11, 0, Math.PI * 2);
    ctx.fill();
  }

  const dcx = discussionTable.x + discussionTable.width / 2;
  const dcy = discussionTable.y + discussionTable.height / 2;
  ctx.fillStyle = "#3b3560";
  ctx.beginPath();
  ctx.arc(dcx, dcy, discussionTable.width / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#a78bfa";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#1e293b";
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(dcx + Math.cos(angle) * 68, dcy + Math.sin(angle) * 68, 10, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#14532d";
  roundRect(ctx, gameTable.x, gameTable.y, gameTable.width, gameTable.height, 10);
  ctx.fill();
  ctx.strokeStyle = "#4ade80";
  ctx.lineWidth = 2;
  ctx.stroke();

  for (const sofa of sofas) {
    ctx.fillStyle = "#334155";
    roundRect(ctx, sofa.x, sofa.y, sofa.width, sofa.height, 10);
    ctx.fill();
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 2;
    ctx.stroke();
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

function hitsObstacle(x, y) {
  return obstacles.some((obstacle) => {
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

  const [showLanding, setShowLanding] = useState(true);
  const [activeView, setActiveView] = useState("office");
  const [micDeviceId, setMicDeviceId] = useState("");
  const [speakerDeviceId, setSpeakerDeviceId] = useState("");
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [players, setPlayers] = useState([]);
  const [nearbyPlayers, setNearbyPlayers] = useState([]);
  const [playerName, setPlayerName] = useState("");
  const [avatarColor, setAvatarColor] = useState(DEFAULT_AVATAR_COLOR);
  const [savedName, setSavedName] = useState("");
  const [nameError, setNameError] = useState("");
  const [status, setStatus] = useState("");
  const [savedStatus, setSavedStatus] = useState("");
  const [statusError, setStatusError] = useState("");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState("");
  const [rooms, setRooms] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState("");
  const [roomsError, setRoomsError] = useState("");
  const [roomError, setRoomError] = useState("");
  const [meetingParticipants, setMeetingParticipants] = useState([]);
  const {
    voiceEnabled,
    voiceStatus,
    peerStates,
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
  } = useVoiceChat(socket, nearbyPlayers, playersRef, { micDeviceId });

  const { microphones, speakers } = useAudioDevices(voiceEnabled);

  const {
    isSharing,
    startingShare,
    screenShares,
    screenShareError,
    startScreenShare,
    stopScreenShare,
  } = useScreenShare(socket, activeRoomId);

  useEffect(() => {
    const client = io(SERVER_URL);
    socketRef.current = client;
    setSocket(client);

    client.on("connect", () => setConnected(true));
    client.on("disconnect", () => {
      setConnected(false);
      playersRef.current.clear();
      nearbyRef.current.clear();
      setPlayers([]);
      setNearbyPlayers([]);
    });
    client.on("world:state", (list) => {
      if (!Array.isArray(list)) return;
      playersRef.current = new Map(
        list
          .filter((player) => player && typeof player.id === "string")
          .map((player) => [player.id, player])
      );
      setPlayers(Array.from(playersRef.current.values()));
    });
    client.on("player:joined", (player) => {
      if (!player || typeof player.id !== "string") return;
      playersRef.current.set(player.id, player);
      setPlayers(Array.from(playersRef.current.values()));
    });
    client.on("player:moved", (player) => {
      if (!player || typeof player.id !== "string" || player.id === client.id) {
        return;
      }
      playersRef.current.set(player.id, player);
    });
    client.on("player:renamed", (player) => {
      if (!player || typeof player.id !== "string") return;
      const existing = playersRef.current.get(player.id);

      if (player.id === client.id && existing) {
        // Keep our own live position — only take the new name from the server.
        playersRef.current.set(player.id, { ...existing, name: player.name });
      } else {
        playersRef.current.set(player.id, player);
      }

      setPlayers(Array.from(playersRef.current.values()));
    });
    client.on("player:avatarColorUpdated", (player) => {
      if (!player || typeof player.id !== "string") return;
      const existing = playersRef.current.get(player.id);
      playersRef.current.set(
        player.id,
        existing ? { ...existing, avatarColor: player.avatarColor } : player
      );
      setPlayers(Array.from(playersRef.current.values()));
      if (player.id === client.id) {
        setAvatarColor(player.avatarColor || DEFAULT_AVATAR_COLOR);
      }
    });
    client.on("player:nearby", (list) => {
      const safeList = Array.isArray(list)
        ? list.filter(
            (player) =>
              player &&
              typeof player.id === "string" &&
              Number.isFinite(player.x) &&
              Number.isFinite(player.y)
          )
        : [];
      nearbyRef.current = new Set(safeList.map((player) => player.id));
      setNearbyPlayers(safeList);
    });
    // proximity:enter / proximity:leave are sent to BOTH players (unlike
    // player:nearby, which only goes to whoever moved) — so a stationary
    // player still learns when someone walks up to them.
    client.on("proximity:enter", (peer) => {
      if (!peer || typeof peer.id !== "string") return;
      nearbyRef.current.add(peer.id);
      setNearbyPlayers((current) =>
        current.some((player) => player.id === peer.id)
          ? current
          : [...current, peer]
      );
    });
    client.on("proximity:leave", (peerId) => {
      if (typeof peerId !== "string") return;
      nearbyRef.current.delete(peerId);
      setNearbyPlayers((current) =>
        current.filter((player) => player.id !== peerId)
      );
    });
    client.on("player:left", (playerId) => {
      if (typeof playerId !== "string") return;
      playersRef.current.delete(playerId);
      nearbyRef.current.delete(playerId);
      setPlayers(Array.from(playersRef.current.values()));
      setNearbyPlayers((current) =>
        current.filter((player) => player.id !== playerId)
      );
      setMeetingParticipants((current) =>
        current.filter((p) => p.id !== playerId)
      );
    });
    client.on("chat:message", (message) => {
      if (!message || typeof message.text !== "string") return;
      setMessages((current) => [...current.slice(-199), message]);
    });
    client.on("room:state", ({ room } = {}) => {
      if (typeof room === "string") setActiveRoomId(room);
    });
    client.on("meeting:participant-joined", (participant) => {
      if (!participant || typeof participant.id !== "string") return;
      setMeetingParticipants((current) =>
        current.some((p) => p.id === participant.id)
          ? current
          : [...current, participant]
      );
    });
    client.on("meeting:participant-left", (participantId) => {
      if (typeof participantId !== "string") return;
      setMeetingParticipants((current) =>
        current.filter((p) => p.id !== participantId)
      );
    });
    client.on("player:status", ({ id, status: nextStatus } = {}) => {
      if (typeof id !== "string") return;
      const existing = playersRef.current.get(id);
      if (!existing) return;
      playersRef.current.set(id, { ...existing, status: nextStatus || "" });
      setPlayers(Array.from(playersRef.current.values()));
      setNearbyPlayers((current) =>
        current.map((p) =>
          p.id === id ? { ...p, status: nextStatus || "" } : p
        )
      );
    });

    return () => {
      client.disconnect();
      socketRef.current = null;
    };
  }, []);

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
          const stuck = hitsObstacle(current.x, current.y);
          if (stuck || !hitsObstacle(nextX, current.y)) current.x = nextX;
          if (stuck || !hitsObstacle(current.x, nextY)) current.y = nextY;

          if (timestamp - lastSent > 40) {
            client.emit("player:move", { x: current.x, y: current.y });
            lastSent = timestamp;
          }
        }
      }

      drawOffice(ctx);
      const me = client ? playersRef.current.get(client.id) : null;

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

        const playerColor = player.avatarColor || DEFAULT_AVATAR_COLOR;

        ctx.beginPath();
        ctx.arc(player.x, player.y, AVATAR_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = playerColor;
        ctx.fill();
        ctx.strokeStyle = isMe ? "#f8fafc" : "rgba(15, 23, 42, 0.65)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;

        const initial = (player.name || "?").trim().charAt(0).toUpperCase();
        ctx.fillStyle = "#0f172a";
        ctx.font = "bold 15px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initial || "?", player.x, player.y + 1);
        ctx.textBaseline = "alphabetic";

        const label = isMe
          ? "You"
          : player.name || `Player ${player.id.slice(0, 4)}`;
        ctx.font = "12px Arial";

        // A backing plate keeps the name readable when another avatar sits close —
        // without it the text and the neighbouring circle merge into a blur.
        const labelWidth = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
        ctx.beginPath();
        roundRect(
          ctx,
          player.x - labelWidth / 2 - 5,
          player.y + 28,
          labelWidth + 10,
          17,
          5
        );
        ctx.fill();

        ctx.fillStyle = "#e2e8f0";
        ctx.fillText(label, player.x, player.y + 40);
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

    client.emit("chat:send", text, (response) => {
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
            Connected player{players.length === 1 ? "" : "s"}
          </span>
        </div>
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

      <section className="world-card" data-panel="office">
        <div className="world-toolbar">
          <div>
            <span className="live-dot" />
            <strong>Open World</strong>
            <span className="world-subtitle"> · 2D proximity space</span>
          </div>
          <span className="coordinate-label">1000 × 600</span>
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
          <div className="ring-legend" aria-label="Proximity ring legend">
            <span>
              <i className="ring-swatch is-close" /> Close · loud
            </span>
            <span>
              <i className="ring-swatch is-medium" /> Medium
            </span>
            <span>
              <i className="ring-swatch is-far" /> Far · quiet
            </span>
          </div>
        </div>
      </section>

      <section className="nearby-panel" data-panel="office">
        <strong>Nearby players (within 100px): {nearbyPlayers.length}</strong>
        {nearbyPlayers.length === 0 ? (
          <p>No one nearby yet — move closer to another avatar.</p>
        ) : (
          <ul>
            {nearbyPlayers.map((player) => (
              <li key={player.id}>
                {player.name || `Player ${player.id.slice(0, 4)}`} — X:{" "}
                {Math.round(player.x)}, Y: {Math.round(player.y)}
              </li>
            ))}
          </ul>
        )}
      </section>

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
            On the call: {meetingParticipants.map((p) => p.name).join(", ")}
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
