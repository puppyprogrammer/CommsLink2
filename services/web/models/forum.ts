export type Thread = {
  id: string;
  title: string;
  content: string;
  author_id: string;
  author_username: string;
  created_at: string;
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
