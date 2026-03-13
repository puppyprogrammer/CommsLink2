'use client';

// React modules
import React, { useState } from 'react';

// Node modules
import { useRouter, useSearchParams } from 'next/navigation';
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
  username: yup.string().required('Username is required'),
  password: yup.string().required('Password is required'),
});

type LoginForm = yup.InferType<typeof schema>;

const LoginPage = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { mutate } = useSession();
  const [error, setError] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: yupResolver(schema),
  });

  const onSubmit = async (data: LoginForm) => {
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const body = await res.json();
        setError(body.message || 'Login failed');
        return;
      }

      await mutate();
      const returnUrl = searchParams?.get('returnUrl');
      router.push(returnUrl && returnUrl.startsWith('/') ? returnUrl : '/chat');
    } catch {
      setError('Something went wrong');
    }
  };

  return (
    <PromptLayout title="Sign In">
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
          sx={{ mb: 3 }}
        />
        <Button fullWidth type="submit" variant="contained" size="large" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in...' : 'Sign In'}
        </Button>
        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <MuiLink component={Link} href="/register">
            Don&apos;t have an account? Register
          </MuiLink>
        </Box>
      </form>
    </PromptLayout>
  );
};

export default LoginPage;
