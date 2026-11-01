const { normalizeRoomName } = require("./rooms");

function createPlayerPersistenceQueue() {
  const queues = new Map();

  return function enqueue(socketId, operation) {
    if (typeof socketId !== "string" || !socketId) {
      throw new TypeError("A socket ID is required for queued persistence");
    }

    const previous = queues.get(socketId) || Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    queues.set(socketId, tail);
    tail.then(() => {
      if (queues.get(socketId) === tail) queues.delete(socketId);
    });

    return result;
  };
}

function positionFields(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new TypeError("Player coordinates must be finite numbers");
  }

  return {
    x,
    y,
    location: [x, y],
  };
}

function markPlayerConnected(collection, player) {
  if (
    !player ||
    typeof player.socketId !== "string" ||
    !player.socketId ||
    typeof player.name !== "string" ||
    typeof player.room !== "string" ||
    !player.room.trim()
  ) {
    throw new TypeError("Invalid player record");
  }

  return collection.updateOne(
    { socketId: player.socketId },
    {
      $set: {
        socketId: player.socketId,
        name: player.name,
        room: player.room,
        ...positionFields(player.x, player.y),
        connected: true,
        updatedAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );
}

async function savePlayerPosition(collection, socketId, player) {
  if (
    typeof socketId !== "string" ||
    !socketId ||
    !player ||
    typeof player.name !== "string" ||
    typeof player.room !== "string" ||
    !player.room.trim()
  ) {
    throw new TypeError("Invalid player position record");
  }

  const coordinates = positionFields(player.x, player.y);
  const result = await collection.updateOne(
    { socketId, connected: true },
    {
      $set: {
        name: player.name,
        room: player.room,
        ...coordinates,
        connected: true,
        updatedAt: new Date(),
      },
    }
  );

  if (result.matchedCount !== 1) {
    throw new Error("Active player record not found");
  }

  return result;
}

function markPlayerDisconnected(collection, socketId) {
  return collection.updateOne(
    { socketId, connected: true },
    {
      $set: {
        connected: false,
        updatedAt: new Date(),
      },
    }
  );
}

async function changePlayerRoom({
  socket,
  previousRoom,
  previousChannel,
  nextRoom,
  nextChannel,
  persistRoom,
}) {
  await persistRoom(nextRoom);

  try {
    await socket.join(nextChannel);
    await socket.leave(previousChannel);
  } catch (error) {
    try {
      await socket.join(previousChannel);
    } catch (rollbackError) {
      console.error(
        "Failed to restore previous player room membership:",
        rollbackError.message
      );
    }

    try {
      await socket.leave(nextChannel);
    } catch (rollbackError) {
      console.error(
        "Failed to remove failed player room membership:",
        rollbackError.message
      );
    }

    try {
      await persistRoom(previousRoom);
    } catch (rollbackError) {
      console.error(
        "Failed to restore previous player room in MongoDB:",
        rollbackError.message
      );
    }

    throw error;
  }
}

async function findRestorablePlayer(collection, name, session) {
  const matches = await collection
    .find({ name }, session ? { session } : undefined)
    .project({
      _id: 1,
      socketId: 1,
      x: 1,
      y: 1,
      room: 1,
      connected: 1,
      avatarPrefs: 1,
    })
    .limit(2)
    .toArray();

  if (
    matches.length !== 1 ||
    !matches[0] ||
    matches[0]._id == null ||
    typeof matches[0].socketId !== "string" ||
    matches[0].connected !== false ||
    !normalizeRoomName(matches[0].room) ||
    !Number.isFinite(matches[0].x) ||
    !Number.isFinite(matches[0].y)
  ) {
    return null;
  }

  return matches[0];
}

async function restoreReturningPlayer(
  collection,
  name,
  socketId,
  normalizePosition
) {
  const savedPlayer = await findRestorablePlayer(collection, name);
  if (!savedPlayer) return null;

  const position = normalizePosition(savedPlayer);
  if (
    !position ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    return null;
  }

  // Claim the saved record with a single-document update. One update is atomic
  // on its own, so no transaction — and therefore no replica set — is needed.
  // The filter guarantees we only claim the record while it is still the
  // inactive one we just read, so two sockets racing for the same name cannot
  // both win.
  const claimResult = await collection.updateOne(
    {
      _id: savedPlayer._id,
      socketId: savedPlayer.socketId,
      name,
      connected: false,
    },
    {
      $set: {
        socketId,
        connected: true,
        ...positionFields(position.x, position.y),
        updatedAt: new Date(),
      },
    }
  );

  if (claimResult.matchedCount !== 1) return null;

  // Best-effort: drop the temporary record the connect-time upsert created for
  // this socket. Without a transaction this is not all-or-nothing, but the
  // claim above is the part that must be atomic.
  try {
    await collection.deleteMany({
      socketId,
      _id: { $ne: savedPlayer._id },
    });
  } catch (error) {
    console.error(
      "Failed to remove temporary player record after restoration:",
      error.message
    );
  }

  return {
    ...savedPlayer,
    socketId,
    connected: true,
    ...positionFields(position.x, position.y),
  };
}

module.exports = {
  changePlayerRoom,
  createPlayerPersistenceQueue,
  markPlayerConnected,
  markPlayerDisconnected,
  positionFields,
  restoreReturningPlayer,
  savePlayerPosition,
};
