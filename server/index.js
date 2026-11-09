// server/index.js

require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const {
  connectDB,
  closeDB
} = require("./db");

const {
  PROXIMITY_DISTANCE,
  savePlayer,
  removePlayer,
  getPlayer,
  findNearbyPlayers,
  arePlayersNearby
} = require("./proximity");

const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT) || 3000;

const CLIENT_URL =
  process.env.CLIENT_URL || "http://localhost:5173";

app.use(cors({
  origin: CLIENT_URL,
  methods: ["GET", "POST"]
}));

app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"]
  }
});

app.get("/", (req, res) => {
  res.json({
    message: "ProxiSpeak server is running",
    status: "OK"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "ProxiSpeak"
  });
});

// Active players connected to this server.
const activePlayers = new Map();

// Tracks players who have joined voice communication.
const voiceParticipants = new Set();

function getCoordinates(data) {
  const source = data?.position || data?.location || data || {};

  const x = Number(source.x);
  const y = Number(source.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function getPlayerPayload(player) {
  return {
    id: player.socketId,
    socketId: player.socketId,
    name: player.name,
    x: player.x,
    y: player.y,
    position: {
      x: player.x,
      y: player.y
    }
  };
}

async function updatePlayerProximity(socketId) {
  const currentPlayer = activePlayers.get(socketId);

  if (!currentPlayer) return;

  const nearbyPlayers = await findNearbyPlayers(
    currentPlayer.x,
    currentPlayer.y,
    socketId
  );

  const nearbyIds = new Set(
    nearbyPlayers.map((player) => player.socketId)
  );

  const previousIds = currentPlayer.nearbyIds || new Set();

  const nearbyPayload = nearbyPlayers.map((player) => ({
    id: player.socketId,
    socketId: player.socketId,
    name: player.name,
    x: player.x,
    y: player.y,
    position: {
      x: player.x,
      y: player.y
    }
  }));

  io.to(socketId).emit("player:nearby", nearbyPayload);

  // Notify when another player enters the 100-pixel range.
  for (const nearbyId of nearbyIds) {
    if (!previousIds.has(nearbyId)) {
      io.to(socketId).emit("proximity:enter", {
        playerId: nearbyId
      });

      io.to(nearbyId).emit("proximity:enter", {
        playerId: socketId
      });
    }
  }

  // Notify when another player leaves the 100-pixel range.
  for (const previousId of previousIds) {
    if (!nearbyIds.has(previousId)) {
      io.to(socketId).emit("proximity:leave", {
        playerId: previousId
      });

      io.to(previousId).emit("proximity:leave", {
        playerId: socketId
      });
    }
  }

  currentPlayer.nearbyIds = nearbyIds;
}

async function canRelayVoice(senderId, receiverId) {
  if (!senderId || !receiverId || senderId === receiverId) {
    return false;
  }

  if (!activePlayers.has(senderId) || !activePlayers.has(receiverId)) {
    return false;
  }

  if (
    !voiceParticipants.has(senderId) ||
    !voiceParticipants.has(receiverId)
  ) {
    return false;
  }

  return arePlayersNearby(senderId, receiverId);
}

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Register a player.
  socket.on("player:join", async (data = {}) => {
    try {
      const coordinates = getCoordinates(data) || { x: 0, y: 0 };

      const player = {
        socketId: socket.id,
        name: data.name || "Anonymous",
        x: coordinates.x,
        y: coordinates.y,
        nearbyIds: new Set()
      };

      activePlayers.set(socket.id, player);

      await savePlayer(player);

      socket.emit("player:joined", getPlayerPayload(player));

      // Send currently connected players to the newly joined player.
      const allPlayers = Array.from(activePlayers.values())
        .filter((item) => item.socketId !== socket.id)
        .map(getPlayerPayload);

      socket.emit("players:update", allPlayers);

      await updatePlayerProximity(socket.id);

      // Update existing players about the newly joined player.
      for (const otherPlayer of activePlayers.values()) {
        if (otherPlayer.socketId !== socket.id) {
          io.to(otherPlayer.socketId).emit(
            "player:connected",
            getPlayerPayload(player)
          );

          await updatePlayerProximity(otherPlayer.socketId);
        }
      }
    } catch (error) {
      console.error("Player join error:", error.message);
      socket.emit("server:error", {
        message: "Unable to register player."
      });
    }
  });

  // Update player position.
  socket.on("player:move", async (data = {}) => {
    try {
      const player = activePlayers.get(socket.id);
      if (!player) return;

      const coordinates = getCoordinates(data);
      if (!coordinates) return;

      player.x = coordinates.x;
      player.y = coordinates.y;

      await savePlayer(player);

      const payload = getPlayerPayload(player);

      // Broadcast movement to all other connected players.
      socket.broadcast.emit("player:moved", payload);

      await updatePlayerProximity(socket.id);

      // Recalculate proximity for other players too.
      for (const otherPlayer of activePlayers.values()) {
        if (otherPlayer.socketId !== socket.id) {
          await updatePlayerProximity(otherPlayer.socketId);
        }
      }
    } catch (error) {
      console.error("Player movement error:", error.message);
    }
  });

  // A player joins voice communication.
  socket.on("voice:join", async () => {
    if (!activePlayers.has(socket.id)) return;

    voiceParticipants.add(socket.id);

    const player = activePlayers.get(socket.id);

    const nearbyPlayers = await findNearbyPlayers(
      player.x,
      player.y,
      socket.id
    );

    const eligiblePeers = nearbyPlayers
      .filter((item) => voiceParticipants.has(item.socketId))
      .map((item) => item.socketId);

    socket.emit("voice:peers", eligiblePeers);

    for (const peerId of eligiblePeers) {
      io.to(peerId).emit("voice:peer-joined", {
        peerId: socket.id
      });
    }
  });

  // A player requests a peer connection.
  socket.on("voice:request-peer", async (data = {}) => {
    try {
      const peerId =
        typeof data === "string"
          ? data
          : data.peerId || data.to || data.socketId;

      if (!(await canRelayVoice(socket.id, peerId))) {
        socket.emit("voice:peer-rejected", {
          peerId,
          reason: "Player is outside the 100-pixel voice range."
        });
        return;
      }

      io.to(peerId).emit("voice:peer-request", {
        peerId: socket.id
      });
    } catch (error) {
      console.error("Voice peer request error:", error.message);
    }
  });

  // WebRTC offer relay.
  socket.on("webrtc:offer", async (data = {}) => {
    try {
      const receiverId = data.to || data.peerId;

      if (!(await canRelayVoice(socket.id, receiverId))) {
        socket.emit("webrtc:error", {
          message: "Offer blocked: peer is outside the 100-pixel range."
        });
        return;
      }

      io.to(receiverId).emit("webrtc:offer", {
        from: socket.id,
        offer: data.offer
      });
    } catch (error) {
      console.error("WebRTC offer error:", error.message);
    }
  });

  // WebRTC answer relay.
  socket.on("webrtc:answer", async (data = {}) => {
    try {
      const receiverId = data.to || data.peerId;

      if (!(await canRelayVoice(socket.id, receiverId))) {
        socket.emit("webrtc:error", {
          message: "Answer blocked: peer is outside the 100-pixel range."
        });
        return;
      }

      io.to(receiverId).emit("webrtc:answer", {
        from: socket.id,
        answer: data.answer
      });
    } catch (error) {
      console.error("WebRTC answer error:", error.message);
    }
  });

  // ICE candidate relay.
  socket.on("webrtc:ice-candidate", async (data = {}) => {
    try {
      const receiverId = data.to || data.peerId;

      if (!(await canRelayVoice(socket.id, receiverId))) {
        return;
      }

      io.to(receiverId).emit("webrtc:ice-candidate", {
        from: socket.id,
        candidate: data.candidate
      });
    } catch (error) {
      console.error("ICE candidate relay error:", error.message);
    }
  });

  // Leave voice communication.
  socket.on("voice:leave", () => {
    voiceParticipants.delete(socket.id);

    for (const peerId of voiceParticipants) {
      io.to(peerId).emit("voice:peer-left", {
        peerId: socket.id
      });
    }
  });

  // Disconnect cleanup.
  socket.on("disconnect", async () => {
    console.log(`Player disconnected: ${socket.id}`);

    voiceParticipants.delete(socket.id);

    const player = activePlayers.get(socket.id);

    if (player) {
      for (const peerId of player.nearbyIds || []) {
        io.to(peerId).emit("proximity:leave", {
          playerId: socket.id
        });
      }
    }

    activePlayers.delete(socket.id);

    try {
      await removePlayer(socket.id);
    } catch (error) {
      console.error("MongoDB player cleanup error:", error.message);
    }

    socket.broadcast.emit("player:disconnected", {
      id: socket.id,
      socketId: socket.id
    });
  });
});

async function startServer() {
  try {
    await connectDB();

    server.listen(PORT, () => {
      console.log(
        `ProxiSpeak server listening on http://localhost:${PORT}`
      );
      console.log(
        `Voice proximity distance: ${PROXIMITY_DISTANCE} pixels`
      );
    });
  } catch (error) {
    console.error("Unable to start ProxiSpeak server:", error);
    process.exit(1);
  }
}

async function shutdown() {
  console.log("Shutting down ProxiSpeak server...");

  server.close(async () => {
    await closeDB();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startServer();
