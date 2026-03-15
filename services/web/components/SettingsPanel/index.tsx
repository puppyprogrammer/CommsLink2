'use client';

import React, { useEffect, useState } from 'react';

import {
  Box,
  Typography,
  Slider,
  Select,
  MenuItem,
  ListSubheader,
  FormControlLabel,
  Checkbox,
  Button,
  Divider,
  CircularProgress,
} from '@mui/material';

import useSession from '@/lib/session/useSession';
import { usePreferences } from '@/lib/state/PreferencesContext';
import voiceApi from '@/lib/api/voice';

import classes from './SettingsPanel.module.scss';

const BROWSER_VOICES = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'robot', label: 'Robot' },
];

type ElevenLabsVoice = { voice_id: string; name: string };

const SettingsPanel: React.FC = () => {
  const { session } = useSession();
  const { preferences, updatePreference, isSaving } = usePreferences();
  const [elevenLabsVoices, setElevenLabsVoices] = useState<ElevenLabsVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  // Fetch ElevenLabs voices for authenticated users
  useEffect(() => {
    if (!session?.token) {
      setElevenLabsVoices([]);
      return;
    }

    setLoadingVoices(true);
    voiceApi
      .listVoices(session.token)
      .then((data) => setElevenLabsVoices(data.voices || []))
      .catch(() => setElevenLabsVoices([]))
      .finally(() => setLoadingVoices(false));
  }, [session?.token]);

  const isElevenLabsVoiceSelected = preferences.voice_id && !['male', 'female', 'robot'].includes(preferences.voice_id);

  const handleTestVoice = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    speechSynthesis.cancel();

    const doSpeak = () => {
      const utterance = new SpeechSynthesisUtterance('Hello, this is a test of the voice system.');
      const voices = speechSynthesis.getVoices();
      const voiceId = preferences.voice_id || 'male';

      if (voiceId === 'female') {
        const femaleVoice = voices.find(
          (v) => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('zira'),
        );
        if (femaleVoice) utterance.voice = femaleVoice;
      } else if (voiceId === 'robot') {
        utterance.pitch = 0.1;
        utterance.rate = 0.8;
      }

      utterance.volume = preferences.volume;
      speechSynthesis.speak(utterance);
    };

    const voices = speechSynthesis.getVoices();
    if (voices.length > 0) {
      doSpeak();
    } else {
      speechSynthesis.onvoiceschanged = () => {
        doSpeak();
        speechSynthesis.onvoiceschanged = null;
      };
    }
  };

  return (
    <Box className={classes.root}>
      <Box className={classes.header}>
        <Typography variant="h6" color="primary">
          Settings
        </Typography>
        {isSaving && <CircularProgress size={16} />}
      </Box>
      <Divider />

      <Box className={classes.section}>
        <Typography variant="detailText" className={classes.label}>
          Voice Avatar
        </Typography>
        <Select
          size="small"
          fullWidth
          value={preferences.voice_id || 'male'}
          onChange={(e) => updatePreference('voice_id', e.target.value)}
        >
          <ListSubheader>Browser Voices</ListSubheader>
          {BROWSER_VOICES.map((v) => (
            <MenuItem key={v.value} value={v.value}>
              {v.label}
            </MenuItem>
          ))}
          {elevenLabsVoices.length > 0 && <ListSubheader>ElevenLabs Voices</ListSubheader>}
          {loadingVoices ? (
            <MenuItem disabled>
              <CircularProgress size={14} sx={{ mr: 1 }} /> Loading...
            </MenuItem>
          ) : (
            elevenLabsVoices.map((v) => (
              <MenuItem key={v.voice_id} value={v.voice_id}>
                {v.name}
              </MenuItem>
            ))
          )}
        </Select>
        <Button
          size="small"
          variant="outlined"
          onClick={handleTestVoice}
          sx={{ mt: 1 }}
          disabled={!!isElevenLabsVoiceSelected}
        >
          {isElevenLabsVoiceSelected ? 'ElevenLabs (no browser test)' : 'Test Voice'}
        </Button>
      </Box>

      <Box className={classes.section}>
        <Typography variant="detailText" className={classes.label}>
          Volume
        </Typography>
        <Slider
          size="small"
          min={0}
          max={1}
          step={0.05}
          value={preferences.volume}
          onChange={(_, val) => updatePreference('volume', val as number)}
          valueLabelDisplay="auto"
          valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
        />
      </Box>

      <Divider />

      <Box className={classes.section}>
        <Typography variant="detailText" sx={{ mb: 0.5 }}>Voice Options</Typography>

        <FormControlLabel
          control={
            <Checkbox
              checked={preferences.hear_own_voice}
              onChange={(e) => updatePreference('hear_own_voice', e.target.checked)}
              size="small"
            />
          }
          label={<Typography variant="detailText">Hear My Own Voice</Typography>}
        />
      </Box>
    </Box>
  );
};

export default SettingsPanel;
