export type Thread = {
  id: string;
  title: string;
  content: string;
  room_id?: string | null;
  author_id: string;
  author_username: string;
  reply_count?: number;
  view_count?: number;
  created_at: string;
  last_reply_at?: string;
  posts?: Post[];
  _count?: { posts: number };
};

export type Post = {
  id: string;
  content: string;
  thread_id: string;
  author_id: string;
  author_username: string;
  created_at: string;
};
