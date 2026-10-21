const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const { connectDB, getDB } = require("./db");
require("dotenv").config();

const app = express();
const httpServer = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

// Store currently connected players in memory for fast access.
const players = new Map();

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const PROXIMITY_RADIUS = 100;

app.get("/", (req, res) => {
  res.json({
    message: "ProxiSpeak backend is running",
    connectedPlayers: players.size,
  });
});

// Ensure the geospatial index that $near relies on exists.
async function ensureProximityIndex() {
  const collection = getDB().collection("players");
  const indexes = await collection.listIndexes().toArray();
  const existing = indexes.find((index) => index.key && index.key.location);

  // A 2d index measures planar (pixel) distance — the right fit for our
  // flat 1000x600 world. Drop any non-2d index left over from a previous run.
  if (existing && existing.key.location !== "2d") {
    await collection.dropIndex(existing.name);
  }

  await collection.createIndex({ location: "2d" });
  console.log("Proximity 2d geospatial index ready");
}

// Group users by proximity with a MongoDB $near query.
async function findNearbyPlayers(player) {
  return getDB()
    .collection("players")
    .find({
      id: { $ne: player.id },
      location: {
        $near: [player.x, player.y],
        $maxDistance: PROXIMITY_RADIUS,
      },
    })
    .project({ _id: 0, id: 1, x: 1, y: 1 })
    .toArray();
}

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const player = {
    id: socket.id,
    x: 100,
    y: 100,
  };

  players.set(socket.id, player);

  // Save the newly connected player in MongoDB, with a geospatial location.
  getDB()
    .collection("players")
    .insertOne({
      ...player,
      location: [player.x, player.y],
      joinedAt: new Date(),
      updatedAt: new Date(),
    })
    .catch((error) => {
      console.error("Failed to save new player:", error.message);
    });

  // Send the current player list to the newly connected client.
  socket.emit("world:state", Array.from(players.values()));

  // Notify other connected clients.
  socket.broadcast.emit("player:joined", player);

  // Handle player movement.
  socket.on("player:move", async (position) => {
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y)
    ) {
      return;
    }

    const updatedPlayer = {
      id: socket.id,
      x: Math.max(0, Math.min(WORLD_WIDTH, position.x)),
      y: Math.max(0, Math.min(WORLD_HEIGHT, position.y)),
    };

    players.set(socket.id, updatedPlayer);

    // Broadcast movement immediately to all connected clients.
    io.emit("player:moved", updatedPlayer);

    try {
      // Persist the latest coordinates and geospatial location.
      await getDB()
        .collection("players")
        .updateOne(
          { id: socket.id },
          {
            $set: {
              x: updatedPlayer.x,
              y: updatedPlayer.y,
              location: [updatedPlayer.x, updatedPlayer.y],
              updatedAt: new Date(),
            },
          }
        );

      // Group users by proximity and report back to the mover.
      const nearbyPlayers = await findNearbyPlayers(updatedPlayer);
      socket.emit("player:nearby", nearbyPlayers);
    } catch (error) {
      console.error(
        "Failed to update position / find nearby players:",
        error.message
      );
    }
  });

  // Remove the player when they disconnect.
  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("player:left", socket.id);

    getDB()
      .collection("players")
      .deleteOne({ id: socket.id })
      .catch((error) => {
        console.error(
          "Failed to remove disconnected player:",
          error.message
        );
      });

    console.log(`Player disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await connectDB();
    await ensureProximityIndex();

    httpServer.listen(PORT, () => {
      console.log(
        `ProxiSpeak server running at http://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
