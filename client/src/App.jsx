
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const SERVER_URL = "http://localhost:3000";
const SPEED = 4;

export default function App() {
  const canvasRef = useRef(null);
  const socketRef = useRef(null);
  const keysRef = useRef({});
  const playersRef = useRef(new Map());
  const [connected, setConnected] = useState(false);
  const [playerCount, setPlayerCount] = useState(1);

  const updatePlayerCount = useCallback(() => {
    setPlayerCount(playersRef.current.size);
  }, []);

  useEffect(() => {
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("world:state", (players) => {
      playersRef.current = new Map(players.map((p) => [p.id, p]));
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let animationId;
    let lastSent = 0;

    const handleKeyDown = (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) {
        event.preventDefault();
      }
      keysRef.current[event.key.toLowerCase()] = true;
    };

    const handleKeyUp = (event) => {
      keysRef.current[event.key.toLowerCase()] = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    function draw() {
      const me = socketRef.current?.id;
      const players = playersRef.current;
      const current = me ? players.get(me) : null;
      const keys = keysRef.current;

      if (current) {
        let dx = 0;
        let dy = 0;

        if (keys["arrowleft"] || keys["a"]) dx -= SPEED;
        if (keys["arrowright"] || keys["d"]) dx += SPEED;
        if (keys["arrowup"] || keys["w"]) dy -= SPEED;
        if (keys["arrowdown"] || keys["s"]) dy += SPEED;

        if (dx || dy) {
          const length = Math.hypot(dx, dy) || 1;
          current.x = Math.max(18, Math.min(WORLD_WIDTH - 18, current.x + (dx / length) * SPEED));
          current.y = Math.max(18, Math.min(WORLD_HEIGHT - 18, current.y + (dy / length) * SPEED));

          if (performance.now() - lastSent > 40) {
            socketRef.current?.emit("player:move", {
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

      // Players
      for (const player of players.values()) {
        const isMe = player.id === me;

        ctx.beginPath();
        ctx.arc(player.x, player.y, 20, 0, Math.PI * 2);
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
        ctx.fillText(isMe ? "You" : `Player ${player.id.slice(0, 4)}`, player.x, player.y - 34);
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
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
          <span className="count-label">Connected player{playerCount === 1 ? "" : "s"}</span>
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

        <div className="canvas-wrap" tabIndex={0} aria-label="Game world. Use WASD or arrow keys to move.">
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
