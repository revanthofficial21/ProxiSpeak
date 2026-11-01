const {
  changePlayerRoom,
  createPlayerPersistenceQueue,
  markPlayerConnected,
  markPlayerDisconnected,
  positionFields,
  restoreReturningPlayer,
  savePlayerPosition,
} = require("../lib/player-persistence");

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
          if (failures.find) throw new Error("Injected lookup failure");
          if (failures.findBarrier) await failures.findBarrier();
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
          Object.entries(filter).every(
            ([key, value]) => candidate[key] === value
          )
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
  const enqueuePersistence = createPlayerPersistenceQueue();
  const movementRecord = { x: 0, y: 0 };
  const movementState = { x: 0, y: 0 };
  let releaseFirstMove;
  let markFirstMoveStarted;
  const firstMoveStarted = new Promise((resolve) => {
    markFirstMoveStarted = resolve;
  });
  const firstMoveGate = new Promise((resolve) => {
    releaseFirstMove = resolve;
  });
  const firstMove = enqueuePersistence("movement-socket", async () => {
    markFirstMoveStarted();
    await firstMoveGate;
    movementRecord.x = 100;
    movementState.x = 100;
  });
  await firstMoveStarted;
  let secondMoveStarted = false;
  const secondMove = enqueuePersistence("movement-socket", async () => {
    secondMoveStarted = true;
    movementRecord.x = 200;
    movementState.x = 200;
  });
  await Promise.resolve();
  check(
    "queued movement waits for the earlier persistence mutation",
    !secondMoveStarted && movementRecord.x === 0 && movementState.x === 0
  );
  releaseFirstMove();
  await Promise.all([firstMove, secondMove]);
  check(
    "concurrent movement leaves the newest database and in-memory position",
    movementRecord.x === 200 && movementState.x === 200
  );

  let afterFailureRan = false;
  await enqueuePersistence("movement-socket", async () => {
    throw new Error("Injected queued failure");
  }).catch(() => {});
  await enqueuePersistence("movement-socket", async () => {
    afterFailureRan = true;
  });
  check(
    "a rejected persistence mutation does not block later socket work",
    afterFailureRan
  );

  const disconnectRecords = [
    { socketId: "disconnect-socket", connected: true },
  ];
  const initialPersistenceFailure = Promise.reject(
    new Error("Injected initial persistence failure")
  );
  await enqueuePersistence("disconnect-socket", async () => {
    try {
      await initialPersistenceFailure;
    } catch {
      // Disconnect still performs its conditional status update.
    }
    await markPlayerDisconnected(
      createSessionStatusCollection(disconnectRecords),
      "disconnect-socket"
    );
  });
  check(
    "disconnect status is updated after initial persistence fails",
    disconnectRecords[0].connected === false
  );

  const roomSocket = (initialRoom, failures = {}) => {
    const rooms = new Set([initialRoom]);
    let failLeaveRoom = failures.leaveRoom;
    return {
      rooms,
      async join(room) {
        if (room === failures.joinRoom) throw new Error("Injected join failure");
        rooms.add(room);
      },
      async leave(room) {
        if (room === failLeaveRoom) {
          failLeaveRoom = null;
          throw new Error("Injected leave failure");
        }
        rooms.delete(room);
      },
    };
  };
  const roomCases = [
    { label: "join", failures: { joinRoom: "space:Lounge" } },
    { label: "leave", failures: { leaveRoom: "space:Open World" } },
  ];
  for (const roomCase of roomCases) {
    const socket = roomSocket("space:Open World", roomCase.failures);
    let persistedRoom = "Open World";
    let committedRoom = "Open World";
    let switchError;
    try {
      await changePlayerRoom({
        socket,
        previousRoom: "Open World",
        previousChannel: "space:Open World",
        nextRoom: "Lounge",
        nextChannel: "space:Lounge",
        async persistRoom(room) {
          persistedRoom = room;
        },
      });
      committedRoom = "Lounge";
    } catch (error) {
      switchError = error;
    }
    check(
      `${roomCase.label} failure restores socket and persisted room`,
      switchError?.message === `Injected ${roomCase.label} failure` &&
        persistedRoom === "Open World" &&
        committedRoom === "Open World" &&
        socket.rooms.has("space:Open World") &&
        !socket.rooms.has("space:Lounge")
    );
  }

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
    room: "Open World",
    x: 120,
    y: 160,
  };
  await markPlayerConnected(statusCollection, connectedPlayer);
  await markPlayerConnected(statusCollection, { ...connectedPlayer, x: 140 });
  check(
    "connect upserts an active record with synchronized position and no duplicate",
    sessionRecords.length === 1 &&
      sessionRecords[0].connected === true &&
      sessionRecords[0].room === "Open World" &&
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

  const positionRecord = {
    socketId: "position-session",
    name: "Position Player",
    room: "Open World",
    x: 180,
    y: 240,
    connected: true,
  };
  const positionCollection = createSessionStatusCollection([positionRecord]);
  const positionSave = await savePlayerPosition(
    positionCollection,
    "position-session",
    { ...positionRecord, name: "Updated Player", room: "Lounge", x: 200, y: 260 }
  );
  check(
    "position save persists coordinates, room, status, and timestamp",
    positionSave.matchedCount === 1 &&
      positionRecord.name === "Updated Player" &&
      positionRecord.room === "Lounge" &&
      positionRecord.x === 200 &&
      positionRecord.y === 260 &&
      positionRecord.location[0] === 200 &&
      positionRecord.location[1] === 260 &&
      positionRecord.connected === true &&
      positionRecord.updatedAt instanceof Date &&
      positionCollection.updates[0].filter.connected === true
  );

  const invalidPositionUpdates = positionCollection.updates.length;
  let invalidPositionError;
  try {
    await savePlayerPosition(positionCollection, "position-session", {
      ...positionRecord,
      x: NaN,
    });
  } catch (error) {
    invalidPositionError = error;
  }
  check(
    "invalid coordinates are rejected before issuing a database update",
    invalidPositionError instanceof TypeError &&
      positionCollection.updates.length === invalidPositionUpdates
  );

  let unmatchedPositionError;
  try {
    await savePlayerPosition(
      createSessionStatusCollection([]),
      "missing-session",
      positionRecord
    );
  } catch (error) {
    unmatchedPositionError = error;
  }
  check(
    "a position update that matches no active record is reported as failure",
    unmatchedPositionError?.message === "Active player record not found"
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
  let positionError;
  try {
    await savePlayerPosition(failingCollection, "session-a", connectedPlayer);
  } catch (error) {
    positionError = error;
  }
  check(
    "persistence helpers surface MongoDB errors to their callers",
    connectError?.message === "Injected MongoDB failure" &&
      disconnectError?.message === "Injected MongoDB failure" &&
      positionError?.message === "Injected MongoDB failure"
  );

  const returningRecord = {
    _id: "saved-record",
    socketId: "old-socket",
    name: "Returning Player",
    room: "Lounge",
    x: 180,
    y: 240,
    connected: false,
    avatarPrefs: { color: "coral" },
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
      restored?.room === "Lounge" &&
      restored?.avatarPrefs?.color === "coral" &&
      restored?.location[0] === 180 &&
      restored?.location[1] === 240 &&
      returningRecord.socketId === "new-socket" &&
      returningRecord.connected === true &&
      returningRecord.avatarPrefs.color === "coral" &&
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

  const invalidRoomRecord = {
    ...returningRecord,
    _id: "invalid-room-record",
    socketId: "invalid-room-socket",
    room: "Unknown Room",
    connected: false,
  };
  const invalidRoomRestore = await restoreReturningPlayer(
    createCollection([invalidRoomRecord]),
    "Returning Player",
    "new-socket",
    ({ x, y }) => ({ x, y })
  );
  check(
    "saved records with rooms outside the room catalog are not restored",
    invalidRoomRestore === null &&
      invalidRoomRecord.socketId === "invalid-room-socket" &&
      invalidRoomRecord.connected === false
  );

  const missingRoomRecord = {
    ...returningRecord,
    _id: "missing-room-record",
    socketId: "missing-room-socket",
    room: undefined,
    connected: false,
  };
  const missingRoomRestore = await restoreReturningPlayer(
    createCollection([missingRoomRecord]),
    "Returning Player",
    "new-socket",
    ({ x, y }) => ({ x, y })
  );
  check(
    "saved records without a room are not restored",
    missingRoomRestore === null &&
      missingRoomRecord.socketId === "missing-room-socket" &&
      missingRoomRecord.connected === false
  );

  const lookupFailureCollection = {
    find() {
      throw new Error("Injected lookup failure");
    },
  };
  let lookupError;
  try {
    await restore(lookupFailureCollection, []);
  } catch (caught) {
    lookupError = caught;
  }
  check(
    "lookup failures are surfaced to the caller",
    lookupError?.message === "Injected lookup failure"
  );

  let reads = 0;
  let releaseReads;
  const bothReadsStarted = new Promise((resolve) => {
    releaseReads = resolve;
  });
  const concurrentSavedRecord = {
    ...returningRecord,
    _id: "concurrent-saved",
    socketId: "concurrent-old",
    connected: false,
  };
  const concurrentDocuments = [
    concurrentSavedRecord,
    { ...temporaryRecord, _id: "concurrent-temp-one", socketId: "socket-one" },
    { ...temporaryRecord, _id: "concurrent-temp-two", socketId: "socket-two" },
  ];
  const concurrentCollection = createCollection(concurrentDocuments, {
    findBarrier: async () => {
      reads += 1;
      if (reads === 2) releaseReads();
      await bothReadsStarted;
    },
  });
  const concurrentRestores = await Promise.all([
    restoreReturningPlayer(
      concurrentCollection,
      "Returning Player",
      "socket-one",
      ({ x, y }) => ({ x, y })
    ),
    restoreReturningPlayer(
      concurrentCollection,
      "Returning Player",
      "socket-two",
      ({ x, y }) => ({ x, y })
    ),
  ]);
  check(
    "concurrent reconnects allow exactly one atomic claim",
    concurrentRestores.filter(Boolean).length === 1 &&
      concurrentSavedRecord.connected === true &&
      ["socket-one", "socket-two"].includes(concurrentSavedRecord.socketId)
  );

  // Without a transaction the claim is atomic but the cleanup is best-effort:
  // an update failure must leave the records untouched.
  const updateFailureSaved = {
    ...returningRecord,
    _id: "update-saved",
    socketId: "update-old",
    connected: false,
  };
  const updateFailureDocuments = [
    updateFailureSaved,
    { ...temporaryRecord, _id: "update-temporary" },
  ];
  const updateFailureOriginal = structuredClone(updateFailureDocuments);
  const placeholderPlayer = { name: "", x: 80, y: 80 };
  let restoredState = placeholderPlayer;
  let updateError;
  try {
    await enqueuePersistence("restore-socket", async () => {
      const restoredPlayer = await restore(
        createCollection(updateFailureDocuments, { update: true }),
        updateFailureDocuments
      );
      if (restoredPlayer) restoredState = restoredPlayer;
    });
  } catch (caught) {
    updateError = caught;
  }
  check(
    "restoration claim failure does not commit returning-player state",
    updateError instanceof Error &&
      JSON.stringify(updateFailureDocuments) ===
        JSON.stringify(updateFailureOriginal) &&
      restoredState === placeholderPlayer
  );

  const cleanupFailureSaved = {
    ...returningRecord,
    _id: "cleanup-saved",
    socketId: "cleanup-old",
    connected: false,
  };
  const cleanupFailureDocuments = [
    cleanupFailureSaved,
    { ...temporaryRecord, _id: "cleanup-temporary" },
  ];
  const originalConsoleError = console.error;
  const cleanupLogs = [];
  let cleanupRestore;
  try {
    console.error = (...args) => cleanupLogs.push(args);
    cleanupRestore = await restore(
      createCollection(cleanupFailureDocuments, { delete: true }),
      cleanupFailureDocuments
    );
  } finally {
    console.error = originalConsoleError;
  }
  check(
    "cleanup failure is logged without failing an already claimed restore",
    cleanupRestore?.socketId === "new-socket" &&
      cleanupFailureDocuments[0].connected === true &&
      cleanupFailureDocuments[0].socketId === "new-socket" &&
      cleanupLogs.some(
        ([message, errorMessage]) =>
          message.includes("Failed to remove temporary player record") &&
          errorMessage === "Injected cleanup failure"
      )
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
