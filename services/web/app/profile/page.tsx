'use client';

// React modules
import React, { useState } from 'react';

// Node modules
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

// Material UI components
import { Box, Typography, TextField, Button, Alert, Paper } from '@mui/material';

// Layouts
import DashboardLayout from '@/layouts/dashboard';

// Libraries
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
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

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

  return (
    <DashboardLayout>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Profile
      </Typography>

      <Paper sx={{ p: 3, maxWidth: 500, bgcolor: 'background.paper' }}>
        <Typography variant="detailText" sx={{ mb: 3 }}>
          Username: {session?.user.username}
        </Typography>

        <form onSubmit={handleSubmit(onSubmit)}>
          {success && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {success}
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            fullWidth
            label="Email"
            {...register('email')}
            error={!!errors.email}
            helperText={errors.email?.message}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="New Password"
            type="password"
            {...register('password')}
            error={!!errors.password}
            helperText={errors.password?.message}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Confirm New Password"
            type="password"
            {...register('confirmPassword')}
            error={!!errors.confirmPassword}
            helperText={errors.confirmPassword?.message}
            sx={{ mb: 3 }}
          />
          <Button type="submit" variant="contained" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Update Profile'}
          </Button>
        </form>
      </Paper>
    </DashboardLayout>
  );
};

export default ProfilePage;
