
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

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;

app.get("/", (req, res) => {
  res.json({
    message: "ProxiSpeak backend is running",
    connectedPlayers: players.size,
  });
});

io.on("connection", (socket) => {
  console.log(`Player connected: ${socket.id}`);

  const player = {
    id: socket.id,
    socketId: socket.id,
    name: "",
    x: 100,
    y: 100,
  };

  players.set(socket.id, player);

  // Save initial player data in MongoDB.
  db.collection("players")
    .updateOne(
      { socketId: socket.id },
      {
        $set: {
          socketId: socket.id,
          name: player.name,
          x: player.x,
          y: player.y,
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

  // Save the player's name.
  socket.on("player:setName", async (name, callback) => {
    console.log("Received player name:", name);

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
      console.log("MongoDB modified:", result.modifiedCount);

      if (result.matchedCount === 0) {
        console.error("No MongoDB record matched this socket ID.");

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

  // Update player position.
  socket.on("player:move", (position) => {
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
      x: Math.max(0, Math.min(WORLD_WIDTH, position.x)),
      y: Math.max(0, Math.min(WORLD_HEIGHT, position.y)),
    };

    players.set(socket.id, updatedPlayer);

    db.collection("players")
      .updateOne(
        { socketId: socket.id },
        {
          $set: {
            name: updatedPlayer.name,
            x: updatedPlayer.x,
            y: updatedPlayer.y,
            connected: true,
            updatedAt: new Date(),
          },
        }
      )
      .catch((error) => {
        console.error("Failed to update player position:", error.message);
      });

    io.emit("player:moved", updatedPlayer);
  });

  // Handle player disconnection.
  socket.on("disconnect", () => {
    players.delete(socket.id);

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
        console.error("Failed to update player status:", error.message);
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