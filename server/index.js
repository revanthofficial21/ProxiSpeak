

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();
const { MongoClient } = require("mongodb");
const { createActivityNotification, getNewProximityEntries } = require("./activity");
const { normalizeAvatarPrefs, saveAvatarPrefs } = require("./player-persistence");
const { createChatMessage, deliverChatMessage } = require("./lib/chat");
const {
  buildDefaultLayout,
  getLayout,
  initializeLayouts,
} = require("./lib/layouts");
const {
  canJoinMeetingCall,
  getMeetingCallParticipants,
  MEETING_ROOM,
  relayWebRtcSignal,
} = require("./lib/meeting-call");
const { registerMeetingEvents } = require("./lib/meeting-events");
const { attachMesh } = require("./lib/mesh");
const { initializeRoomCatalog } = require("./lib/roomCatalog");
const { createRateLimiter } = require("./lib/rate-limit");
const { registerScreenShareHandlers } = require("./lib/screen-share");
const {
  changePlayerRoom,
  createPlayerPersistenceQueue,
  markPlayerConnected,
  markPlayerDisconnected,
  restoreReturningPlayer,
  savePlayerPosition,
} = require("./lib/player-persistence");
const {
  allocateSpawnPosition: pickSpawnPosition,
  clampPosition,
} = require("./lib/session");
const {
  DEFAULT_ROOM,
  getNearbyPlayersInRoom,
  getPlayersInRoom,
  normalizeRoomName,
  roomChannel,
} = require("./lib/rooms");

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

// The room catalog. This is a list only — players are not yet scoped to a
// room, so everyone still shares one world.
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
const nearbyPayloadState = new Map();
const meetingCallParticipants = new Set();
const meetingCallRaisedHands = new Set();
const activeShares = new Map();
const enqueuePlayerPersistence = createPlayerPersistenceQueue();

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
  return { id: player.id, name: player.name, x: player.x, y: player.y };
}

function hasSameNearbyPlayers(previous, next) {
  return (
    Array.isArray(previous) &&
    previous.length === next.length &&
    previous.every((player, index) => {
      const nextPlayer = next[index];
      return (
        player.id === nextPlayer.id &&
        player.name === nextPlayer.name &&
        player.distance === nextPlayer.distance &&
        player.x === nextPlayer.x &&
        player.y === nextPlayer.y
      );
    })
  );
}

function emitPresenceState() {
  io.emit(
    "presence:state",
    Array.from(players.values())
      .filter((player) => normalizeRoomName(player.room))
      .map(({ id, name, room }) => ({ id, name, room }))
  );
}

