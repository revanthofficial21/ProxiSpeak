import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import useVoiceChat from "./useVoiceChat";
import useScreenShare from "./useScreenShare";
import "./App.css";

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
const SPEED = 240;
const AVATAR_RADIUS = 20;
const DEFAULT_AVATAR_COLOR = "#6ee7b7";

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

const obstacles = [
  { x: 100, y: 120, width: 120, height: 55 },
  { x: 300, y: 120, width: 120, height: 55 },
  { x: 100, y: 300, width: 120, height: 55 },
  { x: 300, y: 300, width: 120, height: 55 },
  { x: 600, y: 180, width: 220, height: 90 },
];

function drawOfficeFurniture(ctx) {
  obstacles.slice(0, 4).forEach((desk) => {
    ctx.fillStyle = "#475569";
    ctx.fillRect(desk.x, desk.y, desk.width, desk.height);
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.strokeRect(desk.x, desk.y, desk.width, desk.height);
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(desk.x + 42, desk.y + 8, 36, 20);
  });

  const table = obstacles[4];
  ctx.fillStyle = "#854d0e";
  ctx.fillRect(table.x, table.y, table.width, table.height);
  ctx.strokeStyle = "#fbbf24";
  ctx.strokeRect(table.x, table.y, table.width, table.height);
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "16px Arial";
  ctx.textAlign = "left";
  ctx.fillText("WORK AREA", 100, 85);
  ctx.fillText("MEETING ROOM", 620, 155);
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
  const chatLogRef = useRef(null);
  const keysRef = useRef({});
  const gameFocusedRef = useRef(false);
  const playersRef = useRef(new Map());
  const nearbyRef = useRef(new Set());
  const pendingChatRef = useRef(null);
  const savedDisplayNameRef = useRef("");
  const seenPresenceIdsRef = useRef(new Set());
  const presenceTimersRef = useRef(new Map());

  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [players, setPlayers] = useState([]);
  const [nearbyPlayers, setNearbyPlayers] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatHistoryLoading, setChatHistoryLoading] = useState(true);
  const [chatHistoryError, setChatHistoryError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState("");
  const [rooms, setRooms] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState("");
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomsError, setRoomsError] = useState("");
  const [roomActionError, setRoomActionError] = useState("");
  const [switchingRoom, setSwitchingRoom] = useState(false);
  const [sendingChat, setSendingChat] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [profileError, setProfileError] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingColor, setSavingColor] = useState(false);
  const [presenceNotifications, setPresenceNotifications] = useState([]);
  const getLocalPlayerPosition = useCallback(() => {
    const playerId = socketRef.current?.id;
    const player = playerId ? playersRef.current.get(playerId) : null;
    return player &&
      Number.isFinite(player.x) &&
      Number.isFinite(player.y)
      ? player
      : null;
  }, []);
  const profilePlayer = players.find((player) => player.id === socket?.id);
  const avatarColor = profilePlayer?.avatarColor || DEFAULT_AVATAR_COLOR;
  const nearbyPlayerIds = new Set(nearbyPlayers.map((player) => player.id));
  const peopleList = [...players].sort((first, second) => {
    if (first.id === socket?.id) return -1;
    if (second.id === socket?.id) return 1;
    const firstName =
      typeof first.name === "string" ? first.name.trim() : "";
    const secondName =
      typeof second.name === "string" ? second.name.trim() : "";
    return firstName.localeCompare(secondName);
  });
  const {
    voiceEnabled,
    muted,
    speakerVolume,
    audioOutputBlocked,
    voiceStatus,
    peerStates,
    enableVoice,
    disableVoice,
    toggleMute,
    updateSpeakerVolume,
    resumeAudio,
  } = useVoiceChat(socket, nearbyPlayers, getLocalPlayerPosition);
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
    const presenceTimers = presenceTimersRef.current;

    client.on("connect", () => {
      setConnected(true);
      if (savedDisplayNameRef.current) {
        client.emit("player:setName", savedDisplayNameRef.current);
      }
    });
    client.on("disconnect", () => {
      setConnected(false);
      playersRef.current.clear();
      nearbyRef.current.clear();
      setPlayers([]);
      setNearbyPlayers([]);
      setChatHistoryLoading(false);
      for (const timer of presenceTimers.values()) {
        window.clearTimeout(timer);
      }
      presenceTimers.clear();
      setPresenceNotifications([]);
    });
    client.on("world:state", (list) => {
      if (!Array.isArray(list)) return;
      playersRef.current = new Map(
        list
          .filter((player) => player && typeof player.id === "string")
          .map((player) => [player.id, player])
      );
      const playerList = Array.from(playersRef.current.values());
      setPlayers(playerList);
      const ownPlayer = playerList.find((player) => player.id === client.id);
      if (ownPlayer) {
        setDisplayName(ownPlayer.name || "");
        if (typeof ownPlayer.name === "string" && ownPlayer.name.trim()) {
          savedDisplayNameRef.current = ownPlayer.name;
        }
        if (typeof ownPlayer.roomId === "string") {
          setActiveRoomId(ownPlayer.roomId);
        }
      }
      setChatMessages([]);
      setChatHistoryLoading(true);
      setChatHistoryError("");
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
      playersRef.current.set(player.id, player);
      setPlayers(Array.from(playersRef.current.values()));
      if (player.id === client.id) {
        setDisplayName(player.name || "");
        savedDisplayNameRef.current = player.name || "";
      }
    });
    client.on("player:avatarColorUpdated", (player) => {
      if (!player || typeof player.id !== "string") return;
      playersRef.current.set(player.id, player);
      setPlayers(Array.from(playersRef.current.values()));
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
    });
    client.on("room:presence", (notification) => {
      if (
        !notification ||
        typeof notification.eventId !== "string" ||
        typeof notification.roomId !== "string" ||
        typeof notification.playerId !== "string" ||
        typeof notification.displayName !== "string" ||
        !notification.displayName.trim() ||
        !["joined", "left"].includes(notification.action) ||
        seenPresenceIdsRef.current.has(notification.eventId)
      ) {
        return;
      }

      seenPresenceIdsRef.current.add(notification.eventId);
      if (seenPresenceIdsRef.current.size > 100) {
        const oldestEventId = seenPresenceIdsRef.current.values().next().value;
        seenPresenceIdsRef.current.delete(oldestEventId);
      }

      setPresenceNotifications((current) => [
        ...current.slice(-2),
        notification,
      ]);
      const timer = window.setTimeout(() => {
        setPresenceNotifications((current) =>
          current.filter((entry) => entry.eventId !== notification.eventId)
        );
        presenceTimersRef.current.delete(notification.eventId);
      }, 5000);
      presenceTimersRef.current.set(notification.eventId, timer);
    });
    client.on("chat:message", (message) => {
      if (
        !message ||
        typeof message.id !== "string" ||
        typeof message.senderId !== "string" ||
        typeof message.roomId !== "string" ||
        typeof message.text !== "string" ||
        typeof message.timestamp !== "string"
      ) {
        return;
      }
      const currentRoomId = playersRef.current.get(client.id)?.roomId;
      if (message.roomId !== currentRoomId) return;
      setChatMessages((current) =>
        current.some((existing) => existing.id === message.id)
          ? current
          : [...current, message]
      );
    });
    client.on("chat:history", (history) => {
      if (!history || typeof history !== "object") return;
      const { roomId, messages } = history;
      const currentRoomId = playersRef.current.get(client.id)?.roomId;
      if (roomId !== currentRoomId || !Array.isArray(messages)) return;
      const validMessages = messages.filter(
        (message) =>
          message &&
          typeof message.id === "string" &&
          typeof message.senderId === "string" &&
          message.roomId === roomId &&
          typeof message.text === "string" &&
          typeof message.timestamp === "string"
      );
      setChatMessages((current) => {
        const mergedMessages = new Map(
          validMessages.map((message) => [message.id, message])
        );
        current
          .filter((message) => message.roomId === roomId)
          .forEach((message) => {
            if (!mergedMessages.has(message.id)) {
              mergedMessages.set(message.id, message);
            }
          });
        return Array.from(mergedMessages.values()).sort(
          (first, second) =>
            new Date(first.timestamp).getTime() -
            new Date(second.timestamp).getTime()
        );
      });
      setChatHistoryLoading(false);
      setChatHistoryError("");
    });
    client.on("chat:history:error", (historyError) => {
      if (!historyError || typeof historyError !== "object") return;
      const { roomId, error } = historyError;
      const currentRoomId = playersRef.current.get(client.id)?.roomId;
      if (roomId !== currentRoomId) return;
      setChatHistoryLoading(false);
      setChatHistoryError(
        typeof error === "string"
          ? error
          : "Could not load chat history. Try switching rooms."
      );
    });

    return () => {
      client.disconnect();
      for (const timer of presenceTimers.values()) {
        window.clearTimeout(timer);
      }
      presenceTimers.clear();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const log = chatLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRooms() {
      try {
        const response = await fetch(
          `${SERVER_URL.replace(/\/$/, "")}/api/rooms`,
          { signal: controller.signal }
        );
        if (!response.ok) {
          throw new Error(`Room list request failed (${response.status})`);
        }

        const result = await response.json();
        if (!Array.isArray(result.rooms)) {
          throw new Error("Server returned an invalid room list");
        }

        const availableRooms = result.rooms.filter(
          (room) =>
            room &&
            typeof room.id === "string" &&
            typeof room.name === "string"
        );
        setRooms(availableRooms);
        setActiveRoomId((currentRoomId) =>
          availableRooms.some((room) => room.id === currentRoomId)
            ? currentRoomId
            : availableRooms.find((room) => room.id === "open-world")?.id ||
              availableRooms[0]?.id ||
              ""
        );
        setRoomsError("");
      } catch (error) {
        if (error.name === "AbortError") return;
        console.error("Could not load available rooms:", error);
        setRoomsError("Could not load available rooms. Try refreshing.");
      } finally {
        if (!controller.signal.aborted) setRoomsLoading(false);
      }
    }

    loadRooms();
    return () => controller.abort();
  }, []);

  const activeRoom = rooms.find((room) => room.id === activeRoomId);

  const selectRoom = (roomId) => {
    const client = socketRef.current;
    if (!client?.connected || switchingRoom || roomId === activeRoomId) return;

    setSwitchingRoom(true);
    setRoomActionError("");
    setChatHistoryLoading(true);
    setChatHistoryError("");
    client.timeout(5000).emit("room:join", roomId, (timeoutError, result) => {
      setSwitchingRoom(false);
      if (timeoutError || !result?.success) {
        setChatHistoryLoading(false);
        setRoomActionError(
          result?.error || "Could not switch rooms. Try again."
        );
        return;
      }
      setActiveRoomId(result.roomId);
      setChatError("");
      pendingChatRef.current = null;
    });
  };

  const saveDisplayName = (event) => {
    event.preventDefault();
    const name = displayName.trim();
    const client = socketRef.current;
    if (!name) {
      setProfileError("Enter a display name before saving.");
      return;
    }
    if (!client?.connected) {
      setProfileError("Connect to the server before updating your profile.");
      return;
    }

    setSavingName(true);
    setProfileError("");
    client.timeout(5000).emit("player:setName", name, (timeoutError, result) => {
      setSavingName(false);
      if (timeoutError || !result?.success) {
        setProfileError(result?.error || "Could not save your display name. Try again.");
        return;
      }
      savedDisplayNameRef.current = result.name;
      setDisplayName(result.name);
    });
  };

  const updateAvatarColor = (event) => {
    const color = event.target.value;
    const client = socketRef.current;
    const ownPlayer = client ? playersRef.current.get(client.id) : null;
    if (!client?.connected || !ownPlayer) {
      setProfileError("Connect to the server before updating your avatar color.");
      return;
    }

    const previousColor = ownPlayer.avatarColor || DEFAULT_AVATAR_COLOR;
    const optimisticPlayer = { ...ownPlayer, avatarColor: color };
    playersRef.current.set(client.id, optimisticPlayer);
    setPlayers(Array.from(playersRef.current.values()));
    setSavingColor(true);
    setProfileError("");
    client.timeout(5000).emit(
      "player:setAvatarColor",
      color,
      (timeoutError, result) => {
        setSavingColor(false);
        if (timeoutError || !result?.success) {
          const currentPlayer = playersRef.current.get(client.id);
          if (currentPlayer?.avatarColor === color) {
            const restoredPlayer = {
              ...currentPlayer,
              avatarColor: previousColor,
            };
            playersRef.current.set(client.id, restoredPlayer);
            setPlayers(Array.from(playersRef.current.values()));
          }
          setProfileError(
            result?.error || "Could not save your avatar color. Try again."
          );
        }
      }
    );
  };

  const sendChatMessage = (event) => {
    event.preventDefault();
    const text = chatInput.trim();
    const client = socketRef.current;
    if (!text) {
      setChatError("Write a message before sending.");
      return;
    }
    if (text.length > 500) {
      setChatError("Messages must be 500 characters or fewer.");
      return;
    }
    if (!client?.connected) {
      setChatError("Connect to the server before sending a message.");
      return;
    }

    setChatError("");
    setSendingChat(true);
    if (pendingChatRef.current?.text !== text) {
      pendingChatRef.current = { text, id: crypto.randomUUID() };
    }
    const clientMessageId = pendingChatRef.current.id;
    client.timeout(5000).emit(
      "chat:send",
      text,
      clientMessageId,
      (timeoutError, result) => {
        setSendingChat(false);
        if (timeoutError || !result?.success) {
          setChatError(
            result?.error || "Could not send your message. Try again."
          );
          return;
        }
        if (pendingChatRef.current?.id === clientMessageId) {
          pendingChatRef.current = null;
        }
        setChatInput((current) => (current.trim() === text ? "" : current));
      }
    );
  };

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

          if (!hitsObstacle(nextX, current.y)) current.x = nextX;
          if (!hitsObstacle(current.x, nextY)) current.y = nextY;

          if (timestamp - lastSent > 40) {
            client.emit("player:move", { x: current.x, y: current.y });
            lastSent = timestamp;
          }
        }
      }

      ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.fillStyle = "#101827";
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.strokeStyle = "#263449";
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

      drawOfficeFurniture(ctx);
      for (const player of playersRef.current.values()) {
        const isMe = player.id === client?.id;
        if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) continue;

        if (!isMe && nearbyRef.current.has(player.id)) {
          ctx.beginPath();
          ctx.arc(player.x, player.y, 34, 0, Math.PI * 2);
          ctx.strokeStyle = "#fbbf24";
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.lineWidth = 1;
        }

        ctx.beginPath();
        ctx.arc(player.x, player.y, AVATAR_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = player.avatarColor || DEFAULT_AVATAR_COLOR;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(player.x, player.y, 27, 0, Math.PI * 2);
        ctx.strokeStyle = player.avatarColor || DEFAULT_AVATAR_COLOR;
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
  }, []);

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-icon">P</div>
          <div>
            <h1>ProxiSpeak</h1>
            <p>Spatial collaboration, reimagined</p>
          </div>
        </div>
        <div className={`connection ${connected ? "online" : "offline"}`}>
          <span className="status-dot" />
          {connected ? "Server connected" : "Connecting to server…"}
        </div>
      </header>

      <div className="presence-notifications" aria-label="Room activity">
        {presenceNotifications
          .filter((notification) => notification.roomId === activeRoomId)
          .map((notification) => (
            <p className="presence-toast" key={notification.eventId} role="status">
              <strong>{notification.displayName}</strong>{" "}
              {notification.action === "joined" ? "joined the room" : "left the room"}
            </p>
          ))}
      </div>

      <section className="intro">
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

      <form className="profile-panel" onSubmit={saveDisplayName}>
        <div className="profile-heading">
          <div>
            <strong>Player profile</strong>
            <p>Choose how others see you in the shared world.</p>
          </div>
          <span
            className="avatar-preview"
            style={{ backgroundColor: avatarColor }}
            aria-hidden="true"
          />
        </div>
        <div className="profile-fields">
          <label className="profile-name">
            Display name
            <input
              type="text"
              value={displayName}
              maxLength={30}
              placeholder="Enter your name"
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="profile-color">
            Avatar color
            <span className="color-picker-wrap">
              <input
                type="color"
                value={avatarColor}
                disabled={!connected || savingColor}
                onChange={updateAvatarColor}
                aria-label="Choose avatar color"
              />
              <span>{avatarColor.toUpperCase()}</span>
            </span>
          </label>
          <button type="submit" disabled={!connected || savingName}>
            {savingName ? "Saving…" : "Save name"}
          </button>
        </div>
        {profileError && (
          <p className="profile-error" role="alert">
            {profileError}
          </p>
        )}
      </form>

      <section className="rooms-panel" aria-labelledby="rooms-heading">
        <div className="rooms-heading">
          <div>
            <strong id="rooms-heading">Available rooms</strong>
            <p>Room catalog from the server</p>
          </div>
        </div>
        {roomsLoading ? (
          <p className="rooms-message" role="status">
            Loading rooms…
          </p>
        ) : roomsError ? (
          <p className="rooms-error" role="alert">
            {roomsError}
          </p>
        ) : rooms.length === 0 ? (
          <p className="rooms-message">No rooms are available.</p>
        ) : (
          <ul className="rooms-list">
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  className={`room-button${room.id === activeRoomId ? " selected" : ""}`}
                  aria-pressed={room.id === activeRoomId}
                  disabled={!connected || switchingRoom}
                  onClick={() => selectRoom(room.id)}
                >
                  {room.name}
                </button>
              </li>
            ))}
          </ul>
        )}
        {activeRoom && (
          <p className="active-room-label" aria-live="polite">
            Current room: <strong>{activeRoom.name}</strong>
          </p>
        )}
        {switchingRoom && (
          <p className="rooms-message" role="status">
            Switching rooms…
          </p>
        )}
        {roomActionError && (
          <p className="rooms-error" role="alert">
            {roomActionError}
          </p>
        )}
      </section>

      {activeRoomId === "meeting-room" && (
        <section className="screen-share-panel" aria-labelledby="screen-share-heading">
          <div className="screen-share-header">
            <div>
              <strong id="screen-share-heading">Meeting Room screens</strong>
              <p>Share a screen, window, or browser tab with this room.</p>
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

      <div className="world-layout">
        <section className="world-card">
          <div className="world-toolbar">
            <div>
              <span className="live-dot" />
              <strong>{activeRoom?.name || "Open World"}</strong>
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
            <span className="footer-note">Multiplayer movement prototype</span>
          </div>
        </section>

        <aside className="chat-panel" aria-labelledby="chat-heading">
          <div className="chat-header">
            <div>
              <strong id="chat-heading">World chat</strong>
              <p>Messages are shared with players in this room</p>
            </div>
            <span className={`chat-status${connected ? " connected" : ""}`}>
              {connected ? "Connected" : "Offline"}
            </span>
          </div>
          <div
            className="chat-log"
            ref={chatLogRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="World chat messages"
          >
            {chatHistoryLoading ? (
              <p className="chat-empty" role="status">
                Loading chat history…
              </p>
            ) : chatHistoryError ? (
              <p className="chat-empty" role="alert">
                {chatHistoryError}
              </p>
            ) : chatMessages.length === 0 ? (
              <p className="chat-empty">
                No messages yet. Say hello to everyone in this room.
              </p>
            ) : (
              chatMessages.map((message) => {
                const sender =
                  typeof message.name === "string" && message.name.trim()
                    ? message.name.trim()
                    : `Player ${message.senderId.slice(0, 4)}`;
                const time = new Date(message.timestamp);
                const timeLabel = Number.isNaN(time.getTime())
                  ? ""
                  : time.toLocaleString([], {
                      dateStyle: "short",
                      timeStyle: "short",
                    });

                return (
                  <article className="chat-message" key={message.id}>
                    <span
                      className="chat-avatar"
                      style={{
                        backgroundColor:
                          message.avatarColor || DEFAULT_AVATAR_COLOR,
                      }}
                      aria-hidden="true"
                    />
                    <div className="chat-message-content">
                      <div className="chat-message-meta">
                        <strong>{sender}</strong>
                        <time dateTime={message.timestamp}>{timeLabel}</time>
                      </div>
                      <p>{message.text}</p>
                    </div>
                  </article>
                );
              })
            )}
          </div>
          <form className="chat-compose" onSubmit={sendChatMessage}>
            <label className="visually-hidden" htmlFor="chat-message-input">
              Message
            </label>
            <textarea
              id="chat-message-input"
              value={chatInput}
              maxLength={500}
              rows={2}
              placeholder="Write a message…"
              disabled={!connected || sendingChat || switchingRoom}
              onChange={(event) => {
                setChatInput(event.target.value);
                if (chatError) setChatError("");
              }}
            />
            <div className="chat-compose-footer">
              <span>{chatInput.length}/500</span>
              <button
                type="submit"
                disabled={
                  !connected ||
                  sendingChat ||
                  switchingRoom ||
                  !chatInput.trim()
                }
              >
                {sendingChat ? "Sending…" : "Send"}
              </button>
            </div>
            {chatError && (
              <p className="chat-error" role="alert">
                {chatError}
              </p>
            )}
          </form>
        </aside>
      </div>

      <section className="people-panel" aria-labelledby="people-heading">
        <div className="people-header">
          <div>
            <strong id="people-heading">People</strong>
            <p>Players currently in this room</p>
          </div>
          <span className="people-count">
            {players.length} online
            {nearbyPlayers.length > 0 &&
              ` · ${nearbyPlayers.length} nearby`}
          </span>
        </div>
        {peopleList.length === 0 ? (
          <p className="people-empty">No players are online yet.</p>
        ) : (
          <ul className="people-list">
            {peopleList.map((player) => {
              const isMe = player.id === socket?.id;
              const name =
                typeof player.name === "string" && player.name.trim()
                  ? player.name.trim()
                  : `Player ${player.id.slice(0, 4)}`;
              const isNearby = !isMe && nearbyPlayerIds.has(player.id);

              return (
                <li className="people-item" key={player.id}>
                  <span
                    className="people-avatar"
                    style={{
                      backgroundColor:
                        player.avatarColor || DEFAULT_AVATAR_COLOR,
                    }}
                    aria-hidden="true"
                  />
                  <span className="people-name">
                    {name}
                    {isMe && <span className="people-you">You</span>}
                  </span>
                  <span className="people-presence">
                    <span className="online-indicator" />
                    Online
                  </span>
                  <span
                    className={`people-proximity${isNearby ? " nearby" : ""}`}
                  >
                    {isNearby ? "Nearby" : isMe ? "You" : "Not nearby"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="nearby-panel">
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

      <section className="audio-panel">
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
          <div className="audio-controls">
            {audioOutputBlocked && (
              <button
                type="button"
                className="audio-resume-button"
                onClick={resumeAudio}
              >
                Resume audio
              </button>
            )}
            <button
              type="button"
              className={`audio-mute-button${muted ? " muted" : ""}`}
              aria-pressed={muted}
              onClick={toggleMute}
            >
              {muted ? "Unmute microphone" : "Mute microphone"}
            </button>
            <div className="speaker-volume">
              <div className="speaker-volume-label">
                <label htmlFor="speaker-volume">Speaker volume</label>
                <output htmlFor="speaker-volume">{speakerVolume}%</output>
              </div>
              <input
                id="speaker-volume"
                type="range"
                min="0"
                max="100"
                step="1"
                value={speakerVolume}
                aria-valuetext={`${speakerVolume}%`}
                onChange={(event) => updateSpeakerVolume(event.target.value)}
              />
            </div>
          </div>
        )}
        <p>
          Enable your microphone and move within 100 pixels of another player
          to connect.
        </p>
        {Object.keys(peerStates).length > 0 && (
          <ul>
            {Object.entries(peerStates).map(([playerId, state]) => (
              <li key={playerId}>
                {`Player ${playerId.slice(0, 4)}`} — {state}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
