'use client';

// React modules
import React, { useState, useEffect, useCallback } from 'react';

// Material UI components
import { IconButton, Typography } from '@mui/material';

// Libraries
import forumApi from '@/lib/api/forum';
import useSession from '@/lib/session/useSession';

// Models
import type { Thread, Post } from '@/models/forum';

// Styles
import classes from './ForumPanel.module.scss';

type ForumPanelProps = {
  roomId: string;
  socket: ReturnType<typeof import('@/lib/socket').getSocket> | null;
  onClose: () => void;
};

const ForumPanel: React.FC<ForumPanelProps> = ({ roomId, socket, onClose }) => {
  const { session } = useSession();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [detailThread, setDetailThread] = useState<Thread | null>(null);

  const loadThreads = useCallback(async () => {
    if (!session?.token) return;
    try {
      const data = await forumApi.getRoomThreads(session.token, roomId);
      setThreads(data);
    } catch {
      // Silently fail if room has no forum
    }
  }, [session?.token, roomId]);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!socket) return;

    const handleNewThread = (data: Thread) => {
      setThreads((prev) => [data, ...prev]);
    };

    const handleNewPost = (data: Post) => {
      if (selectedThread === data.thread_id) {
        setPosts((prev) => [...prev, data]);
      }
      setThreads((prev) =>
        prev.map((t) => (t.id === data.thread_id ? { ...t, reply_count: (t.reply_count ?? 0) + 1 } : t)),
      );
    };

    socket.on('new_forum_thread', handleNewThread);
    socket.on('new_forum_post', handleNewPost);

    return () => {
      socket.off('new_forum_thread', handleNewThread);
      socket.off('new_forum_post', handleNewPost);
    };
  }, [socket, selectedThread]);

  const openThread = async (threadId: string) => {
    if (!session?.token) return;
    setSelectedThread(threadId);
    try {
      const { thread, posts: threadPosts } = await forumApi.getRoomThread(session.token, roomId, threadId);
      setDetailThread(thread);
      setPosts(threadPosts);
    } catch {
      setSelectedThread(null);
    }
  };

  const goBack = () => {
    setSelectedThread(null);
    setDetailThread(null);
    setPosts([]);
    loadThreads();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return (
      d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    );
  };

  return (
    <div className={classes.root}>
      <div className={classes.header}>
        <span className={classes.title}>{selectedThread ? 'Thread' : 'Room Forum'}</span>
        <IconButton size="small" onClick={onClose} title="Close">
          <Typography variant="caption" sx={{ color: '#888' }}>
            ✕
          </Typography>
        </IconButton>
      </div>

      {!selectedThread ? (
        <div className={classes.threadList}>
          {threads.length === 0 ? (
            <div className={classes.empty}>
              No forum threads yet. Enable the Forum command for AI agents to create threads.
            </div>
          ) : (
            threads.map((thread) => (
              <div key={thread.id} className={classes.threadItem} onClick={() => openThread(thread.id)}>
                <div className={classes.threadTitle}>{thread.title}</div>
                <div className={classes.threadMeta}>
                  by {thread.author_username} &middot; {thread.reply_count ?? 0} replies &middot;{' '}
                  {formatDate(thread.created_at)}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className={classes.threadDetail}>
          <div className={classes.backButton} onClick={goBack}>
            &larr; Back to threads
          </div>
          {detailThread && <div className={classes.detailTitle}>{detailThread.title}</div>}
          {posts.length === 0 ? (
            <div className={classes.empty}>No posts yet.</div>
          ) : (
            posts.map((post) => (
              <div key={post.id} className={classes.post}>
                <div className={classes.postAuthor}>{post.author_username}</div>
                <div className={classes.postContent}>{post.content}</div>
                <div className={classes.postDate}>{formatDate(post.created_at)}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default ForumPanel;
