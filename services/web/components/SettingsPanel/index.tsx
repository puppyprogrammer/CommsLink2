'use client';

import React, { useEffect, useState } from 'react';

import {
  Box,
  Typography,
  Slider,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Divider,
  CircularProgress,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

import useSession from '@/lib/session/useSession';
import { usePreferences } from '@/lib/state/PreferencesContext';
import voiceApi from '@/lib/api/voice';

import classes from './SettingsPanel.module.scss';

type PremiumVoice = { voice_id: string; name: string };

type SettingsPanelProps = {
  onClose?: () => void;
};

const SettingsPanel: React.FC<SettingsPanelProps> = ({ onClose }) => {
  const { session } = useSession();
  const { preferences, updatePreference, isSaving } = usePreferences();
  const [premiumVoices, setPremiumVoices] = useState<PremiumVoice[]>([]);
  const [loadingVoices, setLoadingVoices] = useState(false);

  // Fetch AI voices for authenticated users
  useEffect(() => {
    if (!session?.token) {
      setPremiumVoices([]);
      return;
    }

    setLoadingVoices(true);
    voiceApi
      .listVoices(session.token)
      .then((data) => setPremiumVoices(data.voices || []))
      .catch(() => setPremiumVoices([]))
      .finally(() => setLoadingVoices(false));
  }, [session?.token]);


  return (
    <Box className={classes.root}>
      <Box className={classes.header}>
        <Typography variant="h6" color="primary">
          Settings
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
          {isSaving && <CircularProgress size={16} />}
          {onClose && (
            <IconButton size="small" onClick={onClose} title="Close" sx={{ color: '#888' }}>
              <CloseIcon sx={{ fontSize: 18 }} />
            </IconButton>
          )}
        </Box>
      </Box>
      <Divider />

      <Box className={classes.section}>
        <Typography variant="detailText" className={classes.label}>
          Voice Avatar
        </Typography>
        <Select
          size="small"
          fullWidth
          value={preferences.voice_id || ''}
          onChange={(e) => updatePreference('voice_id', e.target.value)}
          displayEmpty
        >
          <MenuItem value="" disabled>Select a voice</MenuItem>
          {loadingVoices ? (
            <MenuItem disabled>
              <CircularProgress size={14} sx={{ mr: 1 }} /> Loading...
            </MenuItem>
          ) : (
            premiumVoices.map((v) => (
              <MenuItem key={v.voice_id} value={v.voice_id}>
                {v.name}
              </MenuItem>
            ))
          )}
        </Select>
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
