const {
  markPlayerConnected,
  markPlayerDisconnected,
  positionFields,
  restoreReturningPlayer,
} = require("./player-persistence");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    console.error(`FAIL  ${label}`);
    failures += 1;
  }
}

function createCollection(documents, failures = {}) {
  return {
    find(filter) {
      let limit = Infinity;
      const cursor = {
        project() {
          return cursor;
        },
        limit(value) {
          limit = value;
          return cursor;
        },
        async toArray() {
          return documents.filter((document) => {
            if (filter.name !== undefined && document.name !== filter.name) {
              return false;
            }
            if (
              filter.socketId !== undefined &&
              document.socketId !== filter.socketId
            ) {
              return false;
            }
            if (
              filter._id?.$ne !== undefined &&
              document._id === filter._id.$ne
            ) {
              return false;
            }
            return true;
          }).slice(0, limit);
        },
      };
      return cursor;
    },
    async updateOne(filter, update) {
      if (failures.update) throw new Error("Injected update failure");
      const document = documents.find(
        (candidate) =>
          candidate._id === filter._id &&
          candidate.socketId === filter.socketId &&
          candidate.name === filter.name &&
          candidate.connected === filter.connected
      );
      if (!document) return { matchedCount: 0 };
      Object.assign(document, update.$set);
      return { matchedCount: 1 };
    },
    async deleteMany(filter) {
      if (failures.delete) throw new Error("Injected cleanup failure");
      if (failures.deleteCountMismatch) return { deletedCount: 0 };
      const before = documents.length;
      const remaining = documents.filter(
        (document) =>
          document.socketId !== filter.socketId ||
          document._id === filter._id.$ne
      );
      documents.splice(0, documents.length, ...remaining);
      return { deletedCount: before - documents.length };
    },
  };
}

function restore(collection, _documents, name = "Returning Player") {
  return restoreReturningPlayer(
    collection,
    name,
    "new-socket",
    ({ x, y }) => ({ x, y })
  );
}

function createSessionStatusCollection(records) {
  const updates = [];
  return {
    updates,
    async updateOne(filter, update, options = {}) {
      updates.push({ filter, update, options });
      const record = records.find(
        (candidate) =>
          candidate.socketId === filter.socketId &&
          (filter.connected === undefined ||
            candidate.connected === filter.connected)
      );
      if (record) {
        Object.assign(record, update.$set);
        return { matchedCount: 1, upsertedCount: 0 };
      }
      if (!options.upsert) return { matchedCount: 0, upsertedCount: 0 };

      records.push({
        ...update.$setOnInsert,
        ...update.$set,
      });
      return { matchedCount: 0, upsertedCount: 1 };
    },
  };
}

