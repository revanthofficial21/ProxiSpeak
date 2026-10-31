// Presence notifications shown in the People panel.
//
// Mirrors the server's shape and validates everything: it arrives over the wire, so
// it is untrusted. Anything malformed is dropped rather than rendered.

const ROOMS = new Set(["Open World", "Meeting Room", "Lounge"]);
const TYPES = new Set(["player-joined", "player-left", "proximity-enter"]);
const MAX_MESSAGE_LENGTH = 200;

export const MAX_ACTIVITY = 30;

export function normalizeActivity(raw) {
  if (!raw || typeof raw !== "object") return null;

  const { id, type, playerName, room, message, timestamp } = raw;

  if (typeof id !== "string" || !id) return null;
  if (!TYPES.has(type)) return null;
  if (typeof playerName !== "string" || !playerName.trim()) return null;
  if (!ROOMS.has(room)) return null;
  if (
    typeof message !== "string" ||
    !message.trim() ||
    message.length > MAX_MESSAGE_LENGTH
  ) {
    return null;
  }

  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return null;

  return {
    id,
    type,
    playerName: playerName.trim(),
    room,
    message: message.trim(),
    timestamp: new Date(time).toISOString(),
  };
}

// Newest first, de-duplicated by id, capped so the list cannot grow forever.
export function addActivity(list, raw) {
  const item = normalizeActivity(raw);
  if (!item) return list;
  if (list.some((existing) => existing.id === item.id)) return list;

  return [item, ...list]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, MAX_ACTIVITY);
}
