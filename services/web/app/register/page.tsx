'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { TextField, Button, Alert, Box, Link as MuiLink, Typography, Chip } from '@mui/material';
import Link from 'next/link';
import PromptLayout from '@/layouts/PromptLayout';
import useSession from '@/lib/session/useSession';

const schema = yup.object({
  username: yup.string().required('Choose a username').min(3, 'At least 3 characters'),
  password: yup.string().required('Set a password').min(6, 'At least 6 characters'),
  confirmPassword: yup
    .string()
    .required('Confirm your password')
    .oneOf([yup.ref('password')], 'Passwords must match'),
});

type RegisterForm = yup.InferType<typeof schema>;

const features = [
  { emoji: '🤖', label: 'AI Agents' },
  { emoji: '🎙️', label: 'Voice Chat' },
  { emoji: '💻', label: 'Remote Terminals' },
];

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
    <PromptLayout title="">
      <Typography variant="h5" sx={{
        textAlign: 'center', mb: 0.5, fontWeight: 600,
        color: '#e0e8f0',
      }}>
        Join CommsLink
      </Typography>
      <Typography variant="body2" sx={{
        textAlign: 'center', mb: 2, color: '#6688aa',
      }}>
        Create rooms, deploy AI agents, and build the future.
      </Typography>

      {/* Feature chips */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 0.5, mb: 3 }}>
        {features.map((f) => (
          <Chip
            key={f.label}
            label={`${f.emoji} ${f.label}`}
            size="small"
            sx={{
              background: 'rgba(77,216,208,0.08)',
              border: '1px solid rgba(77,216,208,0.15)',
              color: '#7ab8b4',
              fontSize: '0.7rem',
            }}
          />
        ))}
      </Box>

      <form onSubmit={handleSubmit(onSubmit)}>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          fullWidth
          label="Choose a username"
          placeholder="Your unique identity"
          {...register('username')}
          error={!!errors.username}
          helperText={errors.username?.message}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Password"
          type="password"
          placeholder="6+ characters"
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
        <Button
          fullWidth
          type="submit"
          variant="contained"
          size="large"
          disabled={isSubmitting}
          sx={{
            py: 1.3,
            fontSize: '1rem',
            fontWeight: 'bold',
            background: 'linear-gradient(135deg, #4dd8d0 0%, #3ab8b0 100%)',
            color: '#0a1929',
            boxShadow: '0 0 15px rgba(77,216,208,0.3)',
            '&:hover': {
              background: 'linear-gradient(135deg, #5de8e0 0%, #4ac8c0 100%)',
              boxShadow: '0 0 25px rgba(77,216,208,0.5)',
            },
          }}
        >
          {isSubmitting ? 'Creating account...' : 'Get Started — Free'}
        </Button>

        <Typography variant="caption" sx={{
          display: 'block', textAlign: 'center', mt: 1.5, color: '#556677',
        }}>
          10,000 free credits included • No credit card required
        </Typography>

        <Typography variant="caption" sx={{
          display: 'block', textAlign: 'center', mt: 1, color: '#445566', fontSize: '0.7rem',
        }}>
          By creating an account, you agree to our{' '}
          <MuiLink component={Link} href="/privacy" sx={{ color: '#4dd8d0', fontSize: '0.7rem' }}>
            Privacy Policy
          </MuiLink>
        </Typography>

        <Box sx={{ mt: 2, textAlign: 'center' }}>
          <MuiLink component={Link} href="/login" sx={{ color: '#4dd8d0', fontSize: '0.85rem' }}>
            Already have an account? Sign in
          </MuiLink>
        </Box>
      </form>
    </PromptLayout>
  );
};

export default RegisterPage;
