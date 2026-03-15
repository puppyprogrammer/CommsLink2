export type User = {
  id: string;
  username: string;
  email: string | null;
  voice_id: string | null;
  volume: number;
  hear_own_voice: boolean;
  is_admin: boolean;
  is_banned: boolean;
  created_at: string;
};
