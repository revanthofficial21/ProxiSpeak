

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();
const { MongoClient } = require("mongodb");
const {
  createActivityNotification,
  createRoomSwitchNotification,
  getNewProximityEntries,
  isCurrentPlayerSession,
} = require("./activity");
const {
  markPlayerConnected,
  markPlayerDisconnected,
  normalizeAvatarPrefs,
  normalizePlayerName,
  positionFields,
  restoreReturningPlayer,
  savePlayerPosition,
  saveAvatarPrefs,
} = require("./player-persistence");
const {
  createChatMessage,
  createChatUnreadNotification,
} = require("./chat");
const {
  DEFAULT_ROOM,
  normalizeRoomName,
  roomChannel,
  getPlayersInRoom,
  getPresenceSnapshot,
  getNearbyPlayersInRoom,
} = require("./rooms");
const {
  MEETING_ROOM,
  canJoinMeetingCall,
  getMeetingCallParticipants,
  canRelayWebRtcSignal,
} = require("./meeting-call");

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
const nearbyPayloadState = new Map();
const meetingCallParticipants = new Set();

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const PROXIMITY_RADIUS = 100;
const PLAYER_RADIUS = 20;
const SPAWN_SPACINGS = [80, 60, 40];
const SPAWN_MARGIN = PLAYER_RADIUS + 20;
const spawnSlots = new Map();
let chatMessageId = 0;
let activityNotificationId = 0;

function nextActivityId() {
  activityNotificationId += 1;
  return `activity-${Date.now()}-${activityNotificationId}`;
}

function publishActivityToRoom(room, notification, excludedSocketId) {
  if (!notification || !normalizeRoomName(room)) return;
  try {
    let audience = io.to(roomChannel(room));
    if (excludedSocketId) audience = audience.except(excludedSocketId);
    audience.emit("activity:notification", notification);
  } catch (error) {
    console.error("Failed to publish activity notification:", error.message);
  }
}

function publishActivityToPlayer(playerId, notification) {
  if (typeof playerId !== "string" || !notification) return;
  try {
    io.to(playerId).emit("activity:notification", notification);
  } catch (error) {
    console.error("Failed to publish proximity notification:", error.message);
  }
}

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
    x: player.x,
    y: player.y,
    avatarPrefs: player.avatarPrefs,
  };
}

function emitPresenceState() {
  io.emit("presence:state", getPresenceSnapshot(players));
}

function hasSameNearbyPlayers(previous, next) {
  return Boolean(
    previous &&
      previous.length === next.length &&
      previous.every((player, index) => {
        const nextPlayer = next[index];
        return (
          player.id === nextPlayer.id &&
          player.name === nextPlayer.name &&
          player.x === nextPlayer.x &&
          player.y === nextPlayer.y &&
          player.distance === nextPlayer.distance &&
          player.avatarPrefs?.color === nextPlayer.avatarPrefs?.color
        );
      })
  );
}

// Relay a WebRTC signal to a peer, but only when the two are within proximity.
function relaySignal(event, fromId, toId, payload) {
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

  io.to(toId).emit(event, { ...payload, from: fromId });
}

