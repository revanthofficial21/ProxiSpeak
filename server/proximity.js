const { getPlayersCollection } = require("./db");

const PROXIMITY_DISTANCE = 100;

function calculateDistance(x1, y1, x2, y2) {
    return Math.sqrt(
        Math.pow(x2 - x1, 2) +
        Math.pow(y2 - y1, 2)
    );
}

async function savePlayer(player) {
    const players = getPlayersCollection();

    const x = Number(player.x);
    const y = Number(player.y);

    if (!player.socketId || !Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("Invalid player information.");
    }

    const document = {
        socketId: player.socketId,
        name: player.name || "Anonymous",
        x,
        y,
        location: [x, y],
        officeId: player.officeId || "main-office",
        updatedAt: new Date()
    };

    await players.updateOne(
        { socketId: player.socketId },
        { $set: document },
        { upsert: true }
    );

    return document;
}

async function removePlayer(socketId) {
    return getPlayersCollection().deleteOne({ socketId });
}

async function getPlayer(socketId) {
    return getPlayersCollection().findOne({ socketId });
}

async function findNearbyPlayers(x, y, excludeSocketId, officeId = "main-office") {
    const players = getPlayersCollection();

    x = Number(x);
    y = Number(y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error("Invalid coordinates.");
    }

    const nearby = await players.find({
        socketId: { $ne: excludeSocketId },
        officeId,
        location: {
            $near: [x, y],
            $maxDistance: PROXIMITY_DISTANCE
        }
    }).toArray();

    return nearby.filter(player =>
        calculateDistance(x, y, player.x, player.y) <= PROXIMITY_DISTANCE
    );
}

async function arePlayersNearby(socketId1, socketId2) {
    const [player1, player2] = await Promise.all([
        getPlayer(socketId1),
        getPlayer(socketId2)
    ]);

    if (!player1 || !player2) {
        return false;
    }

    if (player1.officeId !== player2.officeId) {
        return false;
    }

    return calculateDistance(
        player1.x,
        player1.y,
        player2.x,
        player2.y
    ) <= PROXIMITY_DISTANCE;
}

module.exports = {
    PROXIMITY_DISTANCE,
    calculateDistance,
    savePlayer,
    removePlayer,
    getPlayer,
    findNearbyPlayers,
    arePlayersNearby
};
