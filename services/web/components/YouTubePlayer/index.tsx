'use client';

import React, { useEffect, useRef, useCallback } from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

type Props = {
  videoId: string;
  state: 'playing' | 'paused';
  currentTime: number;
  onPlay: (currentTime: number) => void;
  onPause: (currentTime: number) => void;
  onEnd: () => void;
};

// Load the YouTube IFrame API script once
let apiLoaded = false;
let apiReady = false;
const apiCallbacks: (() => void)[] = [];

const loadYTApi = (cb: () => void) => {
  if (apiReady) {
    cb();
    return;
  }
  apiCallbacks.push(cb);
  if (apiLoaded) return;
  apiLoaded = true;

  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);

  (window as unknown as Record<string, unknown>).onYouTubeIframeAPIReady = () => {
    apiReady = true;
    apiCallbacks.forEach((fn) => fn());
    apiCallbacks.length = 0;
  };
};

const YouTubePlayer: React.FC<Props> = ({ videoId, state, currentTime, onPlay, onPause, onEnd }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YT.Player | null>(null);
  const isRemoteUpdate = useRef(false);
  const lastVideoId = useRef(videoId);

  const onStateChange = useCallback(
    (event: YT.OnStateChangeEvent) => {
      if (isRemoteUpdate.current) return;

      const player = playerRef.current;
      if (!player) return;
      const time = player.getCurrentTime();

      if (event.data === YT.PlayerState.PLAYING) {
        onPlay(time);
      } else if (event.data === YT.PlayerState.PAUSED) {
        onPause(time);
      }
    },
    [onPlay, onPause],
  );

  // Initialize player
  useEffect(() => {
    loadYTApi(() => {
      if (!containerRef.current) return;

      playerRef.current = new YT.Player(containerRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          start: Math.floor(currentTime),
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onStateChange,
        },
      });
    });

    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle video change
  useEffect(() => {
    if (videoId !== lastVideoId.current && playerRef.current) {
      lastVideoId.current = videoId;
      isRemoteUpdate.current = true;
      playerRef.current.loadVideoById(videoId, 0);
      setTimeout(() => {
        isRemoteUpdate.current = false;
      }, 500);
    }
  }, [videoId]);

  // Sync playback state from server
  useEffect(() => {
    const player = playerRef.current;
    if (!player || typeof player.getPlayerState !== 'function') return;

    isRemoteUpdate.current = true;

    const playerState = player.getPlayerState();
    const playerTime = player.getCurrentTime();
    const timeDiff = Math.abs(playerTime - currentTime);

    // Only seek if drift > 2 seconds
    if (timeDiff > 2) {
      player.seekTo(currentTime, true);
    }

    if (state === 'playing' && playerState !== YT.PlayerState.PLAYING) {
      player.playVideo();
    } else if (state === 'paused' && playerState !== YT.PlayerState.PAUSED) {
      player.pauseVideo();
    }

    setTimeout(() => {
      isRemoteUpdate.current = false;
    }, 500);
  }, [state, currentTime]);

  return (
    <Box sx={{ position: 'relative', borderBottom: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1, py: 0.5 }}>
        <Typography variant="detailText">Watch Party</Typography>
        <IconButton size="small" onClick={onEnd} title="End Watch Party" sx={{ color: '#858585' }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
      <Box sx={{ width: '100%', aspectRatio: '16/9', maxHeight: '40vh' }}>
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      </Box>
    </Box>
  );
};

export default YouTubePlayer;
