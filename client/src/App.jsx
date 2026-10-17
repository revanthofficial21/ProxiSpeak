
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const SERVER_URL = "http://localhost:3000";
const SPEED = 4;
const AVATAR_RADIUS = 20;

const obstacles = [
  { x: 100, y: 120, width: 120, height: 55 },
  { x: 300, y: 120, width: 120, height: 55 },
  { x: 100, y: 300, width: 120, height: 55 },
  { x: 300, y: 300, width: 120, height: 55 },
  { x: 600, y: 180, width: 220, height: 90 },
];

function drawOfficeFurniture(ctx) {
  const desks = obstacles.slice(0, 4);

  desks.forEach((desk) => {
    ctx.fillStyle = "#475569";
    ctx.fillRect(desk.x, desk.y, desk.width, desk.height);

    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 2;
    ctx.strokeRect(desk.x, desk.y, desk.width, desk.height);

    // Computer screen
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(desk.x + 42, desk.y + 8, 36, 20);
  });

  // Meeting table
  const table = obstacles[4];

  ctx.fillStyle = "#854d0e";
  ctx.fillRect(table.x, table.y, table.width, table.height);

  ctx.strokeStyle = "#fbbf24";
  ctx.strokeRect(table.x, table.y, table.width, table.height);

  // Room labels
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
  const socketRef = useRef(null);
  const keysRef = useRef({});
  const playersRef = useRef(new Map());

  const [connected, setConnected] = useState(false);
  const [playerCount, setPlayerCount] = useState(0);

  const updatePlayerCount = useCallback(() => {
    setPlayerCount(playersRef.current.size);
  }, []);

  // Socket.IO connection and multiplayer events
  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("world:state", (players) => {
      playersRef.current = new Map(
        players.map((player) => [player.id, player])
      );
      updatePlayerCount();
    });

    socket.on("player:joined", (player) => {
      playersRef.current.set(player.id, player);
      updatePlayerCount();
    });

    socket.on("player:moved", (player) => {
      playersRef.current.set(player.id, player);
      updatePlayerCount();
    });

    socket.on("player:left", (id) => {
      playersRef.current.delete(id);
      updatePlayerCount();
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [updatePlayerCount]);

  // Keyboard movement and Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId;
    let lastSent = 0;

    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase();

      if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)
      ) {
        event.preventDefault();
      }

      keysRef.current[key] = true;
    };

    const handleKeyUp = (event) => {
      keysRef.current[event.key.toLowerCase()] = false;
    };

    const handleBlur = () => {
      keysRef.current = {};
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);

    function draw() {
      const socket = socketRef.current;
      const me = socket?.id;
      const players = playersRef.current;
      const current = me ? players.get(me) : null;
      const keys = keysRef.current;

      // Move the local player and check furniture collisions
      if (current && socket?.connected) {
        let dx = 0;
        let dy = 0;

        if (keys["arrowleft"] || keys["a"]) dx -= 1;
        if (keys["arrowright"] || keys["d"]) dx += 1;
        if (keys["arrowup"] || keys["w"]) dy -= 1;
        if (keys["arrowdown"] || keys["s"]) dy += 1;

        if (dx !== 0 || dy !== 0) {
          const length = Math.hypot(dx, dy);
          const stepX = (dx / length) * SPEED;
          const stepY = (dy / length) * SPEED;

          const nextX = Math.max(
            AVATAR_RADIUS,
            Math.min(WORLD_WIDTH - AVATAR_RADIUS, current.x + stepX)
          );

          const nextY = Math.max(
            AVATAR_RADIUS,
            Math.min(WORLD_HEIGHT - AVATAR_RADIUS, current.y + stepY)
          );

          // Check horizontal and vertical movement separately,
          // allowing the avatar to slide around furniture.
          if (!hitsObstacle(nextX, current.y)) {
            current.x = nextX;
          }

          if (!hitsObstacle(current.x, nextY)) {
            current.y = nextY;
          }

          // Send updated coordinates to the existing backend
          if (performance.now() - lastSent > 40) {
            socket.emit("player:move", {
              x: current.x,
              y: current.y,
            });

            lastSent = performance.now();
          }
        }
      }

      // Background
      ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
      ctx.fillStyle = "#101827";
      ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // Grid
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

      // Furniture is drawn before avatars
      drawOfficeFurniture(ctx);

      // Draw all connected players
      for (const player of players.values()) {
        const isMe = player.id === me;

        ctx.beginPath();
        ctx.arc(player.x, player.y, AVATAR_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = isMe ? "#6ee7b7" : "#93c5fd";
        ctx.fill();

        ctx.beginPath();
        ctx.arc(player.x, player.y, 27, 0, Math.PI * 2);
        ctx.strokeStyle = isMe ? "#34d399" : "#60a5fa";
        ctx.globalAlpha = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        ctx.fillStyle = "#f8fafc";
        ctx.font = "13px Arial";
        ctx.textAlign = "center";
        ctx.fillText(
          isMe ? "You" : `Player ${player.id.slice(0, 4)}`,
          player.x,
          player.y - 34
        );
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
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
          <span className="count-number">{playerCount}</span>
          <span className="count-label">
            Connected player{playerCount === 1 ? "" : "s"}
          </span>
        </div>
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
          className="canvas-wrap"
          tabIndex={0}
          aria-label="Game world. Use WASD or arrow keys to move."
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

      <p className="note">
        Audio proximity and WebRTC voice are planned for a later phase.
      </p>
    </main>
  );
}
