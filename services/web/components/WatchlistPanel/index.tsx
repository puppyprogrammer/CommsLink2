'use client';

import React, { useState, useCallback } from 'react';
import {
  IconButton,
  Typography,
  TextField,
  Button,
  Chip,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import DeleteIcon from '@mui/icons-material/Delete';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RecommendIcon from '@mui/icons-material/Recommend';
import styles from './WatchlistPanel.module.scss';

type Props = {
  onClose: () => void;
  onCommand: (command: string) => void;
};

type WatchlistItem = {
  video_id: string;
  title: string;
  channel_title?: string;
  thumbnail_url?: string;
  duration?: string;
  status: 'WATCHED' | 'UNWATCHED';
};

const WatchlistPanel: React.FC<Props> = ({ onClose, onCommand }) => {
  const [url, setUrl] = useState('');
  const [filter, setFilter] = useState<'all' | 'unwatched' | 'watched'>('all');
  const [loading, setLoading] = useState(false);

  const handleAdd = useCallback(() => {
    if (!url.trim()) return;
    onCommand(`/watchlist add ${url.trim()}`);
    setUrl('');
  }, [url, onCommand]);

  const handleRefresh = useCallback(() => {
    const filterArg = filter === 'all' ? '' : ` ${filter}`;
    onCommand(`/watchlist list${filterArg}`);
  }, [filter, onCommand]);

  const handleMarkWatched = useCallback(
    (videoId: string) => onCommand(`/watchlist watch ${videoId}`),
    [onCommand],
  );

  const handleMarkUnwatched = useCallback(
    (videoId: string) => onCommand(`/watchlist unwatch ${videoId}`),
    [onCommand],
  );

  const handleRemove = useCallback(
    (videoId: string) => onCommand(`/watchlist remove ${videoId}`),
    [onCommand],
  );

  const handleSummarize = useCallback(
    (videoId: string) => onCommand(`/watchlist summarize ${videoId}`),
    [onCommand],
  );

  const handleRecommend = useCallback(() => onCommand('/watchlist recommend'), [onCommand]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <PlaylistAddIcon sx={{ fontSize: 20, color: 'primary.main' }} />
          <Typography variant="subtitle2" color="primary">
            YouTube Watchlist
          </Typography>
        </div>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </div>

      <div className={styles.content}>
        {/* Add URL bar */}
        <div className={styles.addBar}>
          <TextField
            size="small"
            placeholder="Paste YouTube URL..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAdd();
            }}
            className={styles.addInput}
            sx={{ '& .MuiInputBase-input': { fontSize: '0.8rem' } }}
          />
          <Button size="small" variant="contained" onClick={handleAdd} disabled={!url.trim()}>
            Add
          </Button>
        </div>

        {/* Filter chips */}
        <div className={styles.filters}>
          {(['all', 'unwatched', 'watched'] as const).map((f) => (
            <Chip
              key={f}
              label={f.charAt(0).toUpperCase() + f.slice(1)}
              size="small"
              color={filter === f ? 'primary' : 'default'}
              variant={filter === f ? 'filled' : 'outlined'}
              onClick={() => setFilter(f)}
              sx={{ fontSize: '0.7rem' }}
            />
          ))}
          <Button size="small" variant="text" onClick={handleRefresh} sx={{ ml: 'auto', fontSize: '0.7rem' }}>
            Refresh List
          </Button>
        </div>

        {/* Info text */}
        <div className={styles.empty}>
          <Typography variant="body2" sx={{ fontSize: '0.8rem', mb: 1 }}>
            Use the commands below or type them in chat:
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 0.5 }}>
            <code>/watchlist add &lt;URL&gt;</code> — Add a video
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 0.5 }}>
            <code>/watchlist list</code> — Show your watchlist
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 0.5 }}>
            <code>/watchlist watch &lt;ID&gt;</code> — Mark as watched
          </Typography>
          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary', mb: 0.5 }}>
            <code>/watchlist remove &lt;ID&gt;</code> — Remove video
          </Typography>
        </div>

        {/* Premium section */}
        <div className={styles.premiumSection}>
          <div className={styles.premiumLabel}>PREMIUM AI COMMANDS</div>
          <Button
            size="small"
            variant="outlined"
            color="warning"
            startIcon={<RecommendIcon sx={{ fontSize: 16 }} />}
            onClick={handleRecommend}
            sx={{ fontSize: '0.7rem', mr: 1, mb: 0.5 }}
          >
            Get Recommendations
          </Button>
          <Typography variant="body2" sx={{ fontSize: '0.7rem', color: 'text.secondary', mt: 0.5 }}>
            Use <code>/watchlist summarize &lt;ID&gt;</code> in chat to AI-summarize a video.
          </Typography>
        </div>
      </div>
    </div>
  );
};

export default WatchlistPanel;
