function positionFields(x, y) {
  return {
    x,
    y,
    location: [x, y],
  };
}

function markPlayerConnected(collection, player) {
  return collection.updateOne(
    { socketId: player.socketId },
    {
      $set: {
        socketId: player.socketId,
        name: player.name,
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

async function findRestorablePlayer(collection, name, session) {
  const matches = await collection
    .find({ name }, session ? { session } : undefined)
    .project({ _id: 1, socketId: 1, x: 1, y: 1, connected: 1 })
    .limit(2)
    .toArray();

  if (
    matches.length !== 1 ||
    !matches[0] ||
    matches[0]._id == null ||
    typeof matches[0].socketId !== "string" ||
    matches[0].connected !== false ||
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
  await collection.deleteMany({
    socketId,
    _id: { $ne: savedPlayer._id },
  });

  return {
    ...savedPlayer,
    socketId,
    connected: true,
    ...positionFields(position.x, position.y),
  };
}

module.exports = {
  markPlayerConnected,
  markPlayerDisconnected,
  positionFields,
  restoreReturningPlayer,
};
