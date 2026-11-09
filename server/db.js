// server/db.js

const { MongoClient } = require("mongodb");

let client;
let database;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME || "proxyspeak";

  if (!uri) {
    throw new Error("MONGODB_URI is missing in server/.env");
  }

  client = new MongoClient(uri);

  await client.connect();
  database = client.db(dbName);

  console.log("MongoDB connected successfully!");

  // A 2D index is appropriate for the project's pixel-based X/Y coordinates.
  await database.collection("players").createIndex({ location: "2d" });

  await database.collection("players").createIndex(
    { updatedAt: 1 },
    { expireAfterSeconds: 86400 }
  );

  console.log("2D geospatial index created successfully.");

  return database;
}

function getDB() {
  if (!database) {
    throw new Error("Database is not connected. Call connectDB() first.");
  }

  return database;
}

function getPlayersCollection() {
  return getDB().collection("players");
}

async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    database = null;
  }
}

module.exports = {
  connectDB,
  getDB,
  getPlayersCollection,
  closeDB
};
