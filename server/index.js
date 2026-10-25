const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
require("dotenv").config();

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 5000;

const players = new Map();

app.get("/", (req, res) => {
  res.json({
    message: "ProxiSpeak server is running",
  });
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  const player = {
    id: socket.id,
    x: 100,
    y: 100,
    name: "Guest",
    avatarColor: "#7C9EFF",
  };

  players.set(socket.id, player);

  socket.emit("world:state", Array.from(players.values()));

  socket.broadcast.emit("player:joined", player);

  socket.on("player:move", (data = {}) => {
    const currentPlayer = players.get(socket.id);
    if (!currentPlayer) return;

    if (typeof data.x === "number") currentPlayer.x = data.x;
    if (typeof data.y === "number") currentPlayer.y = data.y;

    io.emit("player:moved", currentPlayer);
  });

  socket.on("player:setName", (name) => {
    const currentPlayer = players.get(socket.id);
    if (!currentPlayer || typeof name !== "string") return;

    currentPlayer.name = name.trim().slice(0, 30) || "Guest";

    io.emit("player:renamed", currentPlayer);
  });

  socket.on("player:setAvatarColor", (color) => {
    const currentPlayer = players.get(socket.id);
    if (!currentPlayer || typeof color !== "string") return;

    currentPlayer.avatarColor = color;

    io.emit("player:avatarColorUpdated", currentPlayer);
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    players.delete(socket.id);

    io.emit("player:left", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`ProxiSpeak server running on port ${PORT}`);
});
