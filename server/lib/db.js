
const { MongoClient } = require("mongodb");

let client;
let db;

async function connectDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is missing from server/.env");
  }

  client = new MongoClient(uri);
  await client.connect();

  db = client.db("proxispeak");

  await db.command({ ping: 1 });
  console.log("MongoDB connected successfully");

  return db;
}

function getDB() {
  if (!db) {
    throw new Error("MongoDB is not connected yet");
  }

  return db;
}

module.exports = { connectDB, getDB };
