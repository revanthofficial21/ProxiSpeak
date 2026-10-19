
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

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

// Week 1: store connected players in memory.
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
    y: SPAWN_MARGIN +
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
      x: Math.max(PLAYER_RADIUS, Math.min(WORLD_WIDTH - PLAYER_RADIUS, position.x)),
      y: Math.max(PLAYER_RADIUS, Math.min(WORLD_HEIGHT - PLAYER_RADIUS, position.y)),
    };

    players.set(socket.id, updatedPlayer);

    // Broadcast the updated position to all connected clients.
    io.emit("player:moved", updatedPlayer);
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    spawnSlots.delete(socket.id);
    io.emit("player:left", socket.id);
    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`ProxiSpeak server running at http://localhost:${PORT}`);
});
