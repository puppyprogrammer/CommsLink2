type SanitizedUser = {
  id: string;
  username: string;
  email: string | null;
  is_premium: boolean;
  is_admin: boolean;
  voice_id: string | null;
  volume: number;
  use_premium_voice: boolean;
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
  use_premium_voice?: boolean;
  hear_own_voice?: boolean;
};

type UpdatePremiumDTO = {
  is_premium: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  premium_expires_at: Date | null;
};

type UserListItem = {
  id: string;
  username: string;
  email: string | null;
  is_premium: boolean;
  is_banned: boolean;
  is_admin: boolean;
  created_at: Date;
};

export type {
  SanitizedUser,
  CreateUserDTO,
  UpdateUserDTO,
  UpdatePremiumDTO,
  UserListItem,
};
