type SanitizedUser = {
  id: string;
  username: string;
  email: string | null;
  is_admin: boolean;
  voice_id: string | null;
  volume: number;
  hear_own_voice: boolean;
};

type CreateUserDTO = {
  username: string;
  password_hash: string;
};

type UpdateUserDTO = {
  email?: string;
  password_hash?: string;
  voice_id?: string;
  volume?: number;
  hear_own_voice?: boolean;
};

type UserListItem = {
  id: string;
  username: string;
  email: string | null;
  is_banned: boolean;
  is_admin: boolean;
  created_at: Date;
};

export type {
  SanitizedUser,
  CreateUserDTO,
  UpdateUserDTO,
  UserListItem,
};