async function runTests() {
  const position = positionFields(180, 240);
  check(
    "position save keeps x, y, and location synchronized",
    position.x === 180 &&
      position.y === 240 &&
      position.location[0] === 180 &&
      position.location[1] === 240
  );

  const sessionRecords = [];
  const statusCollection = createSessionStatusCollection(sessionRecords);
  const connectedPlayer = {
    socketId: "session-a",
    name: "Connected Player",
    x: 120,
    y: 160,
  };
  await markPlayerConnected(statusCollection, connectedPlayer);
  await markPlayerConnected(statusCollection, { ...connectedPlayer, x: 140 });
  check(
    "connect upserts an active record with synchronized position and no duplicate",
    sessionRecords.length === 1 &&
      sessionRecords[0].connected === true &&
      sessionRecords[0].x === 140 &&
      sessionRecords[0].y === 160 &&
      sessionRecords[0].location[0] === 140 &&
      sessionRecords[0].location[1] === 160 &&
      statusCollection.updates.every(
        (update) =>
          update.filter.socketId === "session-a" &&
          update.options.upsert === true
      )
  );

  const disconnected = await markPlayerDisconnected(
    statusCollection,
    "session-a"
  );
  check(
    "disconnect marks its own active socket record disconnected",
    disconnected.matchedCount === 1 &&
      sessionRecords[0].connected === false &&
      statusCollection.updates.at(-1).filter.socketId === "session-a" &&
      statusCollection.updates.at(-1).filter.connected === true
  );

  const newerSession = {
    socketId: "new-session",
    name: "Returning Player",
    x: 210,
    y: 190,
    connected: true,
  };
  const staleCollection = createSessionStatusCollection([newerSession]);
  const staleDisconnect = await markPlayerDisconnected(
    staleCollection,
    "old-session"
  );
  check(
    "a stale socket disconnect does not mark a newer session disconnected",
    staleDisconnect.matchedCount === 0 && newerSession.connected === true
  );

  const failingCollection = {
    async updateOne() {
      throw new Error("Injected MongoDB failure");
    },
  };
  let connectError;
  try {
    await markPlayerConnected(failingCollection, connectedPlayer);
  } catch (error) {
    connectError = error;
  }
  let disconnectError;
  try {
    await markPlayerDisconnected(failingCollection, "session-a");
  } catch (error) {
    disconnectError = error;
  }
  check(
    "connection status helpers surface MongoDB errors to their callers",
    connectError?.message === "Injected MongoDB failure" &&
      disconnectError?.message === "Injected MongoDB failure"
  );

  const returningRecord = {
    _id: "saved-record",
    socketId: "old-socket",
    name: "Returning Player",
    x: 180,
    y: 240,
    connected: false,
  };
  const temporaryRecord = {
    _id: "temporary-record",
    socketId: "new-socket",
    name: "",
    x: 80,
    y: 80,
    connected: true,
  };
  const documents = [returningRecord, temporaryRecord];
  const restored = await restore(createCollection(documents), documents);
  check(
    "a unique inactive player record is restored and claimed by the new socket",
    restored?.x === 180 &&
      restored?.y === 240 &&
      restored?.location[0] === 180 &&
      restored?.location[1] === 240 &&
      returningRecord.socketId === "new-socket" &&
      returningRecord.connected === true &&
      documents.length === 1 &&
      documents[0]._id === "saved-record"
  );

  const activeRecord = {
    _id: "active-record",
    socketId: "active-socket",
    name: "Same Name",
    x: 300,
    y: 200,
    connected: true,
  };
  const noRestore = await restore(
    createCollection([activeRecord]),
    [activeRecord],
    "Same Name"
  );
  check(
    "an active player's record is never restored or claimed",
    noRestore === null && activeRecord.socketId === "active-socket"
  );

  const duplicateRecords = [
    {
      ...returningRecord,
      _id: "inactive-one",
      socketId: "old-socket-one",
      connected: false,
    },
    {
      ...returningRecord,
      _id: "inactive-two",
      socketId: "old-socket-two",
      connected: false,
    },
  ];
  const ambiguousRestore = await restore(
    createCollection(duplicateRecords),
    duplicateRecords
  );
  check(
    "ambiguous inactive names are not restored",
    ambiguousRestore === null &&
      duplicateRecords.every((record) => record.socketId.startsWith("old-socket"))
  );

  const activeAndInactive = [
    {
      ...returningRecord,
      _id: "inactive",
      socketId: "old-socket",
      connected: false,
    },
    {
      ...activeRecord,
      _id: "same-name-active",
      name: "Returning Player",
    },
  ];
  const mixedDuplicateRestore = await restore(
    createCollection(activeAndInactive),
    activeAndInactive
  );
  check(
    "active and inactive records with the same name are ambiguous",
    mixedDuplicateRestore === null &&
      activeAndInactive[0].socketId === "old-socket" &&
      activeAndInactive[0].connected === false &&
      activeAndInactive[1].socketId === "active-socket" &&
      activeAndInactive[1].connected === true
  );

  const invalidRecord = {
    _id: "invalid-record",
    socketId: "old-socket",
    name: "Invalid Player",
    x: NaN,
    y: 240,
    connected: false,
  };
  const invalidRestore = await restoreReturningPlayer(
    createCollection([invalidRecord]),
    "Invalid Player",
    "new-socket",
    ({ x, y }) => ({ x, y })
  );
  check(
    "saved records with invalid coordinates are not restored",
    invalidRestore === null && invalidRecord.socketId === "old-socket"
  );

  // Without a transaction the claim is atomic but the cleanup is best-effort:
  // an update failure must leave the records untouched, while a cleanup
  // failure happens after the record has already been claimed.
  const updateFailureDocuments = [
    { ...returningRecord, _id: "update-saved", socketId: "update-old", connected: false },
    { ...temporaryRecord, _id: "update-temporary" },
  ];
  const updateFailureOriginal = structuredClone(updateFailureDocuments);
  let updateError;
  try {
    await restore(
      createCollection(updateFailureDocuments, { update: true }),
      updateFailureDocuments
    );
  } catch (caught) {
    updateError = caught;
  }
  check(
    "update failure leaves player records untouched",
    updateError instanceof Error &&
      JSON.stringify(updateFailureDocuments) ===
        JSON.stringify(updateFailureOriginal)
  );

  const cleanupFailureDocuments = [
    { ...returningRecord, _id: "cleanup-saved", socketId: "cleanup-old", connected: false },
    { ...temporaryRecord, _id: "cleanup-temporary" },
  ];
  let cleanupError;
  try {
    await restore(
      createCollection(cleanupFailureDocuments, { delete: true }),
      cleanupFailureDocuments
    );
  } catch (caught) {
    cleanupError = caught;
  }
  check(
    "cleanup failure throws after the record has already been claimed",
    cleanupError instanceof Error &&
      cleanupFailureDocuments[0].connected === true &&
      cleanupFailureDocuments[0].socketId === "new-socket"
  );

  console.log(
    failures === 0
      ? "All player persistence tests passed"
      : `${failures} player persistence test(s) failed`
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

runTests().catch((error) => {
  console.error("Player persistence tests failed:", error);
  process.exitCode = 1;
});
