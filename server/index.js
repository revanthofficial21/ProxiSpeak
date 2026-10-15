
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();
const { MongoClient } = require("mongodb");

const app = express();
const httpServer = http.createServer(app);

const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;


app.use(cors());
app.use(express.json());

const io = new Server(httpServer, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

// Week 1: store connected players in memory.
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
    x: 100,
    y: 100,
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
      x: Math.max(0, Math.min(WORLD_WIDTH, position.x)),
      y: Math.max(0, Math.min(WORLD_HEIGHT, position.y)),
    };

    players.set(socket.id, updatedPlayer);

    // Broadcast the updated position to all connected clients.
    io.emit("player:moved", updatedPlayer);
  });

  socket.on("disconnect", () => {
    players.delete(socket.id)
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
      console.log(
        `ProxiSpeak server running at http://localhost:${PORT}`
      );
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
  }
}

startServer();
