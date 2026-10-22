

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();
const { MongoClient } = require("mongodb");

const app = express();
const httpServer = http.createServer(app);

const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
});

let db;

app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST"],
  },
});

const players = new Map();

// Tracks which players are currently within proximity of each other.
// Drives the enter/leave events and gates the WebRTC signaling relay.
const proximityState = new Map();

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const PROXIMITY_RADIUS = 100;
const PLAYER_RADIUS = 20;
const SPAWN_SPACINGS = [80, 60, 40];
const SPAWN_MARGIN = PLAYER_RADIUS + 20;
const spawnSlots = new Map();

function allocateSpawnPosition() {
  const occupiedPositions = Array.from(spawnSlots.values());
  const minimumSpacing = PLAYER_RADIUS * 2 + 8;

  for (const spacing of SPAWN_SPACINGS) {
    const columns = Math.floor((WORLD_WIDTH - SPAWN_MARGIN * 2) / spacing) + 1;
    const rows = Math.floor((WORLD_HEIGHT - SPAWN_MARGIN * 2) / spacing) + 1;

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
    x: SPAWN_MARGIN + (spawnSlots.size % (WORLD_WIDTH - SPAWN_MARGIN * 2)),
    y:
      SPAWN_MARGIN +
      (Math.floor(spawnSlots.size / (WORLD_WIDTH - SPAWN_MARGIN * 2)) %
        (WORLD_HEIGHT - SPAWN_MARGIN * 2)),
  };
}

app.get("/", (req, res) => {
  res.json({
    message: "ProxiSpeak backend is running",
    connectedPlayers: players.size,
  });
});

function publicPlayer(player) {
  return { id: player.id, name: player.name, x: player.x, y: player.y };
}

function isNearby(aId, bId) {
  const set = proximityState.get(aId);
  return Boolean(set && set.has(bId));
}

