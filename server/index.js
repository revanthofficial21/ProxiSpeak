

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();
const { MongoClient } = require("mongodb");
const {
  markPlayerConnected,
  markPlayerDisconnected,
  restoreReturningPlayer,
} = require("./lib/player-persistence");
const { initializeRoomCatalog } = require("./lib/roomCatalog");
const {
  DEFAULT_ROOM,
  normalizeRoomName,
  roomChannel,
  getPlayersInRoom,
} = require("./lib/rooms");
const {
  canJoinMeetingCall,
  getMeetingCallParticipants,
  canRelayWebRtcSignal,
} = require("./lib/meeting-call");
const { createChatMessage } = require("./lib/chat");

const app = express();
const httpServer = http.createServer(app);

const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
});

let db;
let availableRooms = [];

app.use(cors());
app.use(express.json());

// The room catalog. This is a list only — players are not yet scoped to a
// room, so everyone still shares one world.
app.get("/api/rooms", (req, res) => {
  res.json({ rooms: availableRooms });
});

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

// Players currently in the Meeting Room call (talk regardless of distance).
const meetingCallParticipants = new Set();

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const PROXIMITY_RADIUS = 100;
const DEFAULT_AVATAR_COLOR = "#6ee7b7";
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
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
  return {
    id: player.id,
    name: player.name,
    avatarColor: player.avatarColor || DEFAULT_AVATAR_COLOR,
    status: player.status || "",
    x: player.x,
    y: player.y,
  };
}

// Relay a WebRTC signal to a peer, but only when the two are in the same space
// and within proximity (or are members of the meeting call).
function relaySignal(event, fromId, toId, payload) {
  // Only same-room, in-range peers — or members of the meeting call — may
  // exchange WebRTC signals.
  if (
    !canRelayWebRtcSignal(
      fromId,
      toId,
      players,
      proximityState,
      meetingCallParticipants
    )
  ) {
    return;
  }

  io.to(toId).emit(event, { ...payload, fromId });
}

