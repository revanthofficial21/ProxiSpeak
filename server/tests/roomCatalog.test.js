const assert = require("node:assert/strict");
const { initializeRoomCatalog } = require("../lib/roomCatalog");

function createRoomDatabase(initialRooms = []) {
  const rooms = new Map(initialRooms.map((room) => [room._id, { ...room }]));
  let uniqueNameIndexCreated = false;

  return {
    rooms,
    collection(name) {
      assert.equal(name, "rooms");
      return {
        async createIndex(keys, options) {
          assert.deepEqual(keys, { name: 1 });
          assert.equal(options.unique, true);
          uniqueNameIndexCreated = true;
          const names = [...rooms.values()].map((room) => room.name);
          assert.equal(new Set(names).size, names.length);
        },
        async bulkWrite(operations) {
          assert.equal(uniqueNameIndexCreated, true);
          for (const { updateOne } of operations) {
            const { _id } = updateOne.filter;
            if (!rooms.has(_id)) {
              rooms.set(_id, { _id, ...updateOne.update.$setOnInsert });
            }
          }
        },
        find() {
          return {
            sort() {
              return this;
            },
            async toArray() {
              return [...rooms.values()].sort((first, second) =>
                first.name.localeCompare(second.name)
              );
            },
          };
        },
      };
    },
  };
}

async function run() {
  const database = createRoomDatabase([
    { _id: "custom-space", name: "Custom Space", createdAt: new Date() },
  ]);

  const firstLoad = await initializeRoomCatalog(database);
  assert.equal(firstLoad.length, 4);
  assert.deepEqual(
    firstLoad.map(({ id, name }) => [id, name]),
    [
      ["custom-space", "Custom Space"],
      ["lounge", "Lounge"],
      ["meeting-room", "Meeting Room"],
      ["open-world", "Open World"],
    ]
  );

  // Loading again must not duplicate the defaults.
  const secondLoad = await initializeRoomCatalog(database);
  assert.equal(secondLoad.length, 4);
  assert.equal(database.rooms.size, 4);

  console.log("Room catalog tests passed");
}

run().catch((error) => {
  console.error("Room catalog tests failed:", error);
  process.exitCode = 1;
});
