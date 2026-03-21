export type ChatMessage = {
  id?: string;
  text?: string;
  content?: string;
  sender?: string;
  username?: string;
  room_name?: string;
  timestamp?: string;
  created_at?: string;
  type?: string;
  audio?: string | null;
  voice?: string | null;
  visemes?: Array<{ viseme: string; start: number; end: number }> | null;
  pending?: boolean;
  nonce?: string;
  isSystem?: boolean;
  noVoice?: boolean;
  imageUrl?: string;
  collapsible?: string;
  systemType?: string;
};

export type Room = {
  id: string;
  name: string;
  displayName: string;
  users: number;
  hasPassword: boolean;
  isPublic: boolean;
  createdBy: string | null;
};

export type RosterUser = {
  userId: string;
  username: string;
  socketId: string;
  currentRoom: string;
};
