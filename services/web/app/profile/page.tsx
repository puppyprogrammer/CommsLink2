'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Box, Typography, TextField, Button, Alert, Paper, Divider } from '@mui/material';
import DashboardLayout from '@/layouts/dashboard';
import useSession from '@/lib/session/useSession';
import profileApi from '@/lib/api/profile';

const profileSchema = yup.object({
  email: yup.string().email('Invalid email').optional(),
  password: yup.string().optional().min(6, 'At least 6 characters'),
  confirmPassword: yup
    .string()
    .optional()
    .oneOf([yup.ref('password')], 'Passwords must match'),
});

type ProfileForm = yup.InferType<typeof profileSchema>;

const ProfilePage = () => {
  const { session } = useSession();
  const router = useRouter();
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProfileForm>({
    resolver: yupResolver(profileSchema),
    defaultValues: {
      email: session?.user.email || '',
    },
  });

  const onSubmit = async (data: ProfileForm) => {
    if (!session?.token) return;
    setSuccess('');
    setError('');

    try {
      const payload: Record<string, string> = {};
      if (data.email) payload.email = data.email;
      if (data.password) payload.password = data.password;

      await profileApi.update(session.token, payload);
      setSuccess('Profile updated successfully');
    } catch {
      setError('Failed to update profile');
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== 'DELETE' || !session?.token) return;
    setDeleteError('');
    setDeleting(true);

    try {
      const res = await fetch('/api/v1/profile/delete-account', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({ confirmation: 'DELETE' }),
      });

      if (!res.ok) {
        const body = await res.json();
        setDeleteError(body.message || 'Failed to delete account');
        setDeleting(false);
        return;
      }

      // Log out and redirect
      await fetch('/api/logout', { method: 'POST' });
      router.push('/login');
    } catch {
      setDeleteError('Something went wrong');
      setDeleting(false);
    }
  };

  return (
    <DashboardLayout>
      <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 500 }}>
        <Typography variant="h5" sx={{ mb: 2, color: '#4dd8d0' }}>
          Profile
        </Typography>

        <Paper sx={{ p: 2.5, bgcolor: 'background.paper', mb: 3 }}>
          <Typography variant="body2" sx={{ mb: 2, color: '#8ba4bd' }}>
            Username: <strong>{session?.user.username}</strong>
          </Typography>

          <form onSubmit={handleSubmit(onSubmit)}>
            {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            <TextField
              fullWidth size="small"
              label="Email"
              {...register('email')}
              error={!!errors.email}
              helperText={errors.email?.message}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth size="small"
              label="New Password"
              type="password"
              {...register('password')}
              error={!!errors.password}
              helperText={errors.password?.message}
              sx={{ mb: 2 }}
            />
            <TextField
              fullWidth size="small"
              label="Confirm New Password"
              type="password"
              {...register('confirmPassword')}
              error={!!errors.confirmPassword}
              helperText={errors.confirmPassword?.message}
              sx={{ mb: 2 }}
            />
            <Button type="submit" variant="contained" size="small" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Update Profile'}
            </Button>
          </form>
        </Paper>

        <Divider sx={{ mb: 3, borderColor: 'rgba(244,71,71,0.2)' }} />

        <Paper sx={{ p: 2.5, bgcolor: 'rgba(244,71,71,0.03)', border: '1px solid rgba(244,71,71,0.15)' }}>
          <Typography variant="h6" sx={{ fontSize: '0.95rem', color: '#f44', mb: 1 }}>
            Delete Account
          </Typography>
          <Typography variant="body2" sx={{ color: '#8ba4bd', mb: 2, fontSize: '0.8rem', lineHeight: 1.6 }}>
            This will permanently delete your account and all associated data including messages,
            rooms you created, AI agents, credit history, and connected machines.
            This action cannot be undone.
          </Typography>

          {deleteError && <Alert severity="error" sx={{ mb: 2 }}>{deleteError}</Alert>}

          <TextField
            fullWidth size="small"
            placeholder='Type "DELETE" to confirm'
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            sx={{ mb: 2 }}
          />
          <Button
            variant="contained"
            color="error"
            size="small"
            disabled={deleteConfirm !== 'DELETE' || deleting}
            onClick={handleDeleteAccount}
          >
            {deleting ? 'Deleting...' : 'Permanently Delete My Account'}
          </Button>
        </Paper>
      </Box>
    </DashboardLayout>
  );
};

export default ProfilePage;
