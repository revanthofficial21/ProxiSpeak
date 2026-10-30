

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
  getPlayersInRoom: getPlayersInNamedRoom,
} = require("./lib/rooms");
const {
  DEFAULT_ROOM_ID,
  getRoomChannel,
  emitConnectedPlayerCount,
  emitToRoom,
  emitRoomPresence,
  emitPlayerLeft,
} = require("./roomUtils");
const { registerRoomHandler } = require("./roomHandler");
const {
  registerChatHandlers,
  sendRoomChatHistory,
} = require("./chat");
const { registerChatTypingHandlers } = require("./chatTyping");
const {
  canJoinMeetingCall,
  getMeetingCallParticipants,
  canRelayWebRtcSignal,
} = require("./lib/meeting-call");
const { createRateLimiter } = require("./lib/rate-limit");
const {
  registerScreenShareHandlers,
  stopActiveScreenShare,
  removeScreenViewer,
} = require("./lib/screen-share");
const {
  initializeLayouts,
  getLayout,
  buildDefaultLayout,
} = require("./lib/layouts");
const { attachMesh, detachMesh } = require("./lib/mesh");
const {
  allocateSpawnPosition: pickSpawnPosition,
  clampPosition,
  normalizeDisplayName,
  diffProximity,
  isWithinProximity,
  nearestPeers,
} = require("./lib/session");

const app = express();
const httpServer = http.createServer(app);

const mongoClient = new MongoClient(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
});

let db;
let mesh = null;
let availableRooms = [];

// Browser origins allowed to connect. Comma-separated; "*" allows any origin,
// which is convenient locally but should be set explicitly in production.
const allowedOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOrigin = allowedOrigins.includes("*") ? true : allowedOrigins;

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

// The room catalog also scopes layouts, presence, proximity, and chat.
app.get("/api/rooms", (req, res) => {
  res.json({ rooms: availableRooms });
});

// The furniture and zones for one room, so the client does not have to hard-code
// them. Falls back to the built-in layout if the document is missing or broken.
app.get("/api/rooms/:id/layout", async (req, res) => {
  try {
    const layout = await getLayout(db, req.params.id);
    res.json({ layout });
  } catch (error) {
    console.error("Could not load the room layout:", error.message);
    res.status(500).json({ error: "Could not load the room layout." });
  }
});

const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
  },
});

const players = new Map();

// Movement arrives ~25 times a second from an honest client; the burst is
// generous but a flood is cut off. Chat is deliberately much stricter.
const moveLimiter = createRateLimiter({ capacity: 80, refillPerSecond: 50 });
const chatLimiter = createRateLimiter({ capacity: 5, refillPerSecond: 1 });

// Tracks which players are currently within proximity of each other.
// Drives the enter/leave events and gates the WebRTC signaling relay.
const proximityState = new Map();

// Last nearby count per socket, so we only log when it changes.
const lastNearbyCount = new Map();

// Players currently in the Meeting Room call (talk regardless of distance).
const meetingCallParticipants = new Set();

// Active screen shares, keyed by the sharer's socket id.
const activeShares = new Map();

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const PROXIMITY_RADIUS = 100;
// Hysteresis: connect at 100px, but only disconnect past 115px.
const PROXIMITY_LEAVE_RADIUS = 115;
// Cap on how many peers one client connects to — the mesh must stay bounded.
const MAX_MESH_PEERS = 8;
const DEFAULT_AVATAR_COLOR = "#6ee7b7";
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const PLAYER_RADIUS = 20;
const SPAWN_SPACINGS = [80, 60, 40];
const SPAWN_MARGIN = PLAYER_RADIUS + 20;
const spawnSlots = new Map();

// The placement rules live in lib/session.js; this only supplies the world.
function allocateSpawnPosition() {
  return pickSpawnPosition({
    occupied: Array.from(spawnSlots.values()),
    usedCount: spawnSlots.size,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    radius: PLAYER_RADIUS,
    spacings: SPAWN_SPACINGS,
    margin: SPAWN_MARGIN,
    obstacles: buildDefaultLayout(DEFAULT_ROOM).furniture,
    // Spread arrivals out — taking the first free slot stacks everyone in the
    // top-left corner, which looks broken once two or three people join.
    pick: (slots) => slots[Math.floor(Math.random() * slots.length)],
  });
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
    roomId: player.roomId || DEFAULT_ROOM_ID,
  };
}

