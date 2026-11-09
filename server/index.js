require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const {
    connectDB,
    closeDB
} = require("./db");

const {
    PROXIMITY_DISTANCE,
    calculateDistance,
    savePlayer,
    removePlayer,
    getPlayer,
    findNearbyPlayers,
    arePlayersNearby
} = require("./proximity");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

const io = new Server(server, {
    cors: {
        origin: CLIENT_URL,
        methods: ["GET", "POST"]
    },
    pingInterval: 25000,
    pingTimeout: 20000
});

const activePlayers = new Map();
const voiceParticipants = new Set();

app.get("/", (req, res) => {
    res.json({
        application: "ProxiSpeak",
        status: "running",
        connectedPlayers: activePlayers.size,
        proximityDistance: PROXIMITY_DISTANCE
    });
});

app.get("/health", (req, res) => {
    res.json({
        status: "healthy",
        database: "connected",
        connectedPlayers: activePlayers.size
    });
});

function validCoordinates(x, y) {
    return (
        Number.isFinite(Number(x)) &&
        Number.isFinite(Number(y)) &&
        Number(x) >= 0 &&
        Number(y) >= 0 &&
        Number(x) <= 2000 &&
        Number(y) <= 2000
    );
}

function getPlayerInfo(socketId) {
    return activePlayers.get(socketId);
}

async function getNearby(socketId) {
    const player = getPlayerInfo(socketId);

    if (!player) return [];

    return findNearbyPlayers(
        player.x,
        player.y,
        socketId,
        player.officeId
    );
}

async function updateNearby(socketId) {
    const player = getPlayerInfo(socketId);

    if (!player) return;

    try {
        const nearbyPlayers = await getNearby(socketId);

        io.to(socketId).emit(
            "player:nearby",
            nearbyPlayers
        );

        for (const nearby of nearbyPlayers) {
            io.to(nearby.socketId).emit("proximity:enter", {
                socketId,
                name: player.name,
                x: player.x,
                y: player.y
            });
        }
    } catch (error) {
        console.error("Proximity update error:", error.message);
    }
}

async function canRelayVoice(from, to) {
    if (!from || !to || from === to) return false;

    if (
        !activePlayers.has(from) ||
        !activePlayers.has(to)
    ) {
        return false;
    }

    if (
        !voiceParticipants.has(from) ||
        !voiceParticipants.has(to)
    ) {
        return false;
    }

    return arePlayersNearby(from, to);
}

io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    // PLAYER JOIN
    socket.on("player:join", async (data = {}) => {
        try {
            const player = {
                socketId: socket.id,
                name: String(data.name || "Anonymous").slice(0, 30),
                x: Number(data.x ?? 100),
                y: Number(data.y ?? 100),
                officeId: String(data.officeId || "main-office")
            };

            if (!validCoordinates(player.x, player.y)) {
                socket.emit("server:error", {
                    message: "Invalid player coordinates."
                });
                return;
            }

            activePlayers.set(socket.id, player);

            await savePlayer(player);

            const players = await getNearby(socket.id);

            socket.emit("world:state", players);

            socket.broadcast.emit("player:joined", {
                socketId: socket.id,
                name: player.name,
                x: player.x,
                y: player.y
            });

            await updateNearby(socket.id);

            console.log("Player joined:", player.name);
        } catch (error) {
            console.error("Join error:", error.message);

            activePlayers.delete(socket.id);

            socket.emit("server:error", {
                message: "Unable to join the office."
            });
        }
    });

    // PLAYER MOVEMENT
    socket.on("player:move", async (data = {}) => {
        try {
            const player = getPlayerInfo(socket.id);

            if (!player) return;

            const x = Number(data.x);
            const y = Number(data.y);

            if (!validCoordinates(x, y)) return;

            player.x = x;
            player.y = y;

            await savePlayer(player);

            socket.broadcast.emit("player:moved", {
                socketId: socket.id,
                name: player.name,
                x,
                y
            });

            await updateNearby(socket.id);
        } catch (error) {
            console.error("Movement error:", error.message);
        }
    });

    // JOIN VOICE
    socket.on("voice:join", async () => {
        if (!activePlayers.has(socket.id)) return;

        voiceParticipants.add(socket.id);

        const nearby = await getNearby(socket.id);

        socket.emit("voice:nearby", nearby);
    });

    // REQUEST PEER CONNECTION
    socket.on("voice:request-peer", async (data = {}) => {
        const targetId = data.to;

        if (!await canRelayVoice(socket.id, targetId)) {
            return;
        }

        io.to(targetId).emit("voice:peer-request", {
            from: socket.id
        });
    });

    // WEBRTC OFFER
    socket.on("webrtc:offer", async (data = {}) => {
        const targetId = data.to;

        if (!await canRelayVoice(socket.id, targetId)) {
            return;
        }

        io.to(targetId).emit("webrtc:offer", {
            from: socket.id,
            offer: data.offer
        });
    });

    // WEBRTC ANSWER
    socket.on("webrtc:answer", async (data = {}) => {
        const targetId = data.to;

        if (!await canRelayVoice(socket.id, targetId)) {
            return;
        }

        io.to(targetId).emit("webrtc:answer", {
            from: socket.id,
            answer: data.answer
        });
    });

    // WEBRTC ICE CANDIDATE
    socket.on("webrtc:ice-candidate", async (data = {}) => {
        const targetId = data.to;

        if (!await canRelayVoice(socket.id, targetId)) {
            return;
        }

        io.to(targetId).emit("webrtc:ice-candidate", {
            from: socket.id,
            candidate: data.candidate
        });
    });

    // LEAVE VOICE
    socket.on("voice:leave", () => {
        voiceParticipants.delete(socket.id);

        socket.broadcast.emit("voice:peer-left", {
            socketId: socket.id
        });
    });

    // DISCONNECT
    socket.on("disconnect", async () => {
        try {
            const player = getPlayerInfo(socket.id);

            activePlayers.delete(socket.id);
            voiceParticipants.delete(socket.id);

            await removePlayer(socket.id);

            socket.broadcast.emit("player:left", {
                socketId: socket.id
            });

            socket.broadcast.emit("voice:peer-left", {
                socketId: socket.id
            });

            if (player) {
                console.log("Player disconnected:", player.name);
            }
        } catch (error) {
            console.error("Disconnect error:", error.message);
        }
    });
});

// START SERVER
async function startServer() {
    try {
        await connectDB();

        server.listen(PORT, () => {
            console.log(
                `ProxiSpeak server running at http://localhost:${PORT}`
            );
            console.log(
                `Proximity distance: ${PROXIMITY_DISTANCE}px`
            );
        });
    } catch (error) {
        console.error("Server startup failed:", error);
        process.exit(1);
    }
}

// GRACEFUL SHUTDOWN
async function shutdown() {
    console.log("Shutting down ProxiSpeak...");

    io.close();

    server.close(async () => {
        await closeDB();
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

startServer();