// Use MongoDB's spatial index for candidates, then enforce live room membership.
async function updatePlayerProximity(socket, player) {
  if (!player || players.get(socket.id) !== player) return 0;
  const room = player.room;
  const { x, y } = player;

  const nearbyDocuments = await db
    .collection("players")
    .find({
      socketId: { $ne: socket.id },
      connected: true,
      location: {
        $near: [x, y],
        $maxDistance: PROXIMITY_RADIUS,
      },
    })
    .project({ _id: 0, socketId: 1, name: 1, x: 1, y: 1 })
    .toArray();

  if (
    players.get(socket.id) !== player ||
    player.room !== room ||
    player.x !== x ||
    player.y !== y
  ) {
    return 0;
  }

  const persistedPeerIds = new Set(
    nearbyDocuments.map((nearbyPlayer) => nearbyPlayer.socketId)
  );
  const nearbyList = getNearbyPlayersInRoom(
    players,
    player,
    PROXIMITY_RADIUS
  )
    .filter((nearbyPlayer) => persistedPeerIds.has(nearbyPlayer.id))
    .map((nearbyPlayer) => ({
      ...publicPlayer(nearbyPlayer),
      socketId: nearbyPlayer.id,
      distance: nearbyPlayer.distance,
    }));

  if (!hasSameNearbyPlayers(nearbyPayloadState.get(socket.id), nearbyList)) {
    socket.emit("player:nearby", nearbyList);
    nearbyPayloadState.set(socket.id, nearbyList);
  }

  const newNearby = new Set(nearbyList.map((nearbyPlayer) => nearbyPlayer.id));
  const oldNearby = proximityState.get(socket.id) || new Set();

  for (const peerId of getNewProximityEntries(oldNearby, newNearby)) {
    const nearbyPlayer = nearbyList.find((candidate) => candidate.id === peerId);
    socket.emit("proximity:enter", nearbyPlayer);
    io.to(peerId).emit("proximity:enter", publicPlayer(player));
    publishActivityToPlayer(
      peerId,
      createActivityNotification(
        "proximity-enter",
        player,
        room,
        nextActivityId()
      )
    );

    const peerSet = proximityState.get(peerId) || new Set();
    peerSet.add(socket.id);
    proximityState.set(peerId, peerSet);
  }

  for (const peerId of oldNearby) {
    if (newNearby.has(peerId)) continue;

    socket.emit("proximity:leave", peerId);
    io.to(peerId).emit("proximity:leave", socket.id);
    proximityState.get(peerId)?.delete(socket.id);
  }

  proximityState.set(socket.id, newNearby);
  return nearbyList.length;
}

async function leaveMeetingCall(socket) {
  if (!meetingCallParticipants.delete(socket.id)) return;

  socket.to(`meeting-call:${MEETING_ROOM}`).emit(
    "meeting:participant-left",
    socket.id
  );
  await socket.leave(`meeting-call:${MEETING_ROOM}`);
}

