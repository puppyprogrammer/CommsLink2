type CreateRoomDTO = {
  name: string;
  display_name: string;
  password_hash: string | null;
  is_permanent: boolean;
  created_by: string | null;
};

type RoomListItem = {
  name: string;
  displayName: string;
  users: number;
  hasPassword: boolean;
  isPublic: boolean;
  createdBy: string | null;
};

type ConnectedUser = {
  userId: string;
  username: string;
  socketId: string;
  currentRoom: string;
};

type WatchPartyState = {
  videoId: string;
  state: 'playing' | 'paused';
  currentTime: number;
  lastUpdated: number;
  startedBy: string;
};

type ActiveRoom = {
  id: string;
  users: Set<string>;
  passwordHash: string | null;
  displayName: string;
  createdBy: string | null;
  watchParty: WatchPartyState | null;
};

export type { CreateRoomDTO, RoomListItem, ConnectedUser, ActiveRoom, WatchPartyState };
