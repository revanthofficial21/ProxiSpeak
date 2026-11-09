
import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import useVoiceChat from "./useVoiceChat";
import "./App.css";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL || "http://localhost:3000";

const WORLD_WIDTH = 900;
const WORLD_HEIGHT = 600;
const PLAYER_SPEED = 15;

export default function App() {
  const canvasRef = useRef(null);
  const positionRef = useRef({ x: 450, y: 300 });

  const [position, setPosition] = useState({ x: 450, y: 300 });
  const [players, setPlayers] = useState([]);
  const [playerName, setPlayerName] = useState(
    () => localStorage.getItem("proxispeak-name") || ""
  );
  const [nameInput, setNameInput] = useState(
    () => localStorage.getItem("proxispeak-name") || ""
  );
  const [joined, setJoined] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState("Connecting...");

  const socket = useMemo(
    () =>
      io(SERVER_URL, {
        transports: ["websocket", "polling"],
        autoConnect: false,
      }),
    []
  );

  const voice = useVoiceChat(socket, position);

  const micEnabled =
    voice.micEnabled ?? voice.isMicOn ?? voice.enabled ?? false;

  const toggleMic =
    voice.toggleMic || voice.enableMic || voice.startVoice;

  const voiceError = voice.error || voice.voiceError || "";

  useEffect(() => {
    socket.connect();

    socket.on("connect", () => {
      setConnectionStatus("Connected");
    });

    socket.on("disconnect", () => {
      setConnectionStatus("Disconnected");
    });

    socket.on("connect_error", () => {
      setConnectionStatus("Connection failed");
    });

    socket.on("world:state", (data) => {
      const list = Array.isArray(data)
        ? data
        : data?.players || [];

      setPlayers(list);
    });

    socket.on("player:joined", (player) => {
      setPlayers((current) => {
        const exists = current.some(
          (item) => item.socketId === player.socketId
        );

        if (exists) {
          return current.map((item) =>
            item.socketId === player.socketId ? player : item
          );
        }

        return [...current, player];
      });
    });

    socket.on("player:moved", (player) => {
      setPlayers((current) =>
        current.map((item) =>
          item.socketId === player.socketId
            ? { ...item, ...player }
            : item
        )
      );
    });

    socket.on("player:left", (data) => {
      const socketId =
        typeof data === "string" ? data : data?.socketId;

      setPlayers((current) =>
        current.filter((item) => item.socketId !== socketId)
      );
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    window.__proxyspeakPlayers = players;
  }, [players]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    if (!joined || !socket.connected) return;

    socket.emit("player:move", {
      x: position.x,
      y: position.y,
    });
  }, [position, joined, socket]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext("2d");

    const draw = () => {
      context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // Office background
      context.fillStyle = "#f4f1e9";
      context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

      // Floor grid
      context.strokeStyle = "#e5e0d5";
      context.lineWidth = 1;

      for (let x = 0; x <= WORLD_WIDTH; x += 40) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, WORLD_HEIGHT);
        context.stroke();
      }

      for (let y = 0; y <= WORLD_HEIGHT; y += 40) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(WORLD_WIDTH, y);
        context.stroke();
      }

      // Office furniture
      const desks = [
        { x: 120, y: 100 },
        { x: 320, y: 100 },
        { x: 520, y: 100 },
        { x: 720, y: 100 },
        { x: 120, y: 430 },
        { x: 320, y: 430 },
        { x: 520, y: 430 },
        { x: 720, y: 430 },
      ];

      desks.forEach((desk) => {
        context.fillStyle = "#c8b69b";
        context.fillRect(desk.x, desk.y, 90, 45);

        context.fillStyle = "#8b7355";
        context.fillRect(desk.x + 8, desk.y + 8, 74, 29);
      });

      // Other players
      players.forEach((player) => {
        if (
          !player ||
          player.socketId === socket.id ||
          typeof player.x !== "number" ||
          typeof player.y !== "number"
        ) {
          return;
        }

        context.beginPath();
        context.arc(player.x, player.y, 13, 0, Math.PI * 2);
        context.fillStyle = "#3b82f6";
        context.fill();

        context.fillStyle = "#ffffff";
        context.font = "bold 10px Arial";
        context.textAlign = "center";
        context.fillText(
          (player.name || "Player").slice(0, 10),
          player.x,
          player.y + 4
        );

        context.fillStyle = "#263238";
        context.font = "12px Arial";
        context.fillText(
          player.name || "Player",
          player.x,
          player.y - 21
        );
      });

      // Current player
      context.beginPath();
      context.arc(position.x, position.y, 15, 0, Math.PI * 2);
      context.fillStyle = "#16a34a";
      context.fill();

      context.strokeStyle = "#ffffff";
      context.lineWidth = 3;
      context.stroke();

      context.fillStyle = "#263238";
      context.font = "bold 12px Arial";
      context.textAlign = "center";
      context.fillText(playerName || "You", position.x, position.y - 24);
    };

    draw();
  }, [players, position, playerName, socket.id]);

  useEffect(() => {
    if (!joined) return;

    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase();

      const movementKeys = [
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        "w",
        "a",
        "s",
        "d",
      ];

      if (!movementKeys.includes(key)) return;

      event.preventDefault();

      const current = positionRef.current;
      let x = current.x;
      let y = current.y;

      if (key === "arrowup" || key === "w") y -= PLAYER_SPEED;
      if (key === "arrowdown" || key === "s") y += PLAYER_SPEED;
      if (key === "arrowleft" || key === "a") x -= PLAYER_SPEED;
      if (key === "arrowright" || key === "d") x += PLAYER_SPEED;

      const next = {
        x: Math.max(20, Math.min(WORLD_WIDTH - 20, x)),
        y: Math.max(20, Math.min(WORLD_HEIGHT - 20, y)),
      };

      positionRef.current = next;
      setPosition(next);
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [joined]);

  const joinOffice = (event) => {
    event.preventDefault();

    const name = nameInput.trim();
    if (!name || !socket.connected) return;

    localStorage.setItem("proxispeak-name", name);

    setPlayerName(name);
    setJoined(true);

    socket.emit("player:join", {
      name,
      x: position.x,
      y: position.y,
      officeId: "main-office",
    });
  };

  const handleMic = async () => {
    if (typeof toggleMic === "function") {
      await toggleMic();
    } else {
      alert("The microphone control is not available in the voice hook.");
    }
  };

  return (
    <main className="app-container">
      <header className="app-header">
        <div>
          <h1>ProxiSpeak</h1>
          <p>Geospatial Proximity Audio Ecosystem</p>
        </div>

        <div className="connection-status">
          <span
            className={
              connectionStatus === "Connected"
                ? "status-dot online"
                : "status-dot offline"
            }
          />
          {connectionStatus}
        </div>
      </header>

      {!joined ? (
        <section className="join-panel">
          <h2>Welcome to ProxiSpeak</h2>
          <p>Enter your name to join the virtual office.</p>

          <form onSubmit={joinOffice}>
            <input
              type="text"
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              placeholder="Enter your name"
              maxLength={25}
              required
            />

            <button
              type="submit"
              disabled={!socket.connected || !nameInput.trim()}
            >
              Join Office
            </button>
          </form>
        </section>
      ) : (
        <>
          <section className="dashboard">
            <div>
              <span className="info-label">Your name</span>
              <strong>{playerName}</strong>
            </div>

            <div>
              <span className="info-label">Players connected</span>
              <strong>{players.length + 1}</strong>
            </div>

            <div>
              <span className="info-label">Your position</span>
              <strong>
                {Math.round(position.x)}, {Math.round(position.y)}
              </strong>
            </div>
          </section>

          <section className="office-section">
            <div className="office-heading">
              <h2>Virtual Office</h2>
              <span>Use W A S D or arrow keys to move</span>
            </div>

            <div className="canvas-wrapper">
              <canvas
                ref={canvasRef}
                width={WORLD_WIDTH}
                height={WORLD_HEIGHT}
              />
            </div>
          </section>

          <section className="voice-panel">
            <div>
              <h3>Proximity Voice Chat</h3>
              <p>
                Voice communication is intended for nearby players.
              </p>
            </div>

            <button
              className={micEnabled ? "mic-button active" : "mic-button"}
              onClick={handleMic}
              type="button"
            >
              {micEnabled ? "Turn Microphone Off" : "Turn Microphone On"}
            </button>

            {voiceError && (
              <p className="voice-error">{String(voiceError)}</p>
            )}
          </section>
        </>
      )}

      <footer className="app-footer">
        ProxiSpeak — Real-time virtual collaboration
      </footer>
    </main>
  );
}