// Relay a WebRTC signal to a peer, but only when the two are in the same space
// and within proximity (or are members of the meeting call).
function relaySignal(event, fromId, toId, payload) {
  return relayWebRtcSignal({
    io,
    event,
    fromId,
    toId,
    payload,
    players,
    proximityState,
    meetingCallParticipants,
  });
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

// Emit to everyone in a room, guarding the channel: roomChannel() returns null
// for an unknown space, and io.to(null) silently drops the message.
function emitToRoom(roomName, event, payload) {
  const channel = roomChannel(roomName);
  if (!channel) return false;
  io.to(channel).emit(event, payload);
  return true;
}

io.on("connection", async (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const spawnPosition = allocateSpawnPosition();
  spawnSlots.set(socket.id, spawnPosition);

  const player = {
    id: socket.id,
    socketId: socket.id,
    name: "",
    room: DEFAULT_ROOM,
    ...spawnPosition,
  };

  players.set(socket.id, player);
  registerMeetingEvents(socket, {
    io,
    players,
    participantIds: meetingCallParticipants,
    raisedHands: meetingCallRaisedHands,
  });

  const playerChannel = roomChannel(player.room);
  if (playerChannel) {
    const joinResult = socket.join(playerChannel);
    if (joinResult && typeof joinResult.catch === "function") {
      joinResult.catch((error) => {
        console.error("Failed to join player room:", error.message);
      });
    }
  }

  const playerPersistenceReady = markPlayerConnected(
    db.collection("players"),
    player
  );
  playerPersistenceReady.catch((error) => {
    console.error(
      "Failed to save player or initialize proximity:",
      error.message
    );
  });

  socket.emit("world:state", Array.from(players.values()));
  socket.emit("room:state", {
    room: player.room,
    players: getPlayersInRoom(players, player.room).map(publicPlayer),
  });
  socket.broadcast.emit("player:joined", player);

  // WebRTC signaling is limited to same-room proximity peers or call members.
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
  socket.on("player:setName", (name, callback) => {
    enqueuePlayerPersistence(socket.id, async () => {
      const normalizedName =
        typeof name === "string" ? name.trim().slice(0, 30) : "";
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

      await playerPersistenceReady;
      const collection = db.collection("players");
      const returningPlayer = await restoreReturningPlayer(
        collection,
        normalizedName,
        socket.id,
        ({ x, y }) =>
          clampPosition(x, y, {
            width: WORLD_WIDTH,
            height: WORLD_HEIGHT,
            radius: PLAYER_RADIUS,
          })
      );

      const updatedPlayer = { ...currentPlayer, name: normalizedName };
      if (returningPlayer) {
        updatedPlayer.room =
          normalizeRoomName(returningPlayer.room) || updatedPlayer.room;
        updatedPlayer.x = returningPlayer.x;
        updatedPlayer.y = returningPlayer.y;
        updatedPlayer.avatarPrefs = returningPlayer.avatarPrefs;
      } else {
        await markPlayerConnected(collection, updatedPlayer);
      }

      if (!socket.connected || players.get(socket.id) !== currentPlayer) {
        if (typeof callback === "function") {
          callback({
            success: false,
            error: "Player session is no longer active",
          });
        }
        return;
      }

      const previousChannel = roomChannel(currentPlayer.room);
      const nextChannel = roomChannel(updatedPlayer.room);
      if (nextChannel && nextChannel !== previousChannel) {
        if (returningPlayer) {
          try {
            await changePlayerRoom({
              socket,
              previousRoom: currentPlayer.room,
              previousChannel,
              nextRoom: updatedPlayer.room,
              nextChannel,
              persistRoom: async () => {},
            });
          } catch (error) {
            await markPlayerDisconnected(collection, socket.id).catch(
              (disconnectError) => {
                console.error(
                  "Failed to release returning player after room restore failure:",
                  disconnectError.message
                );
              }
            );
            throw error;
          }
        } else {
          await socket.join(nextChannel);
          if (previousChannel) await socket.leave(previousChannel);
        }
      }

      if (!socket.connected || players.get(socket.id) !== currentPlayer) {
        if (returningPlayer) {
          await markPlayerDisconnected(collection, socket.id);
        }
        if (typeof callback === "function") {
          callback({
            success: false,
            error: "Player session is no longer active",
          });
        }
        return;
      }

      players.set(socket.id, updatedPlayer);
      emitToRoom(
        updatedPlayer.room,
        "player:renamed",
        publicPlayer(updatedPlayer)
      );
      emitPresenceState();
      if (returningPlayer) {
        socket.emit("room:state", {
          room: updatedPlayer.room,
          players: getPlayersInRoom(players, updatedPlayer.room).map(
            publicPlayer
          ),
        });
        emitToRoom(
          updatedPlayer.room,
          "player:moved",
          publicPlayer(updatedPlayer)
        );
        updatePlayerProximity(socket, updatedPlayer).catch((error) => {
          console.error(
            "Failed to update proximity after player restore:",
            error.message
          );
        });
      }

      if (typeof callback === "function") {
        callback({
          success: true,
          name: updatedPlayer.name,
          restored: Boolean(returningPlayer),
          avatarPrefs: updatedPlayer.avatarPrefs,
          position: returningPlayer
            ? { x: updatedPlayer.x, y: updatedPlayer.y }
            : undefined,
        });
      }
    }).catch((error) => {
      console.error("Failed to save player name:", error.message);
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    });
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
        db.collection("players"),
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
      emitToRoom(
        currentPlayer.room,
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
  socket.on("player:move", (position) => {
    enqueuePlayerPersistence(socket.id, async () => {
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
      if (socket.data.roomSwitching) return;

      const updatedPlayer = {
        ...currentPlayer,
        ...clampPosition(position.x, position.y, {
          width: WORLD_WIDTH,
          height: WORLD_HEIGHT,
          radius: PLAYER_RADIUS,
        }),
      };

      if (
        updatedPlayer.x === currentPlayer.x &&
        updatedPlayer.y === currentPlayer.y
      ) {
        return;
      }

      try {
        await playerPersistenceReady;
        await savePlayerPosition(
          db.collection("players"),
          socket.id,
          updatedPlayer
        );

        if (players.get(socket.id) !== currentPlayer) return;
        players.set(socket.id, updatedPlayer);

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
    }).catch((error) => {
      console.error(
        "Player persistence queue failed during movement:",
        error.message
      );
    });
  });

  const sendChatMessage = (scope, text, callback) => {
    if (!chatLimiter.take(socket.id)) {
      if (typeof callback === "function") {
        callback({ success: false, error: "Slow down — too many messages" });
      }
      return;
    }

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
      scope,
      sentAt: new Date().toISOString(),
    };

    const channel = scope === "room" ? roomChannel(sender.room) : null;
    const delivered = deliverChatMessage({
      scope,
      message,
      room: channel,
      emitWorld: (payload) => io.emit("chat:message", payload),
      emitRoom: (room, payload) => {
        io.to(room).emit("chat:message", payload);
        return true;
      },
    });

    if (!delivered) {
      if (typeof callback === "function") {
        callback({ success: false, error: "You are not in a valid space" });
      }
      return;
    }

    if (typeof callback === "function") {
      callback({ success: true });
    }
  };

  socket.on("chat:send", (text, callback) => {
    sendChatMessage("room", text, callback);
  });

  socket.on("world-chat:send", (text, callback) => {
    sendChatMessage("world", text, callback);
  });

  // Move to another space. Only people in the same space hear each other.
  socket.on("player:joinRoom", (requestedRoom, callback) => {
    enqueuePlayerPersistence(socket.id, async () => {
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

      try {
        await changePlayerRoom({
          socket,
          previousRoom: currentPlayer.room,
          previousChannel,
          nextRoom: roomName,
          nextChannel,
          persistRoom: async (room) => {
            await playerPersistenceReady;
            await savePlayerPosition(db.collection("players"), socket.id, {
              ...currentPlayer,
              room,
            });
          },
        });
      } catch (error) {
        console.error("Failed to save player room:", error.message);
        reply({ success: false, error: error.message });
        return;
      }

      if (!socket.connected || players.get(socket.id) !== currentPlayer) {
        reply({
          success: false,
          error: "Player session is no longer active",
        });
        return;
      }

      const wasMeetingParticipant = meetingCallParticipants.delete(socket.id);
      const wasHandRaised = meetingCallRaisedHands.delete(socket.id);
      if (wasMeetingParticipant && previousChannel) {
        if (wasHandRaised) {
          socket.to(previousChannel).emit("meeting:hand", {
            id: socket.id,
            name: currentPlayer.name || `Player ${socket.id.slice(0, 4)}`,
            raised: false,
          });
        }
        socket
          .to(previousChannel)
          .emit("meeting:participant-left", socket.id);
      }

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
        await updatePlayerProximity(socket, currentPlayer);
      } catch (error) {
        console.error(
          "Failed to update proximity after room switch:",
          error.message
        );
      }
    }).catch((error) => {
      console.error(
        "Player persistence queue failed during room change:",
        error.message
      );
      if (typeof callback === "function") {
        callback({ success: false, error: error.message });
      }
    });
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
      players,
      meetingCallRaisedHands
    );

    const channel = roomChannel(currentPlayer.room);
    if (channel) {
      socket.to(channel).emit("meeting:participant-joined", {
        id: currentPlayer.id,
        name: currentPlayer.name || `Player ${currentPlayer.id.slice(0, 4)}`,
        handRaised: meetingCallRaisedHands.has(currentPlayer.id),
      });
    }

    reply({ success: true, participants });
  });

  socket.on("meeting:leave", (callback) => {
    const currentPlayer = players.get(socket.id);
    const wasMeetingParticipant = meetingCallParticipants.delete(socket.id);
    const wasHandRaised = meetingCallRaisedHands.delete(socket.id);

    if (currentPlayer && wasMeetingParticipant) {
      const channel = roomChannel(currentPlayer.room);
      if (channel) {
        if (wasHandRaised) {
          socket.to(channel).emit("meeting:hand", {
            id: socket.id,
            name: currentPlayer.name || `Player ${socket.id.slice(0, 4)}`,
            raised: false,
          });
        }
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

  // Screen sharing — Meeting Room only, with its own signaling handlers.
  registerScreenShareHandlers(socket, { players, io, activeShares });

  // Handle player disconnection.
  socket.on("disconnect", () => {
    const disconnectedPlayer = players.get(socket.id);
    meetingCallParticipants.delete(socket.id);
    meetingCallRaisedHands.delete(socket.id);
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

    enqueuePlayerPersistence(socket.id, async () => {
      try {
        await playerPersistenceReady;
      } catch (error) {
        console.error(
          "Initial player persistence failed before disconnect:",
          error.message
        );
      }
      await markPlayerDisconnected(db.collection("players"), socket.id);
    }).catch((error) => {
        console.error("Failed to update player status:", error.message);
      });

    const currentPlayerChannel = roomChannel(disconnectedPlayer?.room);
    if (currentPlayerChannel) {
      socket.to(currentPlayerChannel).emit("player:left", socket.id);
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