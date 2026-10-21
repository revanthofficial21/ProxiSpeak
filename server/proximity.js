const PROXIMITY_RADIUS = 100;

function getDistance(player1, player2) {
  const dx = player1.x - player2.x;
  const dy = player1.y - player2.y;

  return Math.sqrt(dx * dx + dy * dy);
}

function getNearbyPlayers(currentPlayer, players) {
  return Array.from(players.values()).filter((player) => {
    if (player.id === currentPlayer.id) {
      return false;
    }

    return getDistance(currentPlayer, player) <= PROXIMITY_RADIUS;
  });
}

module.exports = {
  PROXIMITY_RADIUS,
  getDistance,
  getNearbyPlayers,
};