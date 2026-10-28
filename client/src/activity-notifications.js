export const MAX_ACTIVITY_NOTIFICATIONS = 50;

const ROOMS = ["Lounge", "Meeting Room", "Focus Space"];
const ACTIVITY_TYPES = new Set([
  "player-joined",
  "player-left",
  "room-switch",
  "proximity-enter",
]);

export function normalizeActivityNotification(notification) {
  if (
    !notification ||
    typeof notification !== "object" ||
    typeof notification.id !== "string" ||
    !notification.id ||
    !ACTIVITY_TYPES.has(notification.type) ||
    typeof notification.playerName !== "string" ||
    !notification.playerName.trim() ||
    typeof notification.message !== "string" ||
    !notification.message.trim() ||
    notification.message.length > 200 ||
    !ROOMS.includes(notification.room) ||
    typeof notification.timestamp !== "string" ||
    !Number.isFinite(Date.parse(notification.timestamp))
  ) {
    return null;
  }

  if (
    notification.type === "room-switch" &&
    (!ROOMS.includes(notification.fromRoom) ||
      !ROOMS.includes(notification.toRoom))
  ) {
    return null;
  }

  return {
    id: notification.id,
    type: notification.type,
    playerName: notification.playerName.trim(),
    message: notification.message.trim(),
    room: notification.room,
    ...(notification.type === "room-switch"
      ? {
          fromRoom: notification.fromRoom,
          toRoom: notification.toRoom,
        }
      : {}),
    timestamp: new Date(notification.timestamp).toISOString(),
    read: false,
  };
}

export function addActivityNotification(notifications, notification) {
  const normalized = normalizeActivityNotification(notification);
  if (
    !normalized ||
    notifications.some((item) => item.id === normalized.id)
  ) {
    return notifications;
  }

  return [normalized, ...notifications]
    .sort(
      (left, right) =>
        Date.parse(right.timestamp) - Date.parse(left.timestamp)
    )
    .slice(0, MAX_ACTIVITY_NOTIFICATIONS);
}

export function markActivityNotificationsRead(notifications) {
  return notifications.map((notification) =>
    notification.read ? notification : { ...notification, read: true }
  );
}

export function getUnreadActivityCount(notifications) {
  return notifications.reduce(
    (count, notification) => count + (notification.read ? 0 : 1),
    0
  );
}

export function subscribeToActivityNotifications(socket, listener) {
  const handleNotification = (notification) => listener(notification);
  socket.on("activity:notification", handleNotification);
  return () => socket.off("activity:notification", handleNotification);
}
