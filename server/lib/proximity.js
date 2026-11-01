
const DEFAULT_PROXIMITY_RADIUS = 100;

function getDistance(playerA, playerB) {
  const dx = playerA.x - playerB.x;
  const dy = playerA.y - playerB.y;

  return Math.sqrt(dx * dx + dy * dy);
}

function getNearbyPlayers(players, targetPlayer, radius = DEFAULT_PROXIMITY_RADIUS) {
  return players
    .filter((player) => player.id !== targetPlayer.id)
    .map((player) => ({
      ...player,
      distance: Number(getDistance(player, targetPlayer).toFixed(2)),
    }))
    .filter((player) => player.distance <= radius);
}

module.exports = {
  getDistance,
  getNearbyPlayers,
  DEFAULT_PROXIMITY_RADIUS,
};
