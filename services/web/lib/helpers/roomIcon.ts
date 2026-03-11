/**
 * Deterministic room icon generator.
 *
 * Generates initials and a background color from a room name,
 * similar to how Discord/Slack generate placeholder avatars.
 */

type RoomIconData = {
  initials: string;
  bgColor: string;
};

const getRoomIcon = (roomName: string): RoomIconData => {
  const words = roomName.trim().split(/\s+/);
  const initials = words.length >= 2 ? (words[0][0] + words[1][0]).toUpperCase() : roomName.slice(0, 2).toUpperCase();

  // Deterministic hue from name hash
  let hash = 0;
  for (const ch of roomName) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  const hue = Math.abs(hash) % 360;
  const bgColor = `hsl(${hue}, 45%, 35%)`;

  return { initials, bgColor };
};

export { getRoomIcon };
export type { RoomIconData };
