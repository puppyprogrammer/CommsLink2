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
  pending?: boolean;
  nonce?: string;
  isSystem?: boolean;
  imageUrl?: string;
  collapsible?: string;
  systemType?: string;
};

export type WatchPartyState = {
  videoId: string;
  state: 'playing' | 'paused';
  currentTime: number;
};

export type Room = {
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
