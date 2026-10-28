export function updateTypingUsers(
  currentTypingUsers,
  notification,
  currentRoomId,
  ownUserId
) {
  if (
    !notification ||
    typeof notification.playerId !== "string" ||
    typeof notification.roomId !== "string" ||
    notification.roomId !== currentRoomId ||
    notification.playerId === ownUserId
  ) {
    return currentTypingUsers;
  }

  if (notification.isTyping === false) {
    if (!currentTypingUsers[notification.playerId]) return currentTypingUsers;
    const nextTypingUsers = { ...currentTypingUsers };
    delete nextTypingUsers[notification.playerId];
    return nextTypingUsers;
  }

  if (
    notification.isTyping !== true ||
    typeof notification.displayName !== "string"
  ) {
    return currentTypingUsers;
  }

  return {
    ...currentTypingUsers,
    [notification.playerId]: notification.displayName,
  };
}

export function formatTypingIndicator(typingUsers) {
  const names = Object.values(typingUsers);
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.slice(0, -1).join(", ")}, and ${
    names.at(-1)
  } are typing…`;
}
