// server/proximity.js

const { getPlayersCollection } = require("./db");

const PROXIMITY_DISTANCE = 100;

function calculateDistance(playerA, playerB) {
  const dx = Number(playerA.x) - Number(playerB.x);
  const dy = Number(playerA.y) - Number(playerB.y);

  return Math.sqrt(dx * dx + dy * dy);
}

async function savePlayer(player) {
  const collection = getPlayersCollection();

  const x = Number(player.x);
  const y = Number(player.y);

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Invalid player coordinates.");
  }

  const document = {
    socketId: player.socketId,
    name: player.name || "Anonymous",
    x,
    y,
    location: [x, y],
    updatedAt: new Date()
  };

  await collection.updateOne(
    { socketId: player.socketId },
    { $set: document },
    { upsert: true }
  );

  return document;
}

async function removePlayer(socketId) {
  await getPlayersCollection().deleteOne({ socketId });
}

async function getPlayer(socketId) {
  return getPlayersCollection().findOne({ socketId });
}

async function findNearbyPlayers(x, y, excludeSocketId = null) {
  const collection = getPlayersCollection();

  const query = {
    location: {
      $near: [Number(x), Number(y)],
      $maxDistance: PROXIMITY_DISTANCE
    }
  };

  if (excludeSocketId) {
    query.socketId = { $ne: excludeSocketId };
  }

  const players = await collection.find(query).toArray();

  // Apply an explicit Euclidean-distance check as an additional safeguard.
  return players.filter((player) => {
    return calculateDistance(
      { x, y },
      { x: player.x, y: player.y }
    ) <= PROXIMITY_DISTANCE;
  });
}

async function arePlayersNearby(socketIdA, socketIdB) {
  const collection = getPlayersCollection();

  const [playerA, playerB] = await Promise.all([
    collection.findOne({ socketId: socketIdA }),
    collection.findOne({ socketId: socketIdB })
  ]);

  if (!playerA || !playerB) {
    return false;
  }

  return (
    calculateDistance(playerA, playerB) <= PROXIMITY_DISTANCE
  );
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
