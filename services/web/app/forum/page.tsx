'use client';

// React modules
import React, { useState } from 'react';

// Node modules
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

// Material UI components
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
} from '@mui/material';

// Layouts
import DashboardLayout from '@/layouts/dashboard';

// Libraries
import useSession from '@/lib/session/useSession';
import forumApi from '@/lib/api/forum';

// Models
import type { Thread } from '@/models/forum';

const threadSchema = yup.object({
  title: yup.string().required('Title is required'),
  content: yup.string().required('Content is required'),
});

type ThreadForm = yup.InferType<typeof threadSchema>;

const fetcher = () => forumApi.getThreads();

const ForumPage = () => {
  const router = useRouter();
  const { session } = useSession();
  const { data: threads, mutate } = useSWR<Thread[]>('forum-threads', fetcher);
  const [createOpen, setCreateOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ThreadForm>({
    resolver: yupResolver(threadSchema),
  });

  const onSubmit = async (data: ThreadForm) => {
    if (!session?.token) return;
    await forumApi.createThread(session.token, data);
    reset();
    setCreateOpen(false);
    mutate();
  };

  return (
    <DashboardLayout>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h4">Forum</Typography>
        {session && (
          <Button variant="contained" onClick={() => setCreateOpen(true)}>
            New Thread
          </Button>
        )}
      </Box>

      <Paper sx={{ bgcolor: 'background.paper' }}>
        <List>
          {threads?.map((thread) => (
            <ListItem
              key={thread.id}
              divider
              sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
              onClick={() => router.push(`/forum/${thread.id}`)}
            >
              <ListItemText
                primary={thread.title}
                secondary={`by ${thread.author_username} - ${new Date(thread.created_at).toLocaleDateString()}`}
              />
              <Typography variant="detailText">{thread._count?.posts ?? 0} posts</Typography>
            </ListItem>
          ))}
          {threads?.length === 0 && (
            <ListItem>
              <ListItemText primary="No threads yet. Be the first to create one!" />
            </ListItem>
          )}
        </List>
      </Paper>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogTitle>Create Thread</DialogTitle>
          <DialogContent>
            <TextField
              fullWidth
              label="Title"
              {...register('title')}
              error={!!errors.title}
              helperText={errors.title?.message}
              sx={{ mt: 1, mb: 2 }}
            />
            <TextField
              fullWidth
              label="Content"
              multiline
              rows={4}
              {...register('content')}
              error={!!errors.content}
              helperText={errors.content?.message}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={isSubmitting}>
              Create
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </DashboardLayout>
  );
};

export default ForumPage;
