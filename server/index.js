const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const { getNearbyPlayers, PROXIMITY_RADIUS } = require("./proximity");
const { initializeRoomCatalog } = require("./roomCatalog");

const app = express();
const httpServer = http.createServer(app);
let mongoClient;

let db;
let availableRooms = [];

app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST"],
  },
});

const players = new Map();
const proximityState = new Map();
const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const PLAYER_RADIUS = 20;
const DEFAULT_AVATAR_COLOR = "#6ee7b7";
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SPAWN_SPACINGS = [80, 60, 40];
const SPAWN_MARGIN = PLAYER_RADIUS + 20;
const spawnSlots = new Map();

function allocateSpawnPosition() {
  const occupiedPositions = Array.from(spawnSlots.values());
  const minimumSpacing = PLAYER_RADIUS * 2 + 8;

  for (const spacing of SPAWN_SPACINGS) {
    const columns =
      Math.floor((WORLD_WIDTH - SPAWN_MARGIN * 2) / spacing) + 1;
    const rows =
      Math.floor((WORLD_HEIGHT - SPAWN_MARGIN * 2) / spacing) + 1;

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const position = {
          x: SPAWN_MARGIN + column * spacing,
          y: SPAWN_MARGIN + row * spacing,
        };
        const isAvailable = occupiedPositions.every(
          (occupied) =>
            Math.hypot(position.x - occupied.x, position.y - occupied.y) >=
            minimumSpacing
        );

        if (isAvailable) return position;
      }
    }
  }

  return {
    x:
      SPAWN_MARGIN +
      (spawnSlots.size % (WORLD_WIDTH - SPAWN_MARGIN * 2)),
    y:
      SPAWN_MARGIN +
      (Math.floor(
        spawnSlots.size / (WORLD_WIDTH - SPAWN_MARGIN * 2)
      ) %
        (WORLD_HEIGHT - SPAWN_MARGIN * 2)),
  };
}

function publicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    x: player.x,
    y: player.y,
    avatarColor: player.avatarColor || DEFAULT_AVATAR_COLOR,
  };
}

function isNearby(firstId, secondId) {
  const nearby = proximityState.get(firstId);
  return Boolean(nearby && nearby.has(secondId));
}

function emitNearbyPlayers(exceptPlayerId) {
  const activePlayers = Array.from(players.values());
  for (const [playerId, player] of players) {
    if (playerId === exceptPlayerId) continue;
    io.to(playerId).emit(
      "player:nearby",
      getNearbyPlayers(activePlayers, player)
    );
  }
}

function relayVoiceSignal(event, fromId, data, field) {
  const targetId = data && data.targetId;
  const payload = data && data[field];
  if (
    typeof targetId !== "string" ||
    targetId === fromId ||
    !payload ||
    !players.has(fromId) ||
    !players.has(targetId) ||
    !isNearby(fromId, targetId)
  ) {
    return;
  }

  io.to(targetId).emit(event, { fromId, [field]: payload });
}

app.get("/", (req, res) => {
  res.json({
    message: "ProxiSpeak backend is running",
    connectedPlayers: players.size,
  });
});

