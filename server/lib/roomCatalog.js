// A small catalog of named spaces the client can list and pick from.
//
// NOTE: this is a catalog only — players are NOT yet scoped to a room, so
// everyone still shares one world. Room-scoped worlds are a later feature.
const DEFAULT_ROOMS = [
  { id: "open-world", name: "Open World" },
  { id: "meeting-room", name: "Meeting Room" },
  { id: "lounge", name: "Lounge" },
];

async function initializeRoomCatalog(db) {
  const collection = db.collection("rooms");

  await collection.createIndex({ name: 1 }, { unique: true });
  await collection.bulkWrite(
    DEFAULT_ROOMS.map((room) => ({
      updateOne: {
        filter: { _id: room.id },
        update: {
          $setOnInsert: {
            name: room.name,
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    }))
  );

  const documents = await collection
    .find({}, { projection: { _id: 1, name: 1 } })
    .sort({ name: 1 })
    .toArray();

  return documents.map((room) => ({ id: room._id, name: room.name }));
}

module.exports = { DEFAULT_ROOMS, initializeRoomCatalog };
