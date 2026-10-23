import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import useVoiceChat from "./useVoiceChat";
import "./App.css";

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
const SPEED = 240;
const AVATAR_RADIUS = 20;
const DEFAULT_AVATAR_COLOR = "#6ee7b7";

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

  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [players, setPlayers] = useState([]);
  const [nearbyPlayers, setNearbyPlayers] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState("");
  const [sendingChat, setSendingChat] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [profileError, setProfileError] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [savingColor, setSavingColor] = useState(false);
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
    voiceStatus,
    peerStates,
    enableVoice,
    disableVoice,
  } = useVoiceChat(socket, nearbyPlayers);

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
      const playerList = Array.from(playersRef.current.values());
      setPlayers(playerList);
      const ownPlayer = playerList.find((player) => player.id === client.id);
      if (ownPlayer) setDisplayName(ownPlayer.name || "");
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
      if (player.id === client.id) setDisplayName(player.name || "");
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
    client.on("player:left", (playerId) => {
      if (typeof playerId !== "string") return;
      playersRef.current.delete(playerId);
      nearbyRef.current.delete(playerId);
      setPlayers(Array.from(playersRef.current.values()));
      setNearbyPlayers((current) =>
        current.filter((player) => player.id !== playerId)
      );
    });
    client.on("chat:message", (message) => {
      if (
        !message ||
        typeof message.id !== "string" ||
        typeof message.senderId !== "string" ||
        typeof message.text !== "string" ||
        typeof message.timestamp !== "string"
      ) {
        return;
      }
      setChatMessages((current) => [...current, message]);
    });

    return () => {
      client.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const log = chatLogRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chatMessages]);

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
    client.timeout(5000).emit("chat:send", text, (timeoutError, result) => {
      setSendingChat(false);
      if (timeoutError || !result?.success) {
        setChatError(result?.error || "Could not send your message. Try again.");
        return;
      }
      setChatInput((current) => (current.trim() === text ? "" : current));
    });
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

      <div className="world-layout">
        <section className="world-card">
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
            <span className="footer-note">Multiplayer movement prototype</span>
          </div>
        </section>

        <aside className="chat-panel" aria-labelledby="chat-heading">
          <div className="chat-header">
            <div>
              <strong id="chat-heading">World chat</strong>
              <p>Messages are shared with everyone online</p>
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
            {chatMessages.length === 0 ? (
              <p className="chat-empty">
                No messages yet. Say hello to everyone in the world.
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
                  : time.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
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
              disabled={!connected || sendingChat}
              onChange={(event) => {
                setChatInput(event.target.value);
                if (chatError) setChatError("");
              }}
            />
            <div className="chat-compose-footer">
              <span>{chatInput.length}/500</span>
              <button
                type="submit"
                disabled={!connected || sendingChat || !chatInput.trim()}
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
            <p>Players currently in this world</p>
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
