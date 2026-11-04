const { normalizeRoomName } = require("./rooms");

const MEETING_ROOM = "Meeting Room";

function canJoinMeetingCall(player) {
  return Boolean(player && player.room === MEETING_ROOM);
}

function getMeetingCallParticipants(
  participantIds,
  players,
  raisedHands = new Set()
) {
  return Array.from(participantIds)
    .map((id) => players.get(id))
    .filter(Boolean)
    .map((player) => ({
      id: player.id,
      name: player.name || `Player ${player.id.slice(0, 4)}`,
      handRaised: raisedHands.has(player.id),
    }));
}

function canRelayWebRtcSignal(
  fromId,
  toId,
  players,
  proximityState,
  meetingCallParticipants
) {
  if (
    typeof fromId !== "string" ||
    typeof toId !== "string" ||
    fromId === toId
  ) {
    return false;
  }

  const fromPlayer = players.get(fromId);
  const toPlayer = players.get(toId);
  if (
    !fromPlayer ||
    !toPlayer ||
    !normalizeRoomName(fromPlayer.room) ||
    fromPlayer.room !== toPlayer.room
  ) {
    return false;
  }

  const nearbyPeers = proximityState.get(fromId);
  const isNearby = Boolean(nearbyPeers && nearbyPeers.has(toId));
  const isMeetingCallMember =
    fromPlayer.room === MEETING_ROOM &&
    meetingCallParticipants.has(fromId) &&
    meetingCallParticipants.has(toId);

  return isNearby || isMeetingCallMember;
}

function relayWebRtcSignal({
  io,
  event,
  fromId,
  toId,
  payload,
  players,
  proximityState,
  meetingCallParticipants,
}) {
  if (
    !canRelayWebRtcSignal(
      fromId,
      toId,
      players,
      proximityState,
      meetingCallParticipants
    )
  ) {
    return false;
  }

  io.to(toId).emit(event, { from: fromId, ...payload });
  return true;
}

module.exports = {
  MEETING_ROOM,
  canJoinMeetingCall,
  getMeetingCallParticipants,
  canRelayWebRtcSignal,
  relayWebRtcSignal,
};