io.on("connection", async (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const spawnPosition = allocateSpawnPosition();
  spawnSlots.set(socket.id, spawnPosition);

  const player = {
    id: socket.id,
    socketId: socket.id,
    name: "",
    avatarPrefs: { color: "mint" },
    room: DEFAULT_ROOM,
    ...spawnPosition,
  };

  players.set(socket.id, player);
  await socket.join(roomChannel(player.room));
  emitPresenceState();

  // Save the player's initial position.
  const playerCollection = db.collection("players");
  const initialPlayerSave = markPlayerConnected(playerCollection, player);
  initialPlayerSave
    .then(() => {
      const connectedPlayer = players.get(socket.id);
      if (connectedPlayer) {
        return updatePlayerProximity(socket, connectedPlayer);
      }
      return undefined;
    })
    .catch((error) => {
      console.error(
        "Failed to save player or initialize proximity:",
        error.message
      );
    });

  socket.emit("room:state", {
    room: player.room,
    players: getPlayersInRoom(players, player.room).map(publicPlayer),
  });
  socket.to(roomChannel(player.room)).emit("player:joined", publicPlayer(player));
  publishActivityToRoom(
    player.room,
    createActivityNotification(
      "player-joined",
      player,
      player.room,
      nextActivityId()
    ),
    socket.id
  );

  // WebRTC signaling is limited to same-room proximity peers or call members.
  socket.on("webrtc:offer", (data) => {
    if (
      !data ||
      !data.sdp ||
      typeof data.sdp.type !== "string" ||
      typeof data.sdp.sdp !== "string"
    ) {
      return;
    }
    relaySignal("webrtc:offer", socket.id, data && data.to, {
      sdp: data && data.sdp,
    });
  });

  socket.on("webrtc:answer", (data) => {
    if (
      !data ||
      !data.sdp ||
      typeof data.sdp.type !== "string" ||
      typeof data.sdp.sdp !== "string"
    ) {
      return;
    }
    relaySignal("webrtc:answer", socket.id, data && data.to, {
      sdp: data && data.sdp,
    });
  });

  socket.on("webrtc:ice", (data) => {
    if (!data || typeof data.candidate?.candidate !== "string") return;
    relaySignal("webrtc:ice", socket.id, data && data.to, {
      candidate: data && data.candidate,
    });
  });

  socket.on("webrtc:leave", () => {
    const nearSet = proximityState.get(socket.id);
    if (!nearSet) return;

    for (const peerId of nearSet) {
      if (
        meetingCallParticipants.has(socket.id) &&
        meetingCallParticipants.has(peerId)
      ) {
        continue;
      }
      io.to(peerId).emit("webrtc:leave", { from: socket.id });
    }
  });

  socket.on("meeting:join", async (callback) => {
    const currentPlayer = players.get(socket.id);
    if (
      !canJoinMeetingCall(currentPlayer) ||
      socket.data.roomSwitching ||
      socket.data.meetingJoinPending
    ) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: socket.data.meetingJoinPending
            ? "Meeting call request already in progress"
            : "Join the Meeting Room before starting a call",
        });
      }
      return;
    }

    const alreadyJoined = meetingCallParticipants.has(socket.id);
    socket.data.meetingJoinPending = true;
    try {
      await socket.join(`meeting-call:${MEETING_ROOM}`);
      if (
        players.get(socket.id) !== currentPlayer ||
        !canJoinMeetingCall(currentPlayer) ||
        socket.data.roomSwitching
      ) {
        await socket.leave(`meeting-call:${MEETING_ROOM}`);
        if (typeof callback === "function") {
          callback({
            success: false,
            error: "Join the Meeting Room before starting a call",
          });
        }
        return;
      }

      meetingCallParticipants.add(socket.id);
      const participants = getMeetingCallParticipants(
        meetingCallParticipants,
        players
      );
      if (typeof callback === "function") {
        callback({ success: true, participants });
      }
      if (!alreadyJoined) {
        socket.to(`meeting-call:${MEETING_ROOM}`).emit(
          "meeting:participant-joined",
          {
            id: currentPlayer.id,
            name: currentPlayer.name || `Player ${currentPlayer.id.slice(0, 4)}`,
          }
        );
      }
    } catch (error) {
      meetingCallParticipants.delete(socket.id);
      await socket.leave(`meeting-call:${MEETING_ROOM}`);
      console.error("Failed to join meeting call:", error.message);
      if (typeof callback === "function") {
        callback({ success: false, error: "Could not join meeting call" });
      }
    } finally {
      socket.data.meetingJoinPending = false;
    }
  });

  socket.on("meeting:leave", async () => {
    try {
      await leaveMeetingCall(socket);
    } catch (error) {
      console.error("Failed to leave meeting call:", error.message);
    }
  });

  socket.on("chat:send", (text, callback) => {
    if (socket.data.roomSwitching) {
      if (typeof callback === "function") {
        callback({ success: false, error: "Room switch in progress" });
      }
      return;
    }
    const message = createChatMessage(
      players.get(socket.id),
      text,
      chatMessageId + 1
    );
    if (!message) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Message must contain 1 to 500 characters",
        });
      }
      return;
    }

    chatMessageId = message.id;
    io.to(roomChannel(players.get(socket.id).room)).emit("chat:message", {
      ...message,
      room: players.get(socket.id).room,
    });
    const unreadNotification = createChatUnreadNotification(
      players.get(socket.id).room
    );
    if (unreadNotification) {
      io.except(roomChannel(unreadNotification.room)).emit(
        "chat:unread",
        unreadNotification
      );
    }
    if (typeof callback === "function") {
      callback({ success: true });
    }
  });

  socket.on("player:joinRoom", async (requestedRoom, callback) => {
    const roomName = normalizeRoomName(requestedRoom);
    const currentPlayer = players.get(socket.id);
    const reply = (response) => {
      if (typeof callback === "function") callback(response);
    };

    if (!roomName) {
      reply({ success: false, error: "Invalid room" });
      return;
    }
    if (!currentPlayer) {
      reply({ success: false, error: "Player not found" });
      return;
    }
    if (socket.data.roomSwitching) {
      reply({ success: false, error: "Room switch already in progress" });
      return;
    }
    if (currentPlayer.room === roomName) {
      reply({ success: true, room: roomName });
      return;
    }

    socket.data.roomSwitching = true;
    const previousRoom = currentPlayer.room;
    const previousChannel = roomChannel(previousRoom);
    const nextChannel = roomChannel(roomName);

    try {
      await socket.join(nextChannel);
      if (players.get(socket.id) !== currentPlayer) {
        await socket.leave(nextChannel);
        reply({ success: false, error: "Player session is no longer active" });
        return;
      }
      await leaveMeetingCall(socket);
      if (players.get(socket.id) !== currentPlayer) {
        await socket.leave(nextChannel);
        reply({ success: false, error: "Player session is no longer active" });
        return;
      }
      await socket.leave(previousChannel);
      if (players.get(socket.id) !== currentPlayer) {
        await socket.leave(nextChannel);
        reply({ success: false, error: "Player session is no longer active" });
        return;
      }

      const nearSet = proximityState.get(socket.id);
      if (nearSet) {
        for (const peerId of nearSet) {
          io.to(peerId).emit("proximity:leave", socket.id);
          const peerSet = proximityState.get(peerId);
          if (peerSet) peerSet.delete(socket.id);
        }
        proximityState.delete(socket.id);
      }
      nearbyPayloadState.delete(socket.id);

      socket.to(previousChannel).emit("player:left", socket.id);
      currentPlayer.room = roomName;
      players.set(socket.id, currentPlayer);
      emitPresenceState();
      socket.emit("room:state", {
        room: roomName,
        players: getPlayersInRoom(players, roomName).map(publicPlayer),
      });
      socket.to(nextChannel).emit("player:joined", publicPlayer(currentPlayer));
      const roomSwitchNotification = createRoomSwitchNotification(
        currentPlayer,
        previousRoom,
        roomName,
        nextActivityId()
      );
      publishActivityToRoom(previousRoom, roomSwitchNotification, socket.id);
      if (roomName !== previousRoom) {
        publishActivityToRoom(roomName, roomSwitchNotification, socket.id);
      }
      updatePlayerProximity(socket, currentPlayer).catch((error) => {
        console.error(
          "Failed to update proximity after room switch:",
          error.message
        );
      });
      reply({ success: true, room: roomName });
    } catch (error) {
      await socket.leave(nextChannel);
      console.error("Failed to switch player room:", error.message);
      reply({ success: false, error: "Could not switch rooms" });
    } finally {
      socket.data.roomSwitching = false;
    }
  });

  // Save the player's name.
  socket.on("player:setName", async (name, callback) => {
    const normalizedName = normalizePlayerName(name);
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

    try {
      await initialPlayerSave;
      if (!socket.connected || players.get(socket.id) !== currentPlayer) {
        if (typeof callback === "function") {
          callback({ success: false, error: "Player session is no longer active" });
        }
        return;
      }
      // No session/transaction: a single-document claim is atomic on its own,
      // so this works on a standalone MongoDB too (transactions need a replica
      // set).
      const returningPlayer = await restoreReturningPlayer(
        playerCollection,
        normalizedName,
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

      if (!socket.connected || players.get(socket.id) !== currentPlayer) {
        if (returningPlayer) {
          await markPlayerDisconnected(playerCollection, socket.id);
        }
        if (typeof callback === "function") {
          callback({ success: false, error: "Player session is no longer active" });
        }
        return;
      }

      let result;
      if (returningPlayer) {
        currentPlayer.x = returningPlayer.x;
        currentPlayer.y = returningPlayer.y;
        currentPlayer.avatarPrefs =
          normalizeAvatarPrefs(returningPlayer.avatarPrefs) || {
            color: "mint",
          };
        spawnSlots.set(socket.id, { x: currentPlayer.x, y: currentPlayer.y });
        result = { matchedCount: 1 };
      } else {
        result = await playerCollection.updateOne(
          { socketId: socket.id, connected: true },
          {
            $set: {
              name: normalizedName,
              ...positionFields(currentPlayer.x, currentPlayer.y),
              updatedAt: new Date(),
              connected: true,
            },
          }
        );
      }

      console.log("Player name:", normalizedName);
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

      if (!socket.connected || players.get(socket.id) !== currentPlayer) {
        if (typeof callback === "function") {
          callback({ success: false, error: "Player session is no longer active" });
        }
        return;
      }

      currentPlayer.name = normalizedName;
      players.set(socket.id, currentPlayer);
      io.to(roomChannel(currentPlayer.room)).emit(
        "player:renamed",
        publicPlayer(currentPlayer)
      );
      emitPresenceState();
      if (returningPlayer) {
        io.to(roomChannel(currentPlayer.room)).emit(
          "player:moved",
          publicPlayer(currentPlayer)
        );
        updatePlayerProximity(socket, currentPlayer).catch((error) => {
          console.error(
            "Failed to update proximity after player restore:",
            error.message
          );
        });
      }

      if (typeof callback === "function") {
        callback({
          success: true,
          name: currentPlayer.name,
          restored: Boolean(returningPlayer),
          avatarPrefs: currentPlayer.avatarPrefs,
          position: returningPlayer
            ? { x: currentPlayer.x, y: currentPlayer.y }
            : undefined,
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

  socket.on("player:setAvatarPrefs", async (avatarPrefs, callback) => {
    const normalizedPrefs = normalizeAvatarPrefs(avatarPrefs);
    if (!normalizedPrefs) {
      if (typeof callback === "function") {
        callback({
          success: false,
          error: "Invalid avatar preferences",
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

    try {
      const result = await saveAvatarPrefs(
        playerCollection,
        socket.id,
        normalizedPrefs
      );
      if (result.matchedCount !== 1) {
        if (typeof callback === "function") {
          callback({
            success: false,
            error: "Active player record not found",
          });
        }
        return;
      }

      if (!socket.connected || players.get(socket.id) !== currentPlayer) {
        if (typeof callback === "function") {
          callback({ success: false, error: "Player session is no longer active" });
        }
        return;
      }

      currentPlayer.avatarPrefs = normalizedPrefs;
      players.set(socket.id, currentPlayer);
      io.to(roomChannel(currentPlayer.room)).emit(
        "player:avatarPrefs",
        publicPlayer(currentPlayer)
      );
      emitPresenceState();

      if (typeof callback === "function") {
        callback({
          success: true,
          avatarPrefs: normalizedPrefs,
        });
      }
    } catch (error) {
      console.error("Failed to save avatar preferences:", error.message);

      if (typeof callback === "function") {
        callback({
          success: false,
          error: error.message,
        });
      }
    }
  });

  // Persist position before publishing it or refreshing indexed proximity.
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
    if (socket.data.roomSwitching) return;

    const updatedPlayer = {
      ...currentPlayer,
      x: Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, position.x)),
      y: Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, position.y)),
    };

    if (
      updatedPlayer.x === currentPlayer.x &&
      updatedPlayer.y === currentPlayer.y
    ) {
      return;
    }

    players.set(socket.id, updatedPlayer);

    try {
      const positionSave = await savePlayerPosition(
        db.collection("players"),
        socket.id,
        updatedPlayer
      );
      if (positionSave.matchedCount !== 1) return;

      if (
        players.get(socket.id) !== updatedPlayer ||
        players.get(socket.id)?.room !== updatedPlayer.room
      ) {
        return;
      }

      io.to(roomChannel(updatedPlayer.room)).emit(
        "player:moved",
        publicPlayer(updatedPlayer)
      );

      await updatePlayerProximity(socket, updatedPlayer);
    } catch (error) {
      console.error(
        "Failed to update position/find nearby players:",
        error.message
      );
    }
  });

  // Handle player disconnection.
  socket.on("disconnect", () => {
    const disconnectedPlayer = players.get(socket.id);
    if (
      !isCurrentPlayerSession(players, socket.id, disconnectedPlayer)
    ) {
      return;
    }

    const playerChannel = roomChannel(disconnectedPlayer?.room);
    publishActivityToRoom(
      disconnectedPlayer.room,
      createActivityNotification(
        "player-left",
        disconnectedPlayer,
        disconnectedPlayer.room,
        nextActivityId()
      ),
      socket.id
    );
    players.delete(socket.id);
    spawnSlots.delete(socket.id);
    nearbyPayloadState.delete(socket.id);
    leaveMeetingCall(socket).catch((error) => {
      console.error("Failed to clean up disconnected meeting participant:", error.message);
    });

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

    markPlayerDisconnected(db.collection("players"), socket.id)
      .catch((error) => {
        console.error(
          "Failed to update player status:",
          error.message
        );
      });

    if (playerChannel) {
      socket.to(playerChannel).emit("player:left", socket.id);
    }
    emitPresenceState();
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await mongoClient.connect();
    db = mongoClient.db("proxispeak");

    const collection = db.collection("players");
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
