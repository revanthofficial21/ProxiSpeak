// Optional Redis mesh: lets Socket.IO fan out across multiple Node instances.
//
// Without REDIS_URL the server runs as a single instance, which is the default and
// perfectly fine for a team. With it, every instance shares rooms and events
// through Redis, so a player connected to instance A can be heard by a player on
// instance B — that is what makes 50+ concurrent users possible.
//
// The adapter is required lazily so a single-instance deployment never touches it.

async function attachMesh(io, redisUrl) {
  if (!redisUrl) return null;

  const { createAdapter } = require("@socket.io/redis-adapter");
  const { createClient } = require("redis");

  const pubClient = createClient({ url: redisUrl });
  const subClient = pubClient.duplicate();

  pubClient.on("error", (error) => {
    console.error("Redis pub client error:", error.message);
  });
  subClient.on("error", (error) => {
    console.error("Redis sub client error:", error.message);
  });

  await Promise.all([pubClient.connect(), subClient.connect()]);
  io.adapter(createAdapter(pubClient, subClient));

  return { pubClient, subClient };
}

async function detachMesh(mesh) {
  if (!mesh) return;
  await Promise.allSettled([
    mesh.pubClient?.quit?.(),
    mesh.subClient?.quit?.(),
  ]);
}

module.exports = { attachMesh, detachMesh };
