'use client';

// React modules
import { useEffect } from 'react';

// Node modules
import { useRouter } from 'next/navigation';

// Libraries
import useSession from '@/lib/session/useSession';

const HomePage = () => {
  const router = useRouter();
  const { isLoggedIn, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading) {
      router.replace(isLoggedIn ? '/chat' : '/landing');
    }
  }, [isLoading, isLoggedIn, router]);

  return null;
};

export default HomePage;
