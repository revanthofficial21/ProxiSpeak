const DEFAULT_PROXIMITY_RADIUS = 100;
const PROXIMITY_RADIUS = DEFAULT_PROXIMITY_RADIUS;

function getDistance(playerA, playerB) {
  return Math.hypot(playerA.x - playerB.x, playerA.y - playerB.y);
}

function getNearbyPlayers(players, targetPlayer, radius = DEFAULT_PROXIMITY_RADIUS) {
  if (!Array.isArray(players)) {
    if (targetPlayer instanceof Map) {
      const currentPlayer = players;
      players = Array.from(targetPlayer.values());
      targetPlayer = currentPlayer;
    } else {
      throw new TypeError("players must be an array or a legacy player map");
    }
  }

  return players
    .filter((player) => player.id !== targetPlayer.id)
    .map((player) => ({
      ...player,
      distance: getDistance(player, targetPlayer),
    }))
    .filter((player) => player.distance <= radius)
    .map((player) => ({
      ...player,
      distance: Number(player.distance.toFixed(2)),
    }));
}

module.exports = {
  getDistance,
  getNearbyPlayers,
  DEFAULT_PROXIMITY_RADIUS,
  PROXIMITY_RADIUS,
};
