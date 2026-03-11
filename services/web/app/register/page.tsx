'use client';

// React modules
import React, { useState } from 'react';

// Node modules
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';

// Material UI components
import { TextField, Button, Alert, Box, Link as MuiLink } from '@mui/material';

// Node modules
import Link from 'next/link';

// Layouts
import PromptLayout from '@/layouts/PromptLayout';

// Libraries
import useSession from '@/lib/session/useSession';

const schema = yup.object({
  username: yup.string().required('Username is required').min(3, 'At least 3 characters'),
  password: yup.string().required('Password is required').min(6, 'At least 6 characters'),
  confirmPassword: yup
    .string()
    .required('Confirm your password')
    .oneOf([yup.ref('password')], 'Passwords must match'),
});

type RegisterForm = yup.InferType<typeof schema>;

const RegisterPage = () => {
  const router = useRouter();
  const { mutate } = useSession();
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: yupResolver(schema),
  });

  const onSubmit = async (data: RegisterForm) => {
    setError('');
    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: data.username, password: data.password }),
      });

      if (!res.ok) {
        const body = await res.json();
        setError(body.message || 'Registration failed');
        return;
      }

      await mutate();
      router.push('/chat');
    } catch {
      setError('Something went wrong');
    }
  };

  return (
    <PromptLayout title="Create Account">
      <form onSubmit={handleSubmit(onSubmit)}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          fullWidth
          label="Username"
          {...register('username')}
          error={!!errors.username}
          helperText={errors.username?.message}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Password"
          type="password"
          {...register('password')}
          error={!!errors.password}
          helperText={errors.password?.message}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Confirm Password"
          type="password"
          {...register('confirmPassword')}
          error={!!errors.confirmPassword}
          helperText={errors.confirmPassword?.message}
          sx={{ mb: 3 }}
        />
        <Button fullWidth type="submit" variant="contained" size="large" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account...' : 'Register'}
        </Button>
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <MuiLink component={Link} href="/login">
            Already have an account? Sign in
          </MuiLink>
        </Box>
      </form>
    </PromptLayout>
  );
};

export default RegisterPage;
