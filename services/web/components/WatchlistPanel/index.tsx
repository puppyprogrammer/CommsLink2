'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { IconButton, Typography, TextField, Button, Chip, Tooltip, CircularProgress } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import DeleteIcon from '@mui/icons-material/Delete';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import RecommendIcon from '@mui/icons-material/Recommend';
import useSession from '@/lib/session/useSession';
import client, { authHeaders } from '@/lib/api/client';
import styles from './WatchlistPanel.module.scss';

type Props = {
  onClose: () => void;
  onCommand: (command: string) => void;
};

type WatchlistItem = {
  id: string;
  video_id: string;
  title: string;
  channel_title?: string;
  thumbnail_url?: string;
  duration?: string;
  status: 'WATCHED' | 'UNWATCHED';
  added_at: string;
};

const WatchlistPanel: React.FC<Props> = ({ onClose, onCommand }) => {
  const { session } = useSession();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [url, setUrl] = useState('');
  const [filter, setFilter] = useState<'all' | 'UNWATCHED' | 'WATCHED'>('all');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const fetchItems = useCallback(async () => {
    if (!session?.token) return;
    try {
      const params = filter !== 'all' ? `?status=${filter}` : '';
      const { data } = await client.get<WatchlistItem[]>(`/watchlist${params}`, {
        headers: authHeaders(session.token),
      });
      setItems(data);
    } catch {
      console.error('[Watchlist] Fetch failed');
    } finally {
      setLoading(false);
    }
  }, [session?.token, filter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const handleAdd = useCallback(() => {
    if (!url.trim()) return;
    setAdding(true);
    onCommand(`/watchlist add ${url.trim()}`);
    setUrl('');
    setTimeout(() => {
      fetchItems();
      setAdding(false);
    }, 2500);
  }, [url, onCommand, fetchItems]);

  const handleToggleStatus = useCallback(
    (item: WatchlistItem) => {
      const cmd = item.status === 'UNWATCHED' ? 'watch' : 'unwatch';
      onCommand(`/watchlist ${cmd} ${item.video_id}`);
      setItems((prev) =>
        prev.map((i) =>
          i.video_id === item.video_id ? { ...i, status: item.status === 'UNWATCHED' ? 'WATCHED' : 'UNWATCHED' } : i,
        ),
      );
    },
    [onCommand],
  );

  const handleRemove = useCallback(
    (item: WatchlistItem) => {
      onCommand(`/watchlist remove ${item.video_id}`);
      setItems((prev) => prev.filter((i) => i.video_id !== item.video_id));
    },
    [onCommand],
  );

  const handleSummarize = useCallback((videoId: string) => onCommand(`/watchlist summarize ${videoId}`), [onCommand]);

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
            disabled={adding}
            sx={{ '& .MuiInputBase-input': { fontSize: '0.8rem' } }}
          />
          <Button size="small" variant="contained" onClick={handleAdd} disabled={!url.trim() || adding}>
            Add
          </Button>
        </div>

        <div className={styles.filters}>
          {(['all', 'UNWATCHED', 'WATCHED'] as const).map((f) => (
            <Chip
              key={f}
              label={f === 'all' ? 'All' : f === 'UNWATCHED' ? 'To Watch' : 'Watched'}
              size="small"
              color={filter === f ? 'primary' : 'default'}
              variant={filter === f ? 'filled' : 'outlined'}
              onClick={() => setFilter(f)}
              sx={{ fontSize: '0.7rem' }}
            />
          ))}
          <Button size="small" variant="text" onClick={fetchItems} sx={{ ml: 'auto', fontSize: '0.7rem' }}>
            Refresh
          </Button>
        </div>

        {loading ? (
          <div className={styles.loading}>
            <CircularProgress size={24} />
          </div>
        ) : items.length === 0 ? (
          <div className={styles.empty}>
            {filter === 'all'
              ? 'Your watchlist is empty. Paste a YouTube URL above to get started.'
              : `No ${filter === 'UNWATCHED' ? 'unwatched' : 'watched'} videos.`}
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className={styles.videoItem}>
              {item.thumbnail_url && (
                <img className={styles.thumbnail} src={item.thumbnail_url} alt={item.title} loading="lazy" />
              )}
              <div className={styles.videoInfo}>
                <div className={styles.videoTitle} title={item.title}>
                  {item.title}
                </div>
                {item.channel_title && <div className={styles.videoChannel}>{item.channel_title}</div>}
                {item.duration && <div className={styles.videoDuration}>{item.duration}</div>}
                <div className={styles.videoActions}>
                  <Tooltip title={item.status === 'UNWATCHED' ? 'Mark watched' : 'Mark unwatched'}>
                    <IconButton size="small" onClick={() => handleToggleStatus(item)}>
                      {item.status === 'WATCHED' ? (
                        <CheckCircleIcon sx={{ fontSize: 16 }} color="success" />
                      ) : (
                        <RadioButtonUncheckedIcon sx={{ fontSize: 16 }} />
                      )}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="AI Summary (costs credits)">
                    <IconButton size="small" onClick={() => handleSummarize(item.video_id)}>
                      <AutoAwesomeIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Remove">
                    <IconButton size="small" onClick={() => handleRemove(item)} color="error">
                      <DeleteIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </div>
              </div>
            </div>
          ))
        )}

        <div className={styles.premiumSection}>
          <div className={styles.premiumLabel}>AI COMMANDS</div>
          <Button
            size="small"
            variant="outlined"
            color="warning"
            startIcon={<RecommendIcon sx={{ fontSize: 16 }} />}
            onClick={handleRecommend}
            disabled={items.length === 0}
            sx={{ fontSize: '0.7rem', mr: 1, mb: 0.5 }}
          >
            Get Recommendations
          </Button>
        </div>
      </div>
    </div>
  );
};

export default WatchlistPanel;