// Relay a WebRTC signal to a peer, but only when the two are within proximity.
function relaySignal(event, fromId, toId, payload) {
  if (typeof toId !== "string" || toId === fromId) return;
  if (!isNearby(fromId, toId)) return;

  io.to(toId).emit(event, { ...payload, from: fromId });
}

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const spawnPosition = allocateSpawnPosition();
  spawnSlots.set(socket.id, spawnPosition);

  const player = {
    id: socket.id,
    socketId: socket.id,
    name: "",
    ...spawnPosition,
  };

  players.set(socket.id, player);

  // Save the player's initial position.
  db.collection("players")
    .updateOne(
      { socketId: socket.id },
      {
        $set: {
          socketId: socket.id,
          name: player.name,
          x: player.x,
          y: player.y,
          location: [player.x, player.y],
          connected: true,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          createdAt: new Date(),
        },
      },
      { upsert: true }
    )
    .catch((error) => {
      console.error("Failed to save player:", error.message);
    });

  socket.emit("world:state", Array.from(players.values()));
  socket.broadcast.emit("player:joined", player);

  // WebRTC signaling — relayed only between players within proximity.
  socket.on("webrtc:offer", (data) => {
    relaySignal("webrtc:offer", socket.id, data && data.to, {
      sdp: data && data.sdp,
    });
  });

  socket.on("webrtc:answer", (data) => {
    relaySignal("webrtc:answer", socket.id, data && data.to, {
      sdp: data && data.sdp,
    });
  });

  socket.on("webrtc:ice", (data) => {
    relaySignal("webrtc:ice", socket.id, data && data.to, {
      candidate: data && data.candidate,
    });
  });

  // Save the player's name.
  socket.on("player:setName", async (name, callback) => {
    if (typeof name !== "string" || !name.trim()) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Invalid player name",
        });
      }
      return;
    }

    const currentPlayer = players.get(socket.id);

    if (!currentPlayer) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Player not found",
        });
      }
      return;
    }

    currentPlayer.name = name.trim().slice(0, 30);

    try {
      const result = await db.collection("players").updateOne(
        { socketId: socket.id },
        {
          $set: {
            name: currentPlayer.name,
            updatedAt: new Date(),
            connected: true,
          },
        }
      );

      console.log("Player name:", currentPlayer.name);
      console.log("MongoDB matched:", result.matchedCount);

      if (result.matchedCount === 0) {
        if (typeof callback === "function") {
          callback({
            success: false,
            error: "Player record not found in MongoDB",
          });
        }
        return;
      }

      players.set(socket.id, currentPlayer);
      io.emit("player:renamed", currentPlayer);

      if (typeof callback === "function") {
        callback({
          success: true,
          name: currentPlayer.name,
        });
      }
    } catch (error) {
      console.error("Failed to save player name:", error.message);

      if (typeof callback === "function") {
        callback({
          success: false,
          error: error.message,
        });
      }
    }
  });

  // Update position and find nearby players using MongoDB $near.
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
      x: Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, position.x)),
      y: Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, position.y)),
    };

    players.set(socket.id, updatedPlayer);

    try {
      await db.collection("players").updateOne(
        { socketId: socket.id },
        {
          $set: {
            name: updatedPlayer.name,
            x: updatedPlayer.x,
            y: updatedPlayer.y,
            location: [updatedPlayer.x, updatedPlayer.y],
            connected: true,
            updatedAt: new Date(),
          },
        }
      );

      io.emit("player:moved", updatedPlayer);

      // Find connected players within 100 pixels.
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
          x: 1,
          y: 1,
        })
        .toArray();

      const nearbyList = nearbyPlayers.map((nearbyPlayer) => ({
        id: nearbyPlayer.socketId,
        socketId: nearbyPlayer.socketId,
        name: nearbyPlayer.name,
        x: nearbyPlayer.x,
        y: nearbyPlayer.y,
      }));

      socket.emit("player:nearby", nearbyList);

      // Proximity transitions: tell both sides who just entered / left range.
      const newNearby = new Set(nearbyList.map((p) => p.id));
      const oldNearby = proximityState.get(socket.id) || new Set();

      for (const id of newNearby) {
        if (oldNearby.has(id)) continue;

        socket.emit("proximity:enter", nearbyList.find((p) => p.id === id));
        io.to(id).emit("proximity:enter", publicPlayer(updatedPlayer));

        const peerSet = proximityState.get(id) || new Set();
        peerSet.add(socket.id);
        proximityState.set(id, peerSet);
      }

      for (const id of oldNearby) {
        if (newNearby.has(id)) continue;

        socket.emit("proximity:leave", id);
        io.to(id).emit("proximity:leave", socket.id);

        const peerSet = proximityState.get(id);
        if (peerSet) peerSet.delete(socket.id);
      }

      proximityState.set(socket.id, newNearby);

      console.log(
        "Nearby players for",
        updatedPlayer.name || updatedPlayer.id,
        ":",
        nearbyList.length
      );
    } catch (error) {
      console.error(
        "Failed to update position/find nearby players:",
        error.message
      );
    }
  });

  // Mark the player disconnected.
  socket.on("disconnect", () => {
    players.delete(socket.id);
    spawnSlots.delete(socket.id);

    // Let proximity peers tear down their audio connections.
    const nearSet = proximityState.get(socket.id);
    if (nearSet) {
      for (const id of nearSet) {
        io.to(id).emit("proximity:leave", socket.id);
        const peerSet = proximityState.get(id);
        if (peerSet) peerSet.delete(socket.id);
      }
      proximityState.delete(socket.id);
    }

    db.collection("players")
      .updateOne(
        { socketId: socket.id },
        {
          $set: {
            connected: false,
            updatedAt: new Date(),
          },
        }
      )
      .catch((error) => {
        console.error(
          "Failed to update player status:",
          error.message
        );
      });

    io.emit("player:left", socket.id);
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await mongoClient.connect();
    db = mongoClient.db("proxispeak");

    const collection = db.collection("players");

    // Mark old sessions disconnected after a server restart.
    const cleanupResult = await collection.updateMany(
      { connected: true },
      {
        $set: {
          connected: false,
          updatedAt: new Date(),
        },
      }
    );

    console.log(
      "Old player sessions marked as disconnected:",
      cleanupResult.modifiedCount
    );

    // Ensure the location field has a 2d geospatial index.
    const existingIndexes = await collection.listIndexes().toArray();

    const locationIndex = existingIndexes.find(
      (index) => index.key && index.key.location
    );

    if (locationIndex && locationIndex.key.location !== "2d") {
      await collection.dropIndex(locationIndex.name);
    }

    await collection.createIndex({ location: "2d" });

    console.log("MongoDB 2d geospatial index ready!");
    console.log("MongoDB connected successfully!");

    httpServer.listen(PORT, () => {
      console.log(`ProxiSpeak server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exitCode = 1;
  }
}

startServer();