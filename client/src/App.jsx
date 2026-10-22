
import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3000";
const SPEED = 240;
const AVATAR_RADIUS = 20;

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

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
  const canvasWrapRef = useRef(null);
  const socketRef = useRef(null);
  const keysRef = useRef({});
  const gameFocusedRef = useRef(false);
  const playersRef = useRef(new Map());
  const nearbyRef = useRef(new Set());
  const localStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const remoteAudioRef = useRef(new Map());
  const pendingPeersRef = useRef(new Set());
  const pendingOffersRef = useRef(new Map());
  const pendingCandidatesRef = useRef(new Map());
  const audioEnabledRef = useRef(false);
  const audioRequestRef = useRef(false);

  const [connected, setConnected] = useState(false);
  const [playerCount, setPlayerCount] = useState(0);
  const [nearbyPlayers, setNearbyPlayers] = useState([]);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioError, setAudioError] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [nameError, setNameError] = useState("");
  const [peerStates, setPeerStates] = useState({});

  const updatePlayerCount = useCallback(() => {
    setPlayerCount(playersRef.current.size);
  }, []);

  // Tear down a single peer connection and its audio element.
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

    const audio = remoteAudioRef.current.get(peerId);
    if (audio) {
      audio.srcObject = null;
      remoteAudioRef.current.delete(peerId);
    }

    setPeerStates((current) => {
      if (!(peerId in current)) return current;
      const next = { ...current };
      delete next[peerId];
      return next;
    });
  }, []);

  // Create (or return) the RTCPeerConnection for a nearby peer.
  const createPeer = useCallback((peerId, initiator) => {
    if (peersRef.current.has(peerId)) return peersRef.current.get(peerId);

    const socket = socketRef.current;
    if (!socket) return null;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach((track) => pc.addTrack(track, localStreamRef.current));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("webrtc:ice", { to: peerId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      let audio = remoteAudioRef.current.get(peerId);
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        remoteAudioRef.current.set(peerId, audio);
      }
      audio.srcObject = event.streams[0];
      audio.play().catch((error) => {
        console.warn("Remote audio playback needs user interaction:", error);
      });
    };

    pc.onconnectionstatechange = () => {
      setPeerStates((current) => ({
        ...current,
        [peerId]: pc.connectionState,
      }));
    };

    peersRef.current.set(peerId, pc);

    // The peer with the lower id offers, so both sides agree who initiates.
    if (initiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() =>
          socket.emit("webrtc:offer", { to: peerId, sdp: pc.localDescription })
        )
        .catch((error) =>
          console.error("Failed to create offer:", error.message)
        );
    }

    return pc;
  }, []);

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
      if (!audioEnabledRef.current) {
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

  // Triggered by a click so the browser permits mic capture and playback.
  const enableAudio = useCallback(async () => {
    if (localStreamRef.current || audioRequestRef.current) return;
    audioRequestRef.current = true;

    try {
      setAudioError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;
      audioEnabledRef.current = true;
      setAudioEnabled(true);
      setAudioMuted(false);

      const socket = socketRef.current;
      const pending = new Set([
        ...pendingPeersRef.current,
        ...nearbyRef.current,
      ]);
      pendingPeersRef.current.clear();
      pending.forEach((peerId) => {
        if (socket) createPeer(peerId, socket.id < peerId);
      });

      // Answer any offers that arrived before the mic was on.
      const offers = Array.from(pendingOffersRef.current.entries());
      pendingOffersRef.current.clear();
      offers.forEach(([from, sdp]) => answerOffer(from, sdp));
    } catch (error) {
      console.error("Microphone access failed:", error.message);
      setAudioError(
        error.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access in your browser."
          : error.message || "Could not access the microphone."
      );
    } finally {
      audioRequestRef.current = false;
    }
  }, [createPeer, answerOffer]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextMuted = !audioMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setAudioMuted(nextMuted);
  }, [audioMuted]);

  const disableAudio = useCallback(() => {
    socketRef.current?.emit("webrtc:leave");
    for (const peerId of peersRef.current.keys()) {
      closePeer(peerId);
    }
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    audioEnabledRef.current = false;
    pendingOffersRef.current.clear();
    pendingCandidatesRef.current.clear();
    setAudioEnabled(false);
    setAudioMuted(false);
  }, [closePeer]);

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
      setNameError("");
    });
  }, [playerName]);

  // Socket.IO connection and multiplayer events
  useEffect(() => {
    const peers = peersRef.current;
    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      updatePlayerCount();
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setNearbyPlayers([]);
      nearbyRef.current = new Set();
      playersRef.current.clear();
      updatePlayerCount();
    });

    socket.on("world:state", (players) => {
      if (!Array.isArray(players)) return;

      playersRef.current = new Map(
        players
          .filter((player) => player && typeof player.id === "string")
          .map((player) => [player.id, player])
      );
      updatePlayerCount();
    });

    socket.on("player:joined", (player) => {
      if (!player || typeof player.id !== "string") return;

      playersRef.current.set(player.id, player);
      updatePlayerCount();
    });

    socket.on("player:moved", (player) => {
      if (!player || typeof player.id !== "string" || player.id === socket.id) {
        return;
      }

      playersRef.current.set(player.id, player);
      updatePlayerCount();
    });

    socket.on("player:renamed", (player) => {
      if (!player || typeof player.id !== "string") return;
      playersRef.current.set(player.id, player);
      setNearbyPlayers((current) =>
        current.map((nearbyPlayer) =>
          nearbyPlayer.id === player.id ? player : nearbyPlayer
        )
      );
    });

    socket.on("player:nearby", (list) => {
      const safe = Array.isArray(list)
        ? list.filter(
            (p) =>
              p &&
              typeof p.id === "string" &&
              Number.isFinite(p.x) &&
              Number.isFinite(p.y)
          )
        : [];
      nearbyRef.current = new Set(safe.map((p) => p.id));
      setNearbyPlayers(safe);
    });

    socket.on("player:left", (id) => {
      if (typeof id !== "string") return;

      playersRef.current.delete(id);
      nearbyRef.current.delete(id);
      setNearbyPlayers((current) => current.filter((p) => p.id !== id));
      closePeer(id);
      updatePlayerCount();
    });

    // Proximity drives the audio sessions.
    socket.on("proximity:enter", (peer) => {
      if (!peer || typeof peer.id !== "string") return;

      if (!audioEnabledRef.current) {
        pendingPeersRef.current.add(peer.id);
        return;
      }

      createPeer(peer.id, socket.id < peer.id);
    });

    socket.on("proximity:leave", (peerId) => {
      if (typeof peerId !== "string") return;
      pendingPeersRef.current.delete(peerId);
      closePeer(peerId);
    });

    socket.on("webrtc:offer", handleOffer);
    socket.on("webrtc:answer", handleAnswer);
    socket.on("webrtc:ice", handleIce);
    socket.on("webrtc:leave", ({ from } = {}) => {
      if (typeof from === "string") closePeer(from);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      for (const peerId of peers.keys()) closePeer(peerId);
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      audioEnabledRef.current = false;
    };
  }, [
    updatePlayerCount,
    createPeer,
    closePeer,
    handleOffer,
    handleAnswer,
    handleIce,
  ]);

  // Keyboard movement and Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const canvasWrap = canvasWrapRef.current;
    if (!canvas || !canvasWrap) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId;
    let lastSent = 0;
    let previousFrame = performance.now();

    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase();
      if (!gameFocusedRef.current) return;
      if (
        !["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(
          key
        )
      ) {
        return;
      }
      if (key.startsWith("arrow")) {
        event.preventDefault();
      }
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
    canvasWrap.addEventListener("focus", handleFocus);
    canvasWrap.addEventListener("blur", handleBlur);
    window.addEventListener("blur", clearKeys);

    function draw(timestamp) {
      const socket = socketRef.current;
      const me = socket?.id;
      const players = playersRef.current;
      const current = me ? players.get(me) : null;
      const keys = keysRef.current;
      const deltaTime = previousFrame
        ? Math.min((timestamp - previousFrame) / 1000, 0.05)
        : 0;
      previousFrame = timestamp;

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

          // Check horizontal and vertical movement separately,
          // allowing the avatar to slide around furniture.
          if (!hitsObstacle(nextX, current.y)) {
            current.x = nextX;
          }

          if (!hitsObstacle(current.x, nextY)) {
            current.y = nextY;
          }

          if (timestamp - lastSent > 40 && socket?.connected) {
            socket.emit("player:move", {
              x: current.x,
              y: current.y,
            });

            lastSent = timestamp;
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
        const isNearby = !isMe && nearbyRef.current.has(player.id);

        if (isNearby) {
          ctx.beginPath();
          ctx.arc(player.x, player.y, 34, 0, Math.PI * 2);
          ctx.strokeStyle = "#fbbf24";
          ctx.lineWidth = 3;
          ctx.globalAlpha = 0.9;
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1;
        }

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
          isMe ? "You" : player.name || `Player ${player.id.slice(0, 4)}`,
          player.x,
          player.y - 34
        );
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      canvasWrap.removeEventListener("focus", handleFocus);
      canvasWrap.removeEventListener("blur", handleBlur);
      window.removeEventListener("blur", clearKeys);
    };
  }, [updatePlayerCount]);

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

      <section className="audio-panel">
        <strong>Proximity audio</strong>
        <form className="player-name-form" onSubmit={setName}>
          <label htmlFor="player-name">Display name</label>
          <input
            id="player-name"
            maxLength={30}
            value={playerName}
            onChange={(event) => setPlayerName(event.target.value)}
            placeholder="Enter your player name"
          />
          <button type="submit" disabled={!connected}>
            Save name
          </button>
        </form>
        {nameError && <p role="alert">{nameError}</p>}
        {audioEnabled ? (
          <>
            <p>
              Microphone {audioMuted ? "muted" : "active"} — move within 100px
              of another player to connect.
            </p>
            <button type="button" onClick={toggleMute}>
              {audioMuted ? "Unmute microphone" : "Mute microphone"}
            </button>
            <button type="button" onClick={disableAudio}>
              Leave voice
            </button>
          </>
        ) : (
          <button type="button" onClick={enableAudio}>
            Enable microphone
          </button>
        )}
        {audioError && <p role="alert">{audioError}</p>}
        {Object.keys(peerStates).length > 0 && (
          <ul>
            {Object.entries(peerStates).map(([id, state]) => (
              <li key={id}>
                {`Player ${id.slice(0, 4)}`} — {state}
              </li>
            ))}
          </ul>
        )}
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

      <p className="note">
        Enable your microphone to talk with players nearby.
      </p>
    </main>
  );
}
