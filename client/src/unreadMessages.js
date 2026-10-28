const MAX_SEEN_CHAT_MESSAGE_IDS = 1000;

export function recordUnreadMessage(
  message,
  currentRoomId,
  ownUserId,
  seenMessageIds
) {
  if (
    !message ||
    typeof message.id !== "string" ||
    typeof message.senderId !== "string" ||
    typeof message.roomId !== "string" ||
    seenMessageIds.has(message.id)
  ) {
    return false;
  }

  seenMessageIds.add(message.id);
  if (seenMessageIds.size > MAX_SEEN_CHAT_MESSAGE_IDS) {
    seenMessageIds.delete(seenMessageIds.values().next().value);
  }

  return message.roomId !== currentRoomId && message.senderId !== ownUserId;
}

export function incrementUnreadCount(counts, roomId) {
  return {
    ...counts,
    [roomId]: (counts[roomId] || 0) + 1,
  };
}

export function clearUnreadCount(counts, roomId) {
  if (!counts[roomId]) return counts;

  const updatedCounts = { ...counts };
  delete updatedCounts[roomId];
  return updatedCounts;
}
