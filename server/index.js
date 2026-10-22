


const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

const { getNearbyPlayers } = require("./proximity");

const app = express();
const httpServer = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174"],
    methods: ["GET", "POST"],
  },
});

// Store connected players in memory.
const players = new Map();

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const PLAYER_RADIUS = 20;
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
            Math.hypot(
              position.x - occupied.x,
              position.y - occupied.y
            ) >= minimumSpacing
        );

        if (isAvailable) {
          return position;
        }
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

// Backend health check.
app.get("/", (req, res) => {
  res.json({
    message: "ProxiSpeak backend is running",
    connectedPlayers: players.size,
  });
});

function emitNearbyPlayers() {
  for (const [playerId, player] of players) {
    io.to(playerId).emit(
      "player:nearby",
      getNearbyPlayers(player, players)
    );
  }
}

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const spawnPosition = allocateSpawnPosition();
  spawnSlots.set(socket.id, spawnPosition);

  const player = {
    id: socket.id,
    ...spawnPosition,
  };

  players.set(socket.id, player);

  // Send the complete player list to the new client.
  socket.emit("world:state", Array.from(players.values()));

  // Tell existing clients that a new player joined.
  socket.broadcast.emit("player:joined", player);

  emitNearbyPlayers();
  
  // WebRTC voice signaling — relay only to connected players



  // Notify a nearby player that voice chat is ready.
  socket.on("voice:ready", ({ targetId } = {}) => {
    if (
      typeof targetId !== "string" ||
      !players.has(targetId) ||
      !players.has(socket.id)
    ) {
      return;
    }

    const nearby = getNearbyPlayers(players.get(socket.id), players);

    if (nearby.some((player) => player.id === targetId)) {
      io.to(targetId).emit("voice:ready", {
        fromId: socket.id,
      });
    }
  });


  socket.on("voice:offer", ({ targetId, offer } = {}) => {
    if (
      typeof targetId !== "string" ||
      !offer ||
      !players.has(targetId) ||
      !players.has(socket.id)
    ) {
      return;
    }

    const nearby = getNearbyPlayers(players.get(socket.id), players);
    if (!nearby.some((player) => player.id === targetId)) {
      return;
    }

    io.to(targetId).emit("voice:offer", {
      fromId: socket.id,
      offer,
    });
  });

  socket.on("voice:answer", ({ targetId, answer } = {}) => {
    if (
      typeof targetId !== "string" ||
      !answer ||
      !players.has(targetId) ||
      !players.has(socket.id)
    ) {
      return;
    }

    const nearby = getNearbyPlayers(players.get(socket.id), players);
    if (!nearby.some((player) => player.id === targetId)) {
      return;
    }

    io.to(targetId).emit("voice:answer", {
      fromId: socket.id,
      answer,
    });
  });

  socket.on("voice:ice-candidate", ({ targetId, candidate } = {}) => {
    if (
      typeof targetId !== "string" ||
      !candidate ||
      !players.has(targetId) ||
      !players.has(socket.id)
    ) {
      return;
    }

    const nearby = getNearbyPlayers(players.get(socket.id), players);
    if (!nearby.some((player) => player.id === targetId)) {
      return;
    }

    io.to(targetId).emit("voice:ice-candidate", {
      fromId: socket.id,
      candidate,
    });
  });

  socket.on("voice:leave", ({ targetId } = {}) => {
    if (typeof targetId !== "string" || !players.has(targetId)) {
      return;
    }

    io.to(targetId).emit("voice:leave", {
      fromId: socket.id,
    });
  });


  // Receive and broadcast movement.
  socket.on("player:move", (position) => {
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return;
    }

    const updatedPlayer = {
      id: socket.id,
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

    // Broadcast the updated position to all connected clients.
    io.emit("player:moved", updatedPlayer);

    emitNearbyPlayers();
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    spawnSlots.delete(socket.id);

    io.emit("player:left", socket.id);
    emitNearbyPlayers();

    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`ProxiSpeak server running at http://localhost:${PORT}`);
});
