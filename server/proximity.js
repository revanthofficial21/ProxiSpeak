const { getDB } = require("./db");

const PROXIMITY_DISTANCE = Number(
  process.env.PROXIMITY_DISTANCE || 100
);

const COLLECTION_NAME = "players";

let indexPromise = null;

function getPlayersCollection() {
  const database = getDB();

  if (!database) {
    throw new Error("MongoDB database is not connected.");
  }

  return database.collection(COLLECTION_NAME);
}

async function ensureIndexes() {
  if (!indexPromise) {
    indexPromise = (async () => {
      const collection = getPlayersCollection();

      await collection.createIndex({ location: "2d" });
      await collection.createIndex({ socketId: 1 }, { unique: true });
      await collection.createIndex({ officeId: 1 });

    })().catch(error => {
      indexPromise = null;
      throw error;
    });
  }

  return indexPromise;
}

function validPlayer(player) {
  return (
    player &&
    typeof player.socketId === "string" &&
    Number.isFinite(Number(player.x)) &&
    Number.isFinite(Number(player.y)) &&
    Number(player.x) >= 0 &&
    Number(player.y) >= 0 &&
    Number(player.x) <= 2000 &&
    Number(player.y) <= 2000
  );
}

async function savePlayer(player) {
  if (!validPlayer(player)) {
    throw new Error("Invalid player data.");
  }

  await ensureIndexes();

  const collection = getPlayersCollection();

  const x = Number(player.x);
  const y = Number(player.y);

  await collection.updateOne(
    { socketId: player.socketId },
    {
      $set: {
        socketId: player.socketId,
        name: player.name || "Anonymous",
        x,
        y,
        location: [x, y],
        officeId: player.officeId || "main-office",
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
}

async function removePlayer(socketId) {
  if (!socketId) return;

  await ensureIndexes();

  await getPlayersCollection().deleteOne({
    socketId
  });
}

async function findNearbyPlayers(
  x,
  y,
  excludeSocketId,
  officeId = "main-office"
) {
  const px = Number(x);
  const py = Number(y);

  if (
    !Number.isFinite(px) ||
    !Number.isFinite(py)
  ) {
    return [];
  }

  await ensureIndexes();

  const collection = getPlayersCollection();

  const query = {
    location: {
      $near: [px, py],
      $maxDistance: PROXIMITY_DISTANCE
    },
    officeId
  };

  if (excludeSocketId) {
    query.socketId = { $ne: excludeSocketId };
  }

  const players = await collection
    .find(query)
    .project({
      _id: 0,
      socketId: 1,
      name: 1,
      x: 1,
      y: 1,
      officeId: 1
    })
    .toArray();

  return players;
}

async function getPlayer(socketId) {
  await ensureIndexes();

  return getPlayersCollection().findOne(
    { socketId },
    { projection: { _id: 0 } }
  );
}

async function arePlayersNearby(firstSocketId, secondSocketId) {
  const [first, second] = await Promise.all([
    getPlayer(firstSocketId),
    getPlayer(secondSocketId)
  ]);

  if (!first || !second) return false;

  if (first.officeId !== second.officeId) return false;

  const distance = Math.hypot(
    first.x - second.x,
    first.y - second.y
  );

  return distance <= PROXIMITY_DISTANCE;
}

module.exports = {
  PROXIMITY_DISTANCE,
  savePlayer,
  removePlayer,
  findNearbyPlayers,
  getPlayer,
  arePlayersNearby
};
