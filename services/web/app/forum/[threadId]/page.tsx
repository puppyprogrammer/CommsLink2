'use client';

// React modules
import React from 'react';

// Node modules
import useSWR from 'swr';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

// Material UI components
import { Box, Typography, Paper, Divider, TextField, Button, IconButton } from '@mui/material';

// Material UI icons
import DeleteIcon from '@mui/icons-material/Delete';

// Layouts
import DashboardLayout from '@/layouts/dashboard';

// Libraries
import useSession from '@/lib/session/useSession';
import forumApi from '@/lib/api/forum';

// Models
import type { Thread } from '@/models/forum';

const postSchema = yup.object({
  content: yup.string().required('Reply cannot be empty'),
});

type PostForm = yup.InferType<typeof postSchema>;

const ThreadPage = () => {
  const params = useParams<{ threadId: string }>();
  const threadId = params?.threadId ?? '';
  const { session } = useSession();
  const { data: thread, mutate } = useSWR<Thread>(threadId ? `forum-thread-${threadId}` : null, () =>
    forumApi.getThread(threadId),
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PostForm>({
    resolver: yupResolver(postSchema),
  });

  const onSubmit = async (data: PostForm) => {
    if (!session?.token) return;
    await forumApi.createPost(session.token, threadId, data);
    reset();
    mutate();
  };

  const handleDeletePost = async (postId: string) => {
    if (!session?.token) return;
    await forumApi.deletePost(session.token, postId);
    mutate();
  };

  if (!thread) return null;

  return (
    <DashboardLayout>
      <Typography variant="h4" sx={{ mb: 1 }}>
        {thread.title}
      </Typography>
      <Typography variant="detailText" sx={{ mb: 3 }}>
        by {thread.author_username} - {new Date(thread.created_at).toLocaleDateString()}
      </Typography>

      <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.paper' }}>
        <Typography>{thread.content}</Typography>
      </Paper>

      <Typography variant="h6" sx={{ mb: 2 }}>
        Replies
      </Typography>

      {thread.posts?.map((post) => (
        <Paper key={post.id} sx={{ p: 2, mb: 1, bgcolor: 'background.paper' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="sm" color="primary">
              {post.author_username} - {new Date(post.created_at).toLocaleDateString()}
            </Typography>
            {(session?.user.id === post.author_id || session?.user.is_admin) && (
              <IconButton size="small" color="error" onClick={() => handleDeletePost(post.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Box>
          <Typography variant="body2">{post.content}</Typography>
        </Paper>
      ))}

      {session && (
        <>
          <Divider sx={{ my: 3 }} />
          <form onSubmit={handleSubmit(onSubmit)}>
            <TextField
              fullWidth
              label="Write a reply..."
              multiline
              rows={3}
              {...register('content')}
              error={!!errors.content}
              helperText={errors.content?.message}
              sx={{ mb: 2 }}
            />
            <Button type="submit" variant="contained" disabled={isSubmitting}>
              Reply
            </Button>
          </form>
        </>
      )}
    </DashboardLayout>
  );
};

export default ThreadPage;
