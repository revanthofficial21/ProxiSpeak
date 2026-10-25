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
const voiceUsers = new Set();

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

  // Player movement
  socket.on("player:move", (data = {}) => {
    const currentPlayer = players.get(socket.id);
    if (!currentPlayer) return;

    if (typeof data.x === "number") currentPlayer.x = data.x;
    if (typeof data.y === "number") currentPlayer.y = data.y;

    io.emit("player:moved", currentPlayer);
  });

  // Update player name
  socket.on("player:setName", (name) => {
    const currentPlayer = players.get(socket.id);

    if (!currentPlayer || typeof name !== "string") return;

    currentPlayer.name = name.trim().slice(0, 30) || "Guest";

    io.emit("player:renamed", currentPlayer);
  });

  // Update avatar colour
  socket.on("player:setAvatarColor", (color) => {
    const currentPlayer = players.get(socket.id);

    if (!currentPlayer || typeof color !== "string") return;

    currentPlayer.avatarColor = color;

    io.emit("player:avatarColorUpdated", currentPlayer);
  });

  // Join voice chat
  socket.on("voice:join", () => {
    if (voiceUsers.has(socket.id)) return;

    // Notify existing voice participants about the new participant.
    voiceUsers.forEach((peerId) => {
      io.to(peerId).emit("voice:peer", {
        peerId: socket.id,
      });
    });

    voiceUsers.add(socket.id);

    console.log("Voice chat joined:", socket.id);
  });

  // Leave voice chat
  socket.on("voice:leave", () => {
    if (!voiceUsers.has(socket.id)) return;

    voiceUsers.delete(socket.id);

    socket.broadcast.emit("voice:peer-left", {
      peerId: socket.id,
    });

    console.log("Voice chat left:", socket.id);
  });

  // Request a voice connection with another participant.
  socket.on("voice:request-peer", ({ peerId } = {}) => {
    if (
      !voiceUsers.has(socket.id) ||
      !peerId ||
      peerId === socket.id ||
      !voiceUsers.has(peerId)
    ) {
      return;
    }

    io.to(peerId).emit("voice:peer", {
      peerId: socket.id,
    });
  });

  // Relay a WebRTC offer to the intended participant.
  socket.on("webrtc:offer", ({ to, offer } = {}) => {
    if (
      !voiceUsers.has(socket.id) ||
      !to ||
      !offer ||
      !voiceUsers.has(to)
    ) {
      return;
    }

    io.to(to).emit("webrtc:offer", {
      from: socket.id,
      offer,
    });
  });

  // Relay a WebRTC answer to the intended participant.
  socket.on("webrtc:answer", ({ to, answer } = {}) => {
    if (
      !voiceUsers.has(socket.id) ||
      !to ||
      !answer ||
      !voiceUsers.has(to)
    ) {
      return;
    }

    io.to(to).emit("webrtc:answer", {
      from: socket.id,
      answer,
    });
  });

  // Relay ICE candidates.
  socket.on("webrtc:ice-candidate", ({ to, candidate } = {}) => {
    if (
      !voiceUsers.has(socket.id) ||
      !to ||
      !candidate ||
      !voiceUsers.has(to)
    ) {
      return;
    }

    io.to(to).emit("webrtc:ice-candidate", {
      from: socket.id,
      candidate,
    });
  });

  // Disconnect cleanup
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    players.delete(socket.id);

    if (voiceUsers.has(socket.id)) {
      voiceUsers.delete(socket.id);

      socket.broadcast.emit("voice:peer-left", {
        peerId: socket.id,
      });
    }

    io.emit("player:left", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`ProxiSpeak server running on port ${PORT}`);
});
