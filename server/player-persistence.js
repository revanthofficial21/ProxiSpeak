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
  session,
  normalizePosition
) {
  const candidate = await findRestorablePlayer(collection, name);
  if (!candidate) return null;

  let restoredPlayer = null;

  await session.withTransaction(async () => {
    restoredPlayer = null;
    const savedPlayer = await findRestorablePlayer(collection, name, session);
    if (!savedPlayer || savedPlayer._id.toString() !== candidate._id.toString()) {
      return;
    }
    const position = normalizePosition(savedPlayer);
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
      },
      { session }
    );

    if (claimResult.matchedCount !== 1) return;

    const temporaryRecords = await collection
      .find(
        {
          socketId,
          _id: { $ne: savedPlayer._id },
        },
        { session }
      )
      .project({ _id: 1 })
      .toArray();
    const cleanupResult = await collection.deleteMany(
      { socketId, _id: { $ne: savedPlayer._id } },
      { session }
    );
    if (cleanupResult.deletedCount !== temporaryRecords.length) {
      throw new Error("Failed to clean up temporary player records");
    }

    restoredPlayer = {
      ...savedPlayer,
      socketId,
      connected: true,
      ...positionFields(position.x, position.y),
    };
  });

  return restoredPlayer;
}

module.exports = {
  markPlayerConnected,
  markPlayerDisconnected,
  positionFields,
  restoreReturningPlayer,
};
