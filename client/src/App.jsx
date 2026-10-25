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
  const keysRef = useRef({});
  const gameFocusedRef = useRef(false);
  const playersRef = useRef(new Map());
  const nearbyRef = useRef(new Set());

  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const [players, setPlayers] = useState([]);
  const [nearbyPlayers, setNearbyPlayers] = useState([]);
  const [playerName, setPlayerName] = useState("");
  const [avatarColor, setAvatarColor] = useState(DEFAULT_AVATAR_COLOR);
  const [savedName, setSavedName] = useState("");
  const [nameError, setNameError] = useState("");

  const {
    voiceEnabled,
    voiceStatus,
    peerStates,
    muted,
    speakerVolume,
    audioOutputBlocked,
    enableVoice,
    disableVoice,
    toggleMute,
    changeSpeakerVolume,
    resumeAudio,
  } = useVoiceChat(socket, nearbyPlayers, playersRef);

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
      if (
        !player ||
        typeof player.id !== "string" ||
        player.id === client.id
      ) {
        return;
      }

      playersRef.current.set(player.id, player);
    });

    client.on("player:renamed", (player) => {
      if (!player || typeof player.id !== "string") return;

      const existing = playersRef.current.get(player.id);

      if (player.id === client.id && existing) {
        playersRef.current.set(player.id, {
          ...existing,
          name: player.name,
        });
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
        existing
          ? { ...existing, avatarColor: player.avatarColor }
          : player
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
      const current = client
        ? playersRef.current.get(client.id)
        : null;

      const keys = keysRef.current;

      const deltaTime = Math.min(
        (timestamp - previousFrame) / 1000,
        0.05
      );

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
            Math.min(
              WORLD_WIDTH - AVATAR_RADIUS,
              current.x + stepX
            )
          );

          const nextY = Math.max(
            AVATAR_RADIUS,
            Math.min(
              WORLD_HEIGHT - AVATAR_RADIUS,
              current.y + stepY
            )
          );

          if (!hitsObstacle(nextX, current.y)) {
            current.x = nextX;
          }

          if (!hitsObstacle(current.x, nextY)) {
            current.y = nextY;
          }

          if (timestamp - lastSent > 40) {
            client.emit("player:move", {
              x: current.x,
              y: current.y,
            });

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

        if (
          !Number.isFinite(player.x) ||
          !Number.isFinite(player.y)
        ) {
          continue;
        }

        if (!isMe && nearbyRef.current.has(player.id)) {
          ctx.beginPath();
          ctx.arc(player.x, player.y, 34, 0, Math.PI * 2);
          ctx.strokeStyle = "#fbbf24";
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.lineWidth = 1;
        }

        ctx.beginPath();
        ctx.arc(
          player.x,
          player.y,
          AVATAR_RADIUS,
          0,
          Math.PI * 2
        );

        const playerColor =
          player.avatarColor || DEFAULT_AVATAR_COLOR;

        ctx.fillStyle = playerColor;
        ctx.fill();

        ctx.beginPath();
        ctx.arc(player.x, player.y, 27, 0, Math.PI * 2);
        ctx.strokeStyle = playerColor;
        ctx.globalAlpha = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = "#f8fafc";
        ctx.font = "13px Arial";
        ctx.textAlign = "center";

        ctx.fillText(
          isMe
            ? "You"
            : player.name || `Player ${player.id.slice(0, 4)}`,
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
        setNameError(
          response?.error || "Could not save your avatar colour."
        );
      }
    });
  };

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

      <section className="name-panel">
        <form className="player-name-form" onSubmit={handleSetName}>
          <label htmlFor="player-name">
            {savedName
              ? `You are "${savedName}"`
              : "Set your display name"}
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

        {nameError && <p className="form-error">{nameError}</p>}
      </section>

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
            <span className="controls-label">
              or arrow keys to move
            </span>
          </div>

          <span className="footer-note">
            Multiplayer movement prototype
          </span>
        </div>
      </section>

      <section className="nearby-panel">
        <strong>
          Nearby players (within 100px): {nearbyPlayers.length}
        </strong>

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
          <button type="button" onClick={toggleMute}>
            {muted ? "Unmute" : "Mute"}
          </button>
        )}

        {audioOutputBlocked && (
          <button
            type="button"
            className="resume-audio"
            onClick={resumeAudio}
          >
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
            onChange={(event) =>
              changeSpeakerVolume(event.target.value)
            }
          />

          <span>{speakerVolume}%</span>
        </label>

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
