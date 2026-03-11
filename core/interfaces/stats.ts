type DashboardData = {
  users: import('./user').UserListItem[];
  stats: DailyStat[];
};

type DailyStat = {
  date: string;
  visits: number;
  messages_sent: number;
};

export type { DashboardData, DailyStat };
