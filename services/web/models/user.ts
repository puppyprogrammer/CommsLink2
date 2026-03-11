export type User = {
  id: string;
  username: string;
  email: string | null;
  voice_id: string | null;
  volume: number;
  use_premium_voice: boolean;
  hear_own_voice: boolean;
  is_premium: boolean;
  is_admin: boolean;
  is_banned: boolean;
  created_at: string;
};
