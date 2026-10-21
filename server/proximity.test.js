const {
  getDistance,
  getNearbyPlayers,
  DEFAULT_PROXIMITY_RADIUS,
} = require("./proximity");

// Pure-JS proximity oracle: the in-memory logic here mirrors what the
// MongoDB $near query in index.js must return. Kept as a reference so the
// geospatial query can be checked against a known-good implementation.

let failures = 0;

function check(label, condition) {
  if (condition) {
    console.log(`PASS  ${label}`);
  } else {
    console.error(`FAIL  ${label}`);
    failures += 1;
  }
}

const playerA = { id: "A", x: 100, y: 100 };
const playerB = { id: "B", x: 160, y: 120 };
const playerC = { id: "C", x: 250, y: 100 };

check("default radius is 100px", DEFAULT_PROXIMITY_RADIUS === 100);
check(
  "distance A->B is ~63.25",
  Math.abs(getDistance(playerA, playerB) - 63.25) < 0.01
);
check(
  "distance is symmetric",
  getDistance(playerA, playerB) === getDistance(playerB, playerA)
);

const nearby = getNearbyPlayers([playerA, playerB, playerC], playerA);
check("only B is within 100px of A", nearby.length === 1 && nearby[0].id === "B");
check("a neighbour carries its distance", typeof nearby[0].distance === "number");
check(
  "a player is excluded from its own neighbours",
  !nearby.some((player) => player.id === playerA.id)
);

// Boundary: a player exactly on the radius edge is included.
const edge = { id: "E", x: 200, y: 100 }; // exactly 100px from A
check(
  "a player exactly 100px away counts as nearby",
  getNearbyPlayers([playerA, edge], playerA).length === 1
);

console.log(
  failures === 0 ? "All proximity tests passed" : `${failures} test(s) failed`
);
process.exit(failures === 0 ? 0 : 1);
