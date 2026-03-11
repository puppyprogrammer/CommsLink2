'use client';

// Node modules
import useSWR from 'swr';

// Models
import type { SessionData } from './config';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type SessionResponse = {
  isLoggedIn: boolean;
  auth?: SessionData;
};

const useSession = () => {
  const { data, error, mutate } = useSWR<SessionResponse>('/api/session', fetcher);

  return {
    session: data?.auth,
    isLoggedIn: data?.isLoggedIn ?? false,
    isLoading: !data && !error,
    error,
    mutate,
  };
};

export default useSession;
