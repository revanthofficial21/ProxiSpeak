const { MongoClient } = require("mongodb");

let client;
let database;

async function connectDB() {
    if (database) {
        return database;
    }

    const uri = process.env.MONGODB_URI;
    const dbName = process.env.DB_NAME || "proxyspeak";

    if (!uri) {
        throw new Error("MONGODB_URI is missing in server/.env");
    }

    client = new MongoClient(uri);

    await client.connect();

    database = client.db(dbName);

    console.log("MongoDB connected successfully!");

    await createIndexes();

    return database;
}

async function createIndexes() {
    const players = database.collection("players");
    const offices = database.collection("offices");

    await players.createIndex(
        { location: "2d" },
        { name: "player_location_2d" }
    );

    await players.createIndex(
        { socketId: 1 },
        { unique: true, name: "player_socket_unique" }
    );

    await players.createIndex(
        { updatedAt: 1 },
        { expireAfterSeconds: 86400, name: "player_expiry" }
    );

    await offices.createIndex(
        { officeId: 1 },
        { unique: true, name: "office_id_unique" }
    );

    console.log("MongoDB indexes created successfully.");
}

function getDB() {
    if (!database) {
        throw new Error("Database is not connected.");
    }

    return database;
}

function getPlayersCollection() {
    return getDB().collection("players");
}

function getOfficesCollection() {
    return getDB().collection("offices");
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
    getOfficesCollection,
    closeDB
};
