
require("dotenv").config();

const { MongoClient } = require("mongodb");

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || "proxyspeak";

let client = null;
let database = null;
let connectionPromise = null;

async function connectDB() {
  if (database) {
    return database;
  }

  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is missing from server/.env"
    );
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    const newClient = new MongoClient(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 50,
      minPoolSize: 0
    });

    try {
      await newClient.connect();

      const newDatabase = newClient.db(DB_NAME);

      await newDatabase.command({ ping: 1 });

      client = newClient;
      database = newDatabase;

      console.log(`Connected to MongoDB database: ${DB_NAME}`);

      return database;
    } catch (error) {
      await newClient.close().catch(() => {});

      client = null;
      database = null;

      throw error;
    } finally {
      connectionPromise = null;
    }
  })();

  return connectionPromise;
}

function getDB() {
  if (!database) {
    throw new Error("MongoDB is not connected.");
  }

  return database;
}

async function closeDB() {
  if (connectionPromise) {
    await connectionPromise.catch(() => {});
  }

  if (client) {
    await client.close();

    client = null;
    database = null;

    console.log("MongoDB connection closed.");
  }
}

module.exports = {
  connectDB,
  getDB,
  closeDB
};
