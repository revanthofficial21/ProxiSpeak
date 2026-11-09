require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const { connectDB, closeDB } = require("./db");

const {
  PROXIMITY_DISTANCE,
  savePlayer,
  removePlayer,
  findNearbyPlayers
} = require("./proximity");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

let databaseConnected = false;

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"]
  },
  pingInterval: 25000,
  pingTimeout: 20000
});

const activePlayers = new Map();
const voiceParticipants = new Set();
const nearbyConnections = new Map();

app.get("/", (req, res) => {
  res.json({
    application: "ProxiSpeak",
    status: "running",
    database: databaseConnected ? "connected" : "disconnected",
    connectedPlayers: activePlayers.size,
    proximityDistance: PROXIMITY_DISTANCE
  });
});

app.get("/health", (req, res) => {
  res.status(databaseConnected ? 200 : 503).json({
    status: databaseConnected ? "healthy" : "degraded",
    database: databaseConnected ? "connected" : "disconnected",
    connectedPlayers: activePlayers.size
  });
});

function validCoordinates(x, y) {
  return (
    Number.isFinite(Number(x)) &&
    Number.isFinite(Number(y)) &&
    Number(x) >= 0 &&
    Number(y) >= 0 &&
    Number(x) <= 2000 &&
    Number(y) <= 2000
  );
}

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function getPlayerInfo(socketId) {
  return activePlayers.get(socketId);
}

function getOfficePlayers(officeId, excludeId = null) {
  return Array.from(activePlayers.values()).filter(
    player =>
      player.officeId === officeId &&
      player.socketId !== excludeId
  );
}

function getMemoryNearby(socketId) {
  const player = getPlayerInfo(socketId);

  if (!player) return [];

  return getOfficePlayers(player.officeId, socketId).filter(
    other => distanceBetween(player, other) <= PROXIMITY_DISTANCE
  );
}

async function getNearby(socketId) {
  const player = getPlayerInfo(socketId);

  if (!player) return [];

  // Use MongoDB geospatial lookup when available.
  if (databaseConnected) {
    try {
      await findNearbyPlayers(
        player.x,
        player.y,
        socketId,
        player.officeId
      );
    } catch (error) {
      console.error("MongoDB proximity lookup failed:", error.message);
    }
  }

  // Use live socket positions for current connected players.
  return getMemoryNearby(socketId);
}

async function persistPlayer(player) {
  if (!databaseConnected) return;

  try {
    await savePlayer(player);
  } catch (error) {
    console.error("Player persistence error:", error.message);
  }
}

async function updateNearby(socketId) {
  const player = getPlayerInfo(socketId);

  if (!player) return;

  try {
    const nearbyPlayers = await getNearby(socketId);

    io.to(socketId).emit("player:nearby", nearbyPlayers);

    const previous = nearbyConnections.get(socketId) || new Set();

    const current = new Set(
      nearbyPlayers.map(item => item.socketId)
    );

    for (const nearby of nearbyPlayers) {
      if (!previous.has(nearby.socketId)) {
        io.to(socketId).emit("proximity:enter", nearby);

        io.to(nearby.socketId).emit("proximity:enter", {
          socketId: player.socketId,
          name: player.name,
          x: player.x,
          y: player.y
        });
      }
    }

    for (const oldId of previous) {
      if (!current.has(oldId)) {
        io.to(socketId).emit("proximity:leave", {
          socketId: oldId
        });

        io.to(oldId).emit("proximity:leave", {
          socketId
        });

        io.to(oldId).emit("voice:peer-left", {
          socketId
        });

        io.to(socketId).emit("voice:peer-left", {
          socketId: oldId
        });
      }
    }

    nearbyConnections.set(socketId, current);
  } catch (error) {
    console.error("Proximity update error:", error.message);
  }
}

function canRelayVoice(from, to) {
  if (!from || !to || from === to) return false;

  const sender = getPlayerInfo(from);
  const receiver = getPlayerInfo(to);

  if (!sender || !receiver) return false;

  if (!voiceParticipants.has(from) || !voiceParticipants.has(to)) {
    return false;
  }

  if (sender.officeId !== receiver.officeId) return false;

  return distanceBetween(sender, receiver) <= PROXIMITY_DISTANCE;
}