app.get("/api/rooms", (req, res) => {
  res.json({ rooms: availableRooms });
});

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const spawnPosition = allocateSpawnPosition();
  spawnSlots.set(socket.id, spawnPosition);

  const player = {
    id: socket.id,
    socketId: socket.id,
    name: "",
    avatarColor: DEFAULT_AVATAR_COLOR,
    ...spawnPosition,
  };
  players.set(socket.id, player);
  proximityState.set(socket.id, new Set());

  db.collection("players")
    .updateOne(
      { socketId: socket.id },
      {
        $set: {
          socketId: socket.id,
          name: player.name,
          avatarColor: player.avatarColor,
          x: player.x,
          y: player.y,
          location: [player.x, player.y],
          connected: true,
          updatedAt: new Date(),
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    )
    .catch((error) => {
      console.error("Failed to save player:", error.message);
    });

  socket.emit("world:state", Array.from(players.values()));
  socket.broadcast.emit("player:joined", player);
  emitNearbyPlayers();

  socket.on("voice:ready", (data) => {
    const targetId = data && data.targetId;
    if (
      typeof targetId !== "string" ||
      targetId === socket.id ||
      !players.has(targetId) ||
      !isNearby(socket.id, targetId)
    ) {
      return;
    }
    io.to(targetId).emit("voice:ready", { fromId: socket.id });
  });

  socket.on("voice:offer", (data) => {
    relayVoiceSignal("voice:offer", socket.id, data, "offer");
  });
  socket.on("voice:answer", (data) => {
    relayVoiceSignal("voice:answer", socket.id, data, "answer");
  });
  socket.on("voice:ice-candidate", (data) => {
    relayVoiceSignal("voice:ice-candidate", socket.id, data, "candidate");
  });
  socket.on("voice:leave", (data) => {
    const targetId = data && data.targetId;
    if (
      typeof targetId !== "string" ||
      targetId === socket.id ||
      !players.has(targetId) ||
      !isNearby(socket.id, targetId)
    ) {
      return;
    }
    io.to(targetId).emit("voice:leave", { fromId: socket.id });
  });

  socket.on("player:setName", async (name, callback) => {
    if (typeof name !== "string" || !name.trim()) {
      if (typeof callback === "function") {
        callback({ success: false, error: "Invalid player name" });
      }
      return;
    }

    const currentPlayer = players.get(socket.id);
    if (!currentPlayer) {
      if (typeof callback === "function") {
        callback({ success: false, error: "Player not found" });
      }
      return;
    }

    const updatedName = name.trim().slice(0, 30);
    try {
      const result = await db.collection("players").updateOne(
        { socketId: socket.id },
        {
          $set: {
            name: updatedName,
            updatedAt: new Date(),
            connected: true,
          },
        }
      );

      if (result.matchedCount === 0) {
        if (typeof callback === "function") {
          callback({
            success: false,
            error: "Player record not found in MongoDB",
          });
        }
        return;
      }

      const updatedPlayer = { ...currentPlayer, name: updatedName };
      players.set(socket.id, updatedPlayer);
      io.emit("player:renamed", publicPlayer(updatedPlayer));
      if (typeof callback === "function") {
        callback({ success: true, name: updatedName });
      }
    } catch (error) {
      console.error("Failed to save player name:", error.message);
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    }
  });

  socket.on("player:setAvatarColor", async (color, callback) => {
    if (typeof color !== "string" || !HEX_COLOR_PATTERN.test(color)) {
      if (typeof callback === "function") {
        callback({ success: false, error: "Invalid avatar color" });
      }
      return;
    }

    const currentPlayer = players.get(socket.id);
    if (!currentPlayer) {
      if (typeof callback === "function") {
        callback({ success: false, error: "Player not found" });
      }
      return;
    }

    try {
      const result = await db.collection("players").updateOne(
        { socketId: socket.id },
        {
          $set: {
            avatarColor: color,
            updatedAt: new Date(),
            connected: true,
          },
        }
      );

      if (result.matchedCount === 0) {
        if (typeof callback === "function") {
          callback({
            success: false,
            error: "Player record not found in MongoDB",
          });
        }
        return;
      }

      const updatedPlayer = { ...currentPlayer, avatarColor: color };
      players.set(socket.id, updatedPlayer);
      io.emit("player:avatarColorUpdated", publicPlayer(updatedPlayer));
      if (typeof callback === "function") {
        callback({ success: true, avatarColor: color });
      }
    } catch (error) {
      console.error("Failed to save player avatar color:", error.message);
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    }
  });

  socket.on("chat:send", (messageText, callback) => {
    if (typeof messageText !== "string") {
      if (typeof callback === "function") {
        callback({ success: false, error: "Message must be text." });
      }
      return;
    }

    const text = messageText.trim();
    if (!text) {
      if (typeof callback === "function") {
        callback({ success: false, error: "Message cannot be empty." });
      }
      return;
    }
    if (text.length > 500) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Messages must be 500 characters or fewer.",
        });
      }
      return;
    }

    const sender = players.get(socket.id);
    if (!sender) {
      if (typeof callback === "function") {
        callback({ success: false, error: "Player not found." });
      }
      return;
    }

    const chatMessage = {
      id: `${socket.id}-${Date.now()}`,
      senderId: socket.id,
      name: sender.name,
      avatarColor: sender.avatarColor || DEFAULT_AVATAR_COLOR,
      text,
      timestamp: new Date().toISOString(),
    };
    io.emit("chat:message", chatMessage);
    if (typeof callback === "function") {
      callback({ success: true, id: chatMessage.id });
    }
  });

  socket.on("player:move", async (position) => {
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return;
    }

    const currentPlayer = players.get(socket.id);
    if (!currentPlayer) return;

    const updatedPlayer = {
      ...currentPlayer,
      x: Math.max(
        PLAYER_RADIUS,
        Math.min(WORLD_WIDTH - PLAYER_RADIUS, position.x)
      ),
      y: Math.max(
        PLAYER_RADIUS,
        Math.min(WORLD_HEIGHT - PLAYER_RADIUS, position.y)
      ),
    };
    players.set(socket.id, updatedPlayer);

    try {
      await db.collection("players").updateOne(
        { socketId: socket.id },
        {
          $set: {
            name: updatedPlayer.name,
            avatarColor: updatedPlayer.avatarColor || DEFAULT_AVATAR_COLOR,
            x: updatedPlayer.x,
            y: updatedPlayer.y,
            location: [updatedPlayer.x, updatedPlayer.y],
            connected: true,
            updatedAt: new Date(),
          },
        }
      );

      io.emit("player:moved", updatedPlayer);
      const nearbyPlayers = await db
        .collection("players")
        .find({
          socketId: { $ne: socket.id },
          connected: true,
          location: {
            $near: [updatedPlayer.x, updatedPlayer.y],
            $maxDistance: PROXIMITY_RADIUS,
          },
        })
        .project({
          _id: 0,
          socketId: 1,
          name: 1,
          avatarColor: 1,
          x: 1,
          y: 1,
        })
        .toArray();

      const nearbyList = nearbyPlayers
        .filter((nearbyPlayer) => players.has(nearbyPlayer.socketId))
        .map((nearbyPlayer) => ({
          id: nearbyPlayer.socketId,
          socketId: nearbyPlayer.socketId,
          name: nearbyPlayer.name,
          avatarColor: nearbyPlayer.avatarColor || DEFAULT_AVATAR_COLOR,
          x: nearbyPlayer.x,
          y: nearbyPlayer.y,
        }));

      socket.emit("player:nearby", nearbyList);
      const newNearby = new Set(nearbyList.map((nearbyPlayer) => nearbyPlayer.id));
      const oldNearby = proximityState.get(socket.id) || new Set();

      for (const peerId of newNearby) {
        if (oldNearby.has(peerId)) continue;
        socket.emit(
          "proximity:enter",
          nearbyList.find((nearbyPlayer) => nearbyPlayer.id === peerId)
        );
        io.to(peerId).emit("proximity:enter", publicPlayer(updatedPlayer));
        const peerSet = proximityState.get(peerId) || new Set();
        peerSet.add(socket.id);
        proximityState.set(peerId, peerSet);
      }

      for (const peerId of oldNearby) {
        if (newNearby.has(peerId)) continue;
        socket.emit("proximity:leave", peerId);
        io.to(peerId).emit("proximity:leave", socket.id);
        socket.emit("voice:leave", { fromId: peerId });
        io.to(peerId).emit("voice:leave", { fromId: socket.id });
        const peerSet = proximityState.get(peerId);
        if (peerSet) peerSet.delete(socket.id);
      }

      proximityState.set(socket.id, newNearby);
      emitNearbyPlayers(socket.id);
    } catch (error) {
      console.error(
        "Failed to update position/find nearby players:",
        error.message
      );
    }
  });

  socket.on("disconnect", () => {
    const nearby = proximityState.get(socket.id) || new Set();
    for (const peerId of nearby) {
      io.to(peerId).emit("proximity:leave", socket.id);
      io.to(peerId).emit("voice:leave", { fromId: socket.id });
      const peerSet = proximityState.get(peerId);
      if (peerSet) peerSet.delete(socket.id);
    }

    players.delete(socket.id);
    proximityState.delete(socket.id);
    spawnSlots.delete(socket.id);

    db.collection("players")
      .updateOne(
        { socketId: socket.id },
        { $set: { connected: false, updatedAt: new Date() } }
      )
      .catch((error) => {
        console.error("Failed to update player status:", error.message);
      });

    io.emit("player:left", socket.id);
    emitNearbyPlayers();
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

function safeErrorMessage(error) {
  let message = error instanceof Error ? error.message : String(error);
  const uri = process.env.MONGODB_URI;
  if (uri) message = message.split(uri).join("[REDACTED MONGODB_URI]");
  return message.replace(
    /mongodb(?:\+srv)?:\/\/[^\s"'<>]+/gi,
    "mongodb://[REDACTED]"
  );
}

async function startServer() {
  let startupPhase = "MongoDB configuration";

  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error("MONGODB_URI is not set in server/.env");
    }
    if (!/^mongodb(?:\+srv)?:\/\//i.test(mongoUri)) {
      throw new Error(
        "MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme"
      );
    }

    mongoClient = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });

    startupPhase = "MongoDB connection";
    await mongoClient.connect();

    startupPhase = "MongoDB initialization";
    db = mongoClient.db("proxispeak");
    availableRooms = await initializeRoomCatalog(db);
    console.log("Room catalog loaded:", availableRooms.length);

    const collection = db.collection("players");
    const cleanupResult = await collection.updateMany(
      { connected: true },
      { $set: { connected: false, updatedAt: new Date() } }
    );
    console.log(
      "Old player sessions marked as disconnected:",
      cleanupResult.modifiedCount
    );

    const existingIndexes = await collection.listIndexes().toArray();
    const locationIndex = existingIndexes.find(
      (index) => index.key && index.key.location
    );
    if (locationIndex) await collection.dropIndex(locationIndex.name);

    await collection.createIndex(
      { location: "2d" },
      { min: 0, max: Math.max(WORLD_WIDTH, WORLD_HEIGHT) }
    );
    console.log("MongoDB 2d geospatial index ready!");
    console.log("MongoDB connected successfully!");

    startupPhase = "HTTP server startup";
    httpServer.once("error", (error) => {
      console.error("HTTP server startup failed:", safeErrorMessage(error));
      process.exitCode = 1;
      mongoClient.close().catch((closeError) => {
        console.error(
          "MongoDB connection cleanup failed:",
          safeErrorMessage(closeError)
        );
      });
    });
    httpServer.listen(PORT, () => {
      console.log(`ProxiSpeak server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error(`${startupPhase} failed:`, safeErrorMessage(error));
    if (mongoClient) {
      await mongoClient.close().catch((closeError) => {
        console.error(
          "MongoDB connection cleanup failed:",
          safeErrorMessage(closeError)
        );
      });
    }
    process.exitCode = 1;
  }
}

startServer();
