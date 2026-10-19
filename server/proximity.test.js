
const {
  getDistance,
  getNearbyPlayers,
} = require("./proximity");

const playerA = { id: "A", x: 100, y: 100 };
const playerB = { id: "B", x: 160, y: 120 };
const playerC = { id: "C", x: 250, y: 100 };

console.assert(
  Math.abs(getDistance(playerA, playerB) - 63.25) < 0.01,
  "Distance calculation failed"
);

const nearby = getNearbyPlayers(
  [playerA, playerB, playerC],
  playerA
);

console.assert(
  nearby.length === 1 && nearby[0].id === "B",
  "Nearby-player filtering failed"
);

console.log("Proximity tests completed");