// Group a player by proximity: send them the nearby list and tell both sides
// who just entered / left range. Run on connect and on every move.
async function syncProximity(socketId, player) {
  const nearbyPlayers = await db
    .collection("players")
    .find({
      socketId: { $ne: socketId },
      connected: true,
      location: {
        $near: [player.x, player.y],
        $maxDistance: PROXIMITY_RADIUS,
      },
    })
    .project({ _id: 0, socketId: 1, name: 1, avatarColor: 1, x: 1, y: 1 })
    .toArray();

  // Keep only peers in the SAME space — rooms scope who can hear whom.
  const nearbyList = nearbyPlayers
    .filter((nearbyPlayer) => {
      const peer = players.get(nearbyPlayer.socketId);
      return peer && peer.room === player.room;
    })
    .map((nearbyPlayer) => ({
      id: nearbyPlayer.socketId,
      socketId: nearbyPlayer.socketId,
      name: nearbyPlayer.name,
      avatarColor: nearbyPlayer.avatarColor || DEFAULT_AVATAR_COLOR,
      x: nearbyPlayer.x,
      y: nearbyPlayer.y,
    }));

  io.to(socketId).emit("player:nearby", nearbyList);

  const newNearby = new Set(nearbyList.map((p) => p.id));
  const oldNearby = proximityState.get(socketId) || new Set();

  for (const id of newNearby) {
    if (oldNearby.has(id)) continue;

    io.to(socketId).emit("proximity:enter", nearbyList.find((p) => p.id === id));
    io.to(id).emit("proximity:enter", publicPlayer(player));

    const peerSet = proximityState.get(id) || new Set();
    peerSet.add(socketId);
    proximityState.set(id, peerSet);
  }

  for (const id of oldNearby) {
    if (newNearby.has(id)) continue;

    io.to(socketId).emit("proximity:leave", id);
    io.to(id).emit("proximity:leave", socketId);

    const peerSet = proximityState.get(id);
    if (peerSet) peerSet.delete(socketId);
  }

  proximityState.set(socketId, newNearby);
  return nearbyList.length;
}

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const spawnPosition = allocateSpawnPosition();
  spawnSlots.set(socket.id, spawnPosition);

  const player = {
    id: socket.id,
    socketId: socket.id,
    name: "",
    avatarColor: DEFAULT_AVATAR_COLOR,
    status: "",
    room: DEFAULT_ROOM,
    ...spawnPosition,
  };

  players.set(socket.id, player);
  socket.join(roomChannel(player.room));

  // Save the player's initial position.
  markPlayerConnected(db.collection("players"), player)
    .then(() => syncProximity(socket.id, player))
    .catch((error) => {
      console.error("Failed to save player:", error.message);
    });

  socket.emit("world:state", Array.from(players.values()));
  socket.emit("room:state", {
    room: player.room,
    players: getPlayersInRoom(players, player.room).map(publicPlayer),
  });
  socket.broadcast.emit("player:joined", player);

  // WebRTC signaling — relayed only between players within proximity.
  socket.on("webrtc:offer", (data) => {
    relaySignal("webrtc:offer", socket.id, data && data.targetId, {
      offer: data && data.offer,
    });
  });

  socket.on("webrtc:answer", (data) => {
    relaySignal("webrtc:answer", socket.id, data && data.targetId, {
      answer: data && data.answer,
    });
  });

  socket.on("webrtc:ice", (data) => {
    relaySignal("webrtc:ice", socket.id, data && data.targetId, {
      candidate: data && data.candidate,
    });
  });

  // Handshake + teardown signals, relayed the same way.
  socket.on("webrtc:ready", (data) => {
    relaySignal("webrtc:ready", socket.id, data && data.targetId, {});
  });

  socket.on("webrtc:leave", (data) => {
    relaySignal("webrtc:leave", socket.id, data && data.targetId, {});
  });

  // Save the player's avatar color.
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
      console.error("Failed to save avatar color:", error.message);
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    }
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
      // If this name has a saved (inactive) record, claim it and restore the
      // player's previous position.
      const returningPlayer = await restoreReturningPlayer(
        db.collection("players"),
        currentPlayer.name,
        socket.id,
        (savedPlayer) => ({
          x: Math.max(
            PLAYER_RADIUS,
            Math.min(WORLD_WIDTH - PLAYER_RADIUS, savedPlayer.x)
          ),
          y: Math.max(
            PLAYER_RADIUS,
            Math.min(WORLD_HEIGHT - PLAYER_RADIUS, savedPlayer.y)
          ),
        })
      );

      if (returningPlayer) {
        currentPlayer.x = returningPlayer.x;
        currentPlayer.y = returningPlayer.y;
      }

      const result = await db.collection("players").updateOne(
        { socketId: socket.id },
        {
          $set: {
            name: currentPlayer.name,
            x: currentPlayer.x,
            y: currentPlayer.y,
            location: [currentPlayer.x, currentPlayer.y],
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
      // upsert: if the connect-time insert hasn't landed yet (or the record was
      // removed), still persist the move — otherwise the player vanishes from
      // $near and nobody can detect them.
      await db.collection("players").updateOne(
        { socketId: socket.id },
        {
          $set: {
            name: updatedPlayer.name,
            status: updatedPlayer.status || "",
            room: updatedPlayer.room,
            x: updatedPlayer.x,
            y: updatedPlayer.y,
            location: [updatedPlayer.x, updatedPlayer.y],
            connected: true,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );

      io.emit("player:moved", updatedPlayer);

      // Group users by proximity and report to both sides.
      const nearbyCount = await syncProximity(socket.id, updatedPlayer);

      console.log(
        "Nearby players for",
        updatedPlayer.name || updatedPlayer.id,
        ":",
        nearbyCount
      );
    } catch (error) {
      console.error(
        "Failed to update position/find nearby players:",
        error.message
      );
    }
  });

  // World chat — broadcast a message to everyone in the world.
  socket.on("chat:send", (text, callback) => {
    const sender = players.get(socket.id);
    const base = createChatMessage(sender, text, `${socket.id}-${Date.now()}`);

    if (!base) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Message must be 1 to 500 characters",
        });
      }
      return;
    }

    const message = {
      ...base,
      senderId: socket.id,
      avatarColor: sender.avatarColor || DEFAULT_AVATAR_COLOR,
      room: sender.room,
      sentAt: new Date().toISOString(),
    };

    // Chat is scoped to the sender's space. Guard the channel: roomChannel()
    // returns null for an unknown room, and io.to(null) would silently drop it.
    const channel = roomChannel(sender.room);
    if (!channel) {
      if (typeof callback === "function") {
        callback({ success: false, error: "You are not in a valid space" });
      }
      return;
    }

    io.to(channel).emit("chat:message", message);

    if (typeof callback === "function") {
      callback({ success: true });
    }
  });

  // Move to another space. Only people in the same space hear each other.
  socket.on("player:joinRoom", async (requestedRoom, callback) => {
    const reply = (response) => {
      if (typeof callback === "function") callback(response);
    };

    const currentPlayer = players.get(socket.id);
    const roomName = normalizeRoomName(requestedRoom);

    if (!roomName) {
      reply({ success: false, error: "Unknown space" });
      return;
    }
    if (!currentPlayer) {
      reply({ success: false, error: "Player not found" });
      return;
    }
    if (currentPlayer.room === roomName) {
      reply({ success: true, room: roomName });
      return;
    }

    const previousChannel = roomChannel(currentPlayer.room);
    const nextChannel = roomChannel(roomName);

    await socket.join(nextChannel);
    meetingCallParticipants.delete(socket.id);
    await socket.leave(previousChannel);

    // Drop proximity to everyone in the old space.
    const nearSet = proximityState.get(socket.id);
    if (nearSet) {
      for (const peerId of nearSet) {
        io.to(peerId).emit("proximity:leave", socket.id);
        const peerSet = proximityState.get(peerId);
        if (peerSet) peerSet.delete(socket.id);
      }
      proximityState.delete(socket.id);
    }

    currentPlayer.room = roomName;
    players.set(socket.id, currentPlayer);

    socket.emit("room:state", {
      room: roomName,
      players: getPlayersInRoom(players, roomName).map(publicPlayer),
    });
    reply({ success: true, room: roomName });

    try {
      await syncProximity(socket.id, currentPlayer);
    } catch (error) {
      console.error(
        "Failed to update proximity after room switch:",
        error.message
      );
    }
  });

  // Join the Meeting Room call — talk to room-mates regardless of distance.
  socket.on("meeting:join", (callback) => {
    const reply = (response) => {
      if (typeof callback === "function") callback(response);
    };

    const currentPlayer = players.get(socket.id);
    if (!canJoinMeetingCall(currentPlayer)) {
      reply({ success: false, error: "Join the Meeting Room first" });
      return;
    }

    meetingCallParticipants.add(socket.id);
    const participants = getMeetingCallParticipants(
      meetingCallParticipants,
      players
    );

    const channel = roomChannel(currentPlayer.room);
    if (channel) {
      socket.to(channel).emit("meeting:participant-joined", {
        id: currentPlayer.id,
        name: currentPlayer.name || `Player ${currentPlayer.id.slice(0, 4)}`,
      });
    }

    reply({ success: true, participants });
  });

  socket.on("meeting:leave", (callback) => {
    const currentPlayer = players.get(socket.id);
    meetingCallParticipants.delete(socket.id);

    if (currentPlayer) {
      const channel = roomChannel(currentPlayer.room);
      if (channel) {
        socket.to(channel).emit("meeting:participant-left", socket.id);
      }
    }

    if (typeof callback === "function") callback({ success: true });
  });

  // A short status line shown on the profile and in the people list.
  socket.on("player:setStatus", (status, callback) => {
    const reply = (response) => {
      if (typeof callback === "function") callback(response);
    };

    const currentPlayer = players.get(socket.id);
    if (!currentPlayer) {
      reply({ success: false, error: "Player not found" });
      return;
    }

    const nextStatus =
      typeof status === "string" ? status.trim().slice(0, 80) : "";

    currentPlayer.status = nextStatus;
    players.set(socket.id, currentPlayer);

    io.emit("player:status", { id: socket.id, status: nextStatus });
    reply({ success: true, status: nextStatus });
  });

  // Mark the player disconnected.
  socket.on("disconnect", () => {
    meetingCallParticipants.delete(socket.id);
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

    markPlayerDisconnected(db.collection("players"), socket.id).catch(
      (error) => {
        console.error("Failed to update player status:", error.message);
      }
    );

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

    // Ensure the location field has a 2d geospatial index whose bounds cover
    // the whole world. A 2d index defaults to [-180, 180] (longitude/latitude),
    // which rejects our 1000x600 pixel coordinates, so set min/max explicitly.
    // Drop any stale index (wrong type or wrong bounds) before recreating it.
    const existingIndexes = await collection.listIndexes().toArray();
    const locationIndex = existingIndexes.find(
      (index) => index.key && index.key.location
    );

    if (locationIndex) {
      await collection.dropIndex(locationIndex.name);
    }

    await collection.createIndex(
      { location: "2d" },
      { min: 0, max: Math.max(WORLD_WIDTH, WORLD_HEIGHT) }
    );

    console.log("MongoDB 2d geospatial index ready!");

    availableRooms = await initializeRoomCatalog(db);
    console.log("Room catalog loaded:", availableRooms.length);

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