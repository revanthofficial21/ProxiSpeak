// The mesh: bounded peer connections, and a graceful single-instance fallback.
const { nearestPeers } = require("../lib/session");
const { attachMesh, detachMesh } = require("../lib/mesh");

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`ok   - ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL - ${label}`);
  }
}

async function main() {
  const peers = [
    { id: "far", distance: 90 },
    { id: "near", distance: 10 },
    { id: "mid", distance: 45 },
  ];

  check(
    "peers are sorted nearest first",
    nearestPeers(peers, 3).map((p) => p.id).join(",") === "near,mid,far"
  );

  check(
    "the mesh is capped at the limit",
    nearestPeers(peers, 2).map((p) => p.id).join(",") === "near,mid"
  );

  check(
    "the input array is not mutated",
    peers.map((p) => p.id).join(",") === "far,near,mid"
  );

  check(
    "peers without a distance sort last",
    nearestPeers(
      [{ id: "unknown" }, { id: "known", distance: 50 }],
      2
    )
      .map((p) => p.id)
      .join(",") === "known,unknown"
  );

  check(
    "a zero limit returns everything, sorted",
    nearestPeers(peers, 0).length === 3
  );

  check("a non-array is handled", nearestPeers(null, 5).length === 0);
  check("an empty list is handled", nearestPeers([], 5).length === 0);

  check(
    "an unbounded limit keeps every peer",
    nearestPeers(peers, Infinity).length === 3
  );

  // Graceful fallback: no REDIS_URL means single instance, and nothing is touched.
  let adapterCalls = 0;
  const fakeIo = {
    adapter() {
      adapterCalls += 1;
    },
  };

  check(
    "no REDIS_URL leaves the mesh unattached",
    (await attachMesh(fakeIo, "")) === null && adapterCalls === 0
  );
  check(
    "an undefined REDIS_URL is also a no-op",
    (await attachMesh(fakeIo, undefined)) === null && adapterCalls === 0
  );
  check("detaching nothing is safe", (await detachMesh(null)) === undefined);

  console.log(
    failures === 0 ? "All mesh tests passed" : `${failures} mesh test(s) failed`
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error("FAIL - mesh tests threw:", error);
  process.exitCode = 1;
});