function roomNameForId(roomId) {
  return availableRooms.find((room) => room.id === roomId)?.name || DEFAULT_ROOM;
}

function roomIdForName(roomName) {
  return (
    availableRooms.find((room) => room.name === roomName)?.id ||
    DEFAULT_ROOM_ID
  );
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
  // Peers already in range get the wider leave radius (hysteresis).
  const oldNearby = proximityState.get(socketId) || new Set();

  const nearbyPlayers = await db
    .collection("players")
    .find({
      socketId: { $ne: socketId },
      connected: true,
      roomId: player.roomId,
      location: {
        $near: [player.x, player.y],
        $maxDistance: PROXIMITY_LEAVE_RADIUS,
      },
    })
    .project({ _id: 0, socketId: 1, name: 1, avatarColor: 1, x: 1, y: 1 })
    .toArray();

  // Same space only, then hysteresis, then the nearest peers — a full mesh does
  // not scale, so each client connects only to those closest to them.
  const candidates = nearbyPlayers
    .filter((nearbyPlayer) => {
      const peer = players.get(nearbyPlayer.socketId);
      return peer && peer.roomId === player.roomId;
    })
    .map((nearbyPlayer) => ({
      id: nearbyPlayer.socketId,
      socketId: nearbyPlayer.socketId,
      name: nearbyPlayer.name,
      avatarColor: nearbyPlayer.avatarColor || DEFAULT_AVATAR_COLOR,
      x: nearbyPlayer.x,
      y: nearbyPlayer.y,
      distance: Math.hypot(
        nearbyPlayer.x - player.x,
        nearbyPlayer.y - player.y
      ),
    }))
    .filter((candidate) =>
      isWithinProximity({
        distance: candidate.distance,
        isAlreadyNearby: oldNearby.has(candidate.id),
        enterRadius: PROXIMITY_RADIUS,
        leaveRadius: PROXIMITY_LEAVE_RADIUS,
      })
    );

  const nearbyList = nearestPeers(candidates, MAX_MESH_PEERS);

  io.to(socketId).emit("player:nearby", nearbyList);

  const {
    entered,
    left,
    next: newNearby,
  } = diffProximity(
    oldNearby,
    nearbyList.map((p) => p.id)
  );

  for (const id of entered) {
    io.to(socketId).emit("proximity:enter", nearbyList.find((p) => p.id === id));
    io.to(id).emit("proximity:enter", publicPlayer(player));

    const peerSet = proximityState.get(id) || new Set();
    peerSet.add(socketId);
    proximityState.set(id, peerSet);
  }

  for (const id of left) {
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
    roomId: roomIdForName(DEFAULT_ROOM),
    presenceAnnounced: false,
    ...spawnPosition,
  };

  players.set(socket.id, player);
  socket.join(roomChannel(player.room));
  socket.join(getRoomChannel(player.roomId));
  emitConnectedPlayerCount(io, players);

  // Save the player's initial position.
  markPlayerConnected(db.collection("players"), player)
    .then(() => syncProximity(socket.id, player))
    .catch((error) => {
      console.error("Failed to save player:", error.message);
    });

  socket.emit(
    "world:state",
    getPlayersInNamedRoom(players, player.room).map(publicPlayer)
  );
  socket.emit("room:state", {
    room: player.room,
    players: getPlayersInNamedRoom(players, player.room).map(publicPlayer),
  });
  socket.to(roomChannel(player.room)).emit("player:joined", publicPlayer(player));

  const clearChatTyping = registerChatTypingHandlers(socket, { players, io });
  registerChatHandlers(socket, {
    db,
    players,
    io,
    onMessageSending: clearChatTyping,
    canSendMessage: () => chatLimiter.take(socket.id),
  });
  registerRoomHandler(socket, {
    availableRooms,
    players,
    db,
    io,
    publicPlayer,
    onRoomLeaving: async (socketId, previousRoomId) => {
      clearChatTyping();
      const wasInMeetingCall = meetingCallParticipants.has(socketId);
      meetingCallParticipants.delete(socketId);
      const previousRoomName = roomNameForId(previousRoomId);
      if (previousRoomName === "Meeting Room") {
        stopActiveScreenShare(socketId, activeShares, io, "room-left");
      }
      removeScreenViewer(socketId, activeShares, io);
      const previousChannel = roomChannel(previousRoomName);
      if (wasInMeetingCall && previousChannel) {
        io.to(previousChannel).emit("meeting:participant-left", socketId);
      }

      // Both channel schemes are joined on connect, so both must be left here —
      // otherwise a player keeps hearing the room they walked out of.
      if (previousChannel) socket.leave(previousChannel);
      socket.leave(getRoomChannel(previousRoomId));
    },
    onRoomChanged: async (socketId, previousRoomId, nextRoomId) => {
      const currentPlayer = players.get(socketId);
      if (!currentPlayer) return;
      await socket.join(roomChannel(currentPlayer.room));
      await socket.join(getRoomChannel(currentPlayer.roomId));

      const nearby = proximityState.get(socketId) || new Set();
      for (const peerId of nearby) {
        io.to(socketId).emit("proximity:leave", peerId);
        io.to(peerId).emit("proximity:leave", socketId);
        const peerSet = proximityState.get(peerId);
        if (peerSet) peerSet.delete(socketId);
      }
      proximityState.set(socketId, new Set());
      await syncProximity(socketId, currentPlayer);
      console.log(
        `Player ${socketId} switched from ${previousRoomId} to ${nextRoomId}`
      );
    },
    loadChatHistory: (roomId) =>
      sendRoomChatHistory(socket, db, players, roomId),
  });

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
      emitToRoom(
        io,
        updatedPlayer.roomId,
        "player:avatarColorUpdated",
        publicPlayer(updatedPlayer)
      );

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
    const normalizedName = normalizeDisplayName(name);

    if (!normalizedName) {
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

    currentPlayer.name = normalizedName;

    try {
      // If this name has a saved (inactive) record, claim it and restore the
      // player's previous position.
      const returningPlayer = await restoreReturningPlayer(
        db.collection("players"),
        currentPlayer.name,
        socket.id,
        (savedPlayer) =>
          clampPosition(savedPlayer.x, savedPlayer.y, {
            width: WORLD_WIDTH,
            height: WORLD_HEIGHT,
            radius: PLAYER_RADIUS,
          })
      );

      if (returningPlayer) {
        // Restore everything the saved record holds, not just the position.
        currentPlayer.x = returningPlayer.x;
        currentPlayer.y = returningPlayer.y;
        // Keep the spawn bookkeeping honest, otherwise the next arrival can be
        // placed straight on top of the restored player.
        spawnSlots.set(socket.id, {
          x: returningPlayer.x,
          y: returningPlayer.y,
        });

        if (returningPlayer.avatarColor) {
          currentPlayer.avatarColor = returningPlayer.avatarColor;
        }
        if (typeof returningPlayer.status === "string") {
          currentPlayer.status = returningPlayer.status;
        }

        const restoredRoom =
          normalizeRoomName(returningPlayer.room) ||
          roomNameForId(returningPlayer.roomId);
        const restoredRoomId =
          availableRooms.find((room) => room.name === restoredRoom)?.id ||
          DEFAULT_ROOM_ID;
        if (restoredRoomId !== currentPlayer.roomId) {
          const previousRoomId = currentPlayer.roomId;
          await socket.leave(roomChannel(currentPlayer.room));
          await socket.leave(getRoomChannel(previousRoomId));
          currentPlayer.room = restoredRoom;
          currentPlayer.roomId = restoredRoomId;
          await socket.join(roomChannel(restoredRoom));
          await socket.join(getRoomChannel(restoredRoomId));
        }
      }

      const result = await db.collection("players").updateOne(
        { socketId: socket.id },
        {
          $set: {
            name: currentPlayer.name,
            avatarColor: currentPlayer.avatarColor,
            status: currentPlayer.status || "",
            room: currentPlayer.room,
            roomId: currentPlayer.roomId,
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
      emitToRoom(
        io,
        currentPlayer.roomId,
        "player:renamed",
        publicPlayer(currentPlayer)
      );
      if (!currentPlayer.presenceAnnounced) {
        currentPlayer.presenceAnnounced = true;
        emitRoomPresence(
          io,
          currentPlayer.roomId,
          currentPlayer,
          "joined",
          socket
        );
      }
      socket.emit(
        "world:state",
        getPlayersInNamedRoom(players, currentPlayer.room).map(publicPlayer)
      );
      await syncProximity(socket.id, currentPlayer);

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

    if (!moveLimiter.take(socket.id)) return;

    const currentPlayer = players.get(socket.id);
    if (!currentPlayer) return;

    const updatedPlayer = {
      ...currentPlayer,
      ...clampPosition(position.x, position.y, {
        width: WORLD_WIDTH,
        height: WORLD_HEIGHT,
        radius: PLAYER_RADIUS,
      }),
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
            roomId: updatedPlayer.roomId,
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

      emitToRoom(
        io,
        updatedPlayer.roomId,
        "player:moved",
        publicPlayer(updatedPlayer)
      );

      // Group users by proximity and report to both sides.
      const nearbyCount = await syncProximity(socket.id, updatedPlayer);

      // Only log transitions — one line per move drowns the console.
      if (lastNearbyCount.get(socket.id) !== nearbyCount) {
        lastNearbyCount.set(socket.id, nearbyCount);
        console.log(
          "Nearby players for",
          updatedPlayer.name || updatedPlayer.id,
          ":",
          nearbyCount
        );
      }
    } catch (error) {
      console.error(
        "Failed to update position/find nearby players:",
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
  socket.on("player:setStatus", async (status, callback) => {
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

    try {
      const result = await db.collection("players").updateOne(
        { socketId: socket.id, connected: true },
        { $set: { status: nextStatus, updatedAt: new Date() } }
      );
      if (result.matchedCount === 0) {
        reply({ success: false, error: "Player record not found" });
        return;
      }

      currentPlayer.status = nextStatus;
      players.set(socket.id, currentPlayer);
      io.to(getRoomChannel(currentPlayer.roomId)).emit("player:status", {
        id: socket.id,
        status: nextStatus,
      });
      reply({ success: true, status: nextStatus });
    } catch (error) {
      console.error("Failed to save player status:", error.message);
      reply({ success: false, error: "Could not save your status." });
    }
  });

  // Screen sharing — Meeting Room only, with its own signaling handlers.
  registerScreenShareHandlers(socket, { players, io, activeShares });

  // Mark the player disconnected.
  socket.on("disconnect", () => {
    const disconnectedPlayer = players.get(socket.id);
    const wasInMeetingCall = meetingCallParticipants.has(socket.id);
    meetingCallParticipants.delete(socket.id);
    players.delete(socket.id);
    spawnSlots.delete(socket.id);
    moveLimiter.forget(socket.id);
    chatLimiter.forget(socket.id);
    lastNearbyCount.delete(socket.id);

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

    if (disconnectedPlayer) {
      const leftChannel = roomChannel(disconnectedPlayer.room);
      if (wasInMeetingCall && leftChannel) {
        io.to(leftChannel).emit("meeting:participant-left", socket.id);
      }
      emitPlayerLeft(io, disconnectedPlayer);
    }
    emitConnectedPlayerCount(io, players);
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

    await initializeLayouts(
      db,
      availableRooms.map((room) => room.id)
    );
    console.log("Room layouts seeded.");

    console.log("MongoDB connected successfully!");

    // Scale out: with REDIS_URL set, instances share rooms and events via Redis.
    try {
      mesh = await attachMesh(io, process.env.REDIS_URL);
      console.log(
        mesh
          ? "Redis mesh attached — multi-instance ready."
          : "No REDIS_URL — running as a single instance."
      );
    } catch (error) {
      console.error("Redis mesh failed to attach:", error.message);
    }

    httpServer.listen(PORT, () => {
      console.log(`ProxiSpeak server running at http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exitCode = 1;
  }
}

startServer();

// A single bad event must never take the whole server down.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception — shutting down:", error);
  shutdown("uncaughtException");
});

// Close sockets and the database cleanly so a restart doesn't leave
// half-connected players behind.
async function shutdown(signal) {
  console.log(`${signal} received — shutting down.`);
  try {
    io.close();
    httpServer.close();
    await detachMesh(mesh);
    await mongoClient.close();
  } catch (error) {
    console.error("Error during shutdown:", error.message);
  }
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