io.on("connection", socket => {
  console.log("Player connected:", socket.id);

  // JOIN OFFICE
  socket.on("player:join", async (data = {}) => {
    try {
      if (activePlayers.has(socket.id)) return;

      const player = {
        socketId: socket.id,
        name: String(data.name || "Anonymous").trim().slice(0, 30),
        x: Number(data.x ?? 100),
        y: Number(data.y ?? 100),
        officeId: String(data.officeId || "main-office").slice(0, 60)
      };

      if (!validCoordinates(player.x, player.y)) {
        socket.emit("server:error", {
          message: "Invalid player coordinates."
        });
        return;
      }

      activePlayers.set(socket.id, player);
      socket.join(player.officeId);

      await persistPlayer(player);

      const officePlayers = getOfficePlayers(
        player.officeId,
        socket.id
      );

      socket.emit("world:state", officePlayers);

      socket.to(player.officeId).emit("player:joined", player);

      nearbyConnections.set(socket.id, new Set());

      await updateNearby(socket.id);

      for (const other of officePlayers) {
        await updateNearby(other.socketId);
      }

      console.log("Player joined:", player.name);
    } catch (error) {
      console.error("Join error:", error.message);

      activePlayers.delete(socket.id);

      socket.emit("server:error", {
        message: "Unable to join the office."
      });
    }
  });

  // PLAYER POSITION
  socket.on("player:move", async (data = {}) => {
    const player = getPlayerInfo(socket.id);

    if (!player) return;

    const x = Number(data.x);
    const y = Number(data.y);

    if (!validCoordinates(x, y)) return;

    player.x = x;
    player.y = y;

    await persistPlayer(player);

    socket.to(player.officeId).emit("player:moved", {
      socketId: socket.id,
      name: player.name,
      x,
      y
    });

    await updateNearby(socket.id);

    const officePlayers = getOfficePlayers(
      player.officeId,
      socket.id
    );

    for (const other of officePlayers) {
      await updateNearby(other.socketId);
    }
  });

  // RETURN CURRENT PLAYER POSITION
  socket.on("player:get-position", callback => {
    const player = getPlayerInfo(socket.id);

    if (typeof callback === "function") {
      callback(
        player
          ? { x: player.x, y: player.y }
          : null
      );
    }
  });

  // JOIN VOICE CHAT
  socket.on("voice:join", async () => {
    if (!activePlayers.has(socket.id)) return;

    voiceParticipants.add(socket.id);

    const nearby = await getNearby(socket.id);

    socket.emit("voice:nearby", nearby);
  });

  // REQUEST PEER CONNECTION
  socket.on("voice:request-peer", async (data = {}) => {
    const targetId = data.to;

    if (!canRelayVoice(socket.id, targetId)) return;

    // Only one side initiates the connection.
    if (socket.id > targetId) return;

    io.to(targetId).emit("voice:peer-request", {
      from: socket.id
    });
  });

  // WEBRTC OFFER
  socket.on("webrtc:offer", data => {
    const targetId = data.to;

    if (!canRelayVoice(socket.id, targetId)) return;
    if (!data.offer) return;

    io.to(targetId).emit("webrtc:offer", {
      from: socket.id,
      offer: data.offer
    });
  });

  // WEBRTC ANSWER
  socket.on("webrtc:answer", data => {
    const targetId = data.to;

    if (!canRelayVoice(socket.id, targetId)) return;
    if (!data.answer) return;

    io.to(targetId).emit("webrtc:answer", {
      from: socket.id,
      answer: data.answer
    });
  });

  // ICE CANDIDATE
  socket.on("webrtc:ice-candidate", data => {
    const targetId = data.to;

    if (!canRelayVoice(socket.id, targetId)) return;
    if (!data.candidate) return;

    io.to(targetId).emit("webrtc:ice-candidate", {
      from: socket.id,
      candidate: data.candidate
    });
  });

  // LEAVE VOICE CHAT
  socket.on("voice:leave", () => {
    voiceParticipants.delete(socket.id);

    for (const targetId of voiceParticipants) {
      io.to(targetId).emit("voice:peer-left", {
        socketId: socket.id
      });
    }
  });

  // DISCONNECT
  socket.on("disconnect", async () => {
    try {
      const player = getPlayerInfo(socket.id);

      activePlayers.delete(socket.id);
      voiceParticipants.delete(socket.id);
      nearbyConnections.delete(socket.id);

      for (const [otherId, connections] of nearbyConnections) {
        if (connections.has(socket.id)) {
          connections.delete(socket.id);

          io.to(otherId).emit("proximity:leave", {
            socketId: socket.id
          });

          io.to(otherId).emit("voice:peer-left", {
            socketId: socket.id
          });
        }
      }

      if (databaseConnected) {
        try {
          await removePlayer(socket.id);
        } catch (error) {
          console.error("Player removal error:", error.message);
        }
      }

      if (player) {
        socket.to(player.officeId).emit("player:left", {
          socketId: socket.id
        });

        const remainingPlayers = getOfficePlayers(player.officeId);

        for (const other of remainingPlayers) {
          await updateNearby(other.socketId);
        }

        console.log("Player disconnected:", player.name);
      }
    } catch (error) {
      console.error("Disconnect error:", error.message);
    }
  });
});

// START SERVER
async function startServer() {
  try {
    try {
      await connectDB();
      databaseConnected = true;
      console.log("MongoDB connected successfully.");
    } catch (error) {
      databaseConnected = false;
      console.error("MongoDB connection failed:", error.message);
      console.log("Starting in-memory mode. Database persistence is unavailable.");
    }

    server.listen(PORT, () => {
      console.log(`ProxiSpeak server running at http://localhost:${PORT}`);
      console.log(`Proximity distance: ${PROXIMITY_DISTANCE}px`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

// GRACEFUL SHUTDOWN
async function shutdown() {
  console.log("Shutting down ProxiSpeak...");

  io.close(async () => {
    if (databaseConnected) {
      try {
        await closeDB();
      } catch (error) {
        console.error("Database shutdown error:", error.message);
      }
    }

    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startServer();
