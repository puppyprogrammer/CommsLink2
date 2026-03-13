// Libraries
import client, { authHeaders } from './client';

// Models
import type { Thread, Post } from '@/models/forum';

type CreateThreadPayload = {
  title: string;
  content: string;
};

type CreatePostPayload = {
  content: string;
};

const forum = {
  getThreads: async (page = 1, limit = 20) => {
    const { data } = await client.get<Thread[]>('/forum/threads', {
      params: { page, limit },
    });
    return data;
  },

  getThread: async (threadId: string) => {
    const { data } = await client.get<Thread>(`/forum/threads/${threadId}`);
    return data;
  },

  createThread: async (bearerToken: string, payload: CreateThreadPayload) => {
    const { data } = await client.post<Thread>('/forum/threads', payload, {
      headers: authHeaders(bearerToken),
    });
    return data;
  },

  createPost: async (bearerToken: string, threadId: string, payload: CreatePostPayload) => {
    const { data } = await client.post<Post>(`/forum/threads/${threadId}/posts`, payload, {
      headers: authHeaders(bearerToken),
    });
    return data;
  },

  deletePost: async (bearerToken: string, postId: string) => {
    const { data } = await client.delete(`/forum/posts/${postId}`, {
      headers: authHeaders(bearerToken),
    });
    return data;
  },

  getRoomThreads: async (bearerToken: string, roomId: string, page = 1, limit = 20) => {
    const { data } = await client.get<Thread[]>(`/forum/rooms/${roomId}/threads`, {
      headers: authHeaders(bearerToken),
      params: { page, limit },
    });
    return data;
  },

  getRoomThread: async (bearerToken: string, roomId: string, threadId: string) => {
    const { data } = await client.get<{ thread: Thread; posts: Post[] }>(`/forum/rooms/${roomId}/threads/${threadId}`, {
      headers: authHeaders(bearerToken),
    });
    return data;
  },
};

export default forum;
