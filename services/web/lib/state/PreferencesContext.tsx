'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

import useSession from '@/lib/session/useSession';
import profileApi from '@/lib/api/profile';

export type Preferences = {
  voice_id: string | null;
  volume: number;
  hear_own_voice: boolean;
};

type PreferencesContextValue = {
  preferences: Preferences;
  updatePreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  isSaving: boolean;
};

const defaultPreferences: Preferences = {
  voice_id: 'Joanna',
  volume: 1.0,
  hear_own_voice: false,
};

const PreferencesContext = createContext<PreferencesContextValue>({
  preferences: defaultPreferences,
  updatePreference: () => {},
  isSaving: false,
});

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session } = useSession();
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [isSaving, setIsSaving] = useState(false);
  const initialized = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load preferences — fetch fresh from DB, don't trust stale session cookie
  useEffect(() => {
    if (session?.token && !initialized.current) {
      initialized.current = true;
      // Set from session first as a fast default
      const INVALID_VOICES = ['male', 'female', 'robot', '', null, undefined];
      const sessionVoice = INVALID_VOICES.includes(session.user.voice_id) ? 'Joanna' : session.user.voice_id;
      setPreferences({
        voice_id: sessionVoice,
        volume: session.user.volume ?? 1.0,
        hear_own_voice: session.user.hear_own_voice ?? false,
      });
      // Then fetch fresh from DB to override stale cookie
      fetch('/api/v1/profile/me', { headers: { Authorization: `Bearer ${session.token}` } })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data?.voice_id) {
            const freshVoice = INVALID_VOICES.includes(data.voice_id) ? 'Joanna' : data.voice_id;
            setPreferences((prev) => ({ ...prev, voice_id: freshVoice }));
          }
        })
        .catch(() => {});
    }
  }, [session?.token, session?.user]);

  const saveToBackend = useCallback(
    (updated: Preferences) => {
      if (!session?.token) return;

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          await profileApi.update(session.token, {
            voice_id: updated.voice_id ?? undefined,
            volume: updated.volume,
            hear_own_voice: updated.hear_own_voice,
          });

          // Sync session cookie so preferences survive page refresh
          await fetch('/api/update-preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updated),
          });
        } catch (err) {
          console.error('Failed to save preferences:', err);
        } finally {
          setIsSaving(false);
        }
      }, 500);
    },
    [session?.token],
  );

  const updatePreference = useCallback(
    <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
      setPreferences((prev) => {
        const updated = { ...prev, [key]: value };
        saveToBackend(updated);
        return updated;
      });
    },
    [saveToBackend],
  );

  return (
    <PreferencesContext.Provider value={{ preferences, updatePreference, isSaving }}>
      {children}
    </PreferencesContext.Provider>
  );
};

export const usePreferences = () => useContext(PreferencesContext);

export default PreferencesContext;
