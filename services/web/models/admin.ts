export type DashboardStats = {
  totalUsers: number;
  totalMessages: number;
  totalRooms: number;
  recentStats: Array<{
    date: string;
    visits: number;
    messages: number;
    new_users: number;
  }>;
  users: Array<{
    id: string;
    username: string;
    is_banned: boolean;
    created_at: string;
  }>;
};
