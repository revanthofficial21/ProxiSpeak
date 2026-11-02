const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 600;
const PROXIMITY_DISTANCE = 100;
const players = new Map();
const voiceParticipants = new Set();

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json());

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
  },
});

app.get('/', (_req, res) => {
  res.json({ status: 'ProxiSpeak server running', connectedPlayers: players.size });
});

function publicPlayer(player) {
  return { id: player.id, x: player.x, y: player.y, name: player.name, avatarColor: player.avatarColor };
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function updateProximity() {
  const all = Array.from(players.values());
  for (const player of all) {
    const nearby = all.filter((other) => other.id !== player.id && distance(player, other) <= PROXIMITY_DISTANCE);
    io.to(player.id).emit('player:nearby', nearby.map(publicPlayer));
  }
  // Emit enter/leave transitions to both clients.
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const key = [a.id, b.id].sort().join(':');
      const isNear = distance(a, b) <= PROXIMITY_DISTANCE;
      const wasNear = proximityPairs.has(key);
      if (isNear && !wasNear) {
        io.to(a.id).emit('proximity:enter', publicPlayer(b));
        io.to(b.id).emit('proximity:enter', publicPlayer(a));
      } else if (!isNear && wasNear) {
        io.to(a.id).emit('proximity:leave', b.id);
        io.to(b.id).emit('proximity:leave', a.id);
      }
      if (isNear) proximityPairs.add(key); else proximityPairs.delete(key);
    }
  }
}
const proximityPairs = new Set();

io.on('connection', (socket) => {
  const player = {
    id: socket.id,
    x: 500 + (Math.random() * 120 - 60),
    y: 300 + (Math.random() * 120 - 60),
    name: `Player-${socket.id.slice(0, 4)}`,
    avatarColor: '#6ee7b7',
  };
  players.set(socket.id, player);
  socket.emit('world:state', Array.from(players.values()).map(publicPlayer));
  socket.broadcast.emit('player:joined', publicPlayer(player));
  updateProximity();

  socket.on('player:move', (position) => {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    player.x = Math.max(20, Math.min(WORLD_WIDTH - 20, position.x));
    player.y = Math.max(20, Math.min(WORLD_HEIGHT - 20, position.y));
    io.emit('player:moved', publicPlayer(player));
    updateProximity();
  });

  socket.on('player:setName', (name, callback) => {
    const cleanName = typeof name === 'string' ? name.trim().slice(0, 24) : '';
    if (!cleanName) {
      if (typeof callback === 'function') callback({ ok: false, message: 'Enter a name.' });
      return;
    }
    player.name = cleanName;
    io.emit('player:renamed', publicPlayer(player));
    if (typeof callback === 'function') callback({ ok: true, player: publicPlayer(player) });
  });

  socket.on('player:setAvatarColor', (color, callback) => {
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      if (typeof callback === 'function') callback({ ok: false, message: 'Invalid color.' });
      return;
    }
    player.avatarColor = color;
    io.emit('player:avatarColorUpdated', publicPlayer(player));
    if (typeof callback === 'function') callback({ ok: true, player: publicPlayer(player) });
  });

  // WebRTC signalling relay: audio itself travels peer-to-peer, not through this server.
  socket.on('voice:join', () => {
    voiceParticipants.add(socket.id);
    for (const peerId of voiceParticipants) {
      if (peerId !== socket.id && players.has(peerId) && distance(player, players.get(peerId)) <= PROXIMITY_DISTANCE) {
        socket.emit('voice:peer', { peerId });
      }
    }
  });
  socket.on('voice:leave', () => {
    voiceParticipants.delete(socket.id);
    for (const peerId of voiceParticipants) io.to(peerId).emit('voice:peer-left', { peerId: socket.id });
  });
  socket.on('voice:request-peer', ({ peerId } = {}) => {
    if (!peerId || peerId === socket.id || !voiceParticipants.has(peerId)) return;
    if (!players.has(peerId) || distance(player, players.get(peerId)) > PROXIMITY_DISTANCE) return;
    io.to(peerId).emit('voice:peer', { peerId: socket.id });
  });
  for (const eventName of ['webrtc:offer', 'webrtc:answer', 'webrtc:ice-candidate']) {
    socket.on(eventName, (payload = {}) => {
      const { to } = payload;
      if (typeof to !== 'string' || !players.has(to)) return;
      io.to(to).emit(eventName, { ...payload, from: socket.id });
    });
  }

  socket.on('disconnect', () => {
    players.delete(socket.id);
    voiceParticipants.delete(socket.id);
    for (const peerId of voiceParticipants) io.to(peerId).emit('voice:peer-left', { peerId: socket.id });
    for (const key of proximityPairs) if (key.split(':').includes(socket.id)) proximityPairs.delete(key);
    socket.broadcast.emit('player:left', socket.id);
    updateProximity();
  });
});

server.listen(PORT, () => console.log(`ProxiSpeak server listening on http://localhost:${PORT}`));
