'use client';

// React modules
import React, { useState, useEffect, useRef, useCallback } from 'react';

// Material UI components
import {
  Box,
  TextField,
  IconButton,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Tooltip,
} from '@mui/material';

// Material UI icons
import SendIcon from '@mui/icons-material/Send';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import TuneIcon from '@mui/icons-material/Tune';
import LockIcon from '@mui/icons-material/Lock';
import Alert from '@mui/material/Alert';

// Layouts
import DashboardLayout from '@/layouts/dashboard';

// Libraries
import axios from 'axios';
import config from '@/settings/config.json';
import useSession from '@/lib/session/useSession';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { usePreferences } from '@/lib/state/PreferencesContext';
import { speak, playAudioBlob, stop as stopTTS, onPlayStateChange } from '@/lib/helpers/tts';
import * as speechRecognition from '@/lib/helpers/speechRecognition';
import * as voiceStream from '@/lib/helpers/voiceStream';
import * as audioQueue from '@/lib/helpers/audioQueue';
import { startAlarm, stopAlarm } from '@/lib/helpers/alarm';
import { getRoomIcon } from '@/lib/helpers/roomIcon';
import voiceApi from '@/lib/api/voice';
import { useToast } from '@/lib/state/ToastContext';

// Components
import SettingsPanel from '@/components/SettingsPanel';
import RoomSettings from '@/components/RoomSettings';
import YouTubePlayer from '@/components/YouTubePlayer';
import ScreenSharePlayer from '@/components/ScreenSharePlayer';
import ChatInput from '@/components/ChatInput';
import MessageContent from '@/components/MessageContent';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import LanguageIcon from '@mui/icons-material/Language';

import WebBrowserPanel from '@/components/WebBrowserPanel';
import type { WebPanelData } from '@/components/WebBrowserPanel';
import TerminalPanel from '@/components/TerminalPanel';
import WatchlistPanel from '@/components/WatchlistPanel';
import TerminalIcon from '@mui/icons-material/Terminal';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';

// Models
import type { ChatMessage, Room, WatchPartyState } from '@/models/chat';

// Styles
import classes from './Chat.module.scss';

const ChatPage = () => {
  const { session } = useSession();
  const { preferences, updatePreference } = usePreferences();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<string>('public');
  const [currentRoomDisplay, setCurrentRoomDisplay] = useState<string>('Public');
  const [input, setInput] = useState(''); // kept for speech recognition
  const [isListening, setIsListening] = useState(false);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [pendingRoom, setPendingRoom] = useState<string>('');
  const [roomPassword, setRoomPassword] = useState('');
  const [roomError, setRoomError] = useState('');
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const [roomSettingsTarget, setRoomSettingsTarget] = useState<string>('');
  const [watchParty, setWatchParty] = useState<WatchPartyState | null>(null);
  const [screenShare, setScreenShare] = useState<{ sharerId: string; sharerUsername: string } | null>(null);
  const [isScreenSharer, setIsScreenSharer] = useState(false);
  const [webPanelOpen, setWebPanelOpen] = useState(false);
  const [webPanelData, setWebPanelData] = useState<WebPanelData | null>(null);
  const [terminalPanelOpen, setTerminalPanelOpen] = useState(false);
  const [watchlistPanelOpen, setWatchlistPanelOpen] = useState(false);
  const [panelMachines, setPanelMachines] = useState<{ id: string; name: string; status: string; os?: string }[]>([]);
  const socketInstanceRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const [typingAgents, setTypingAgents] = useState<string[]>([]);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [alarmActive, setAlarmActive] = useState<{ message: string; agentName: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const preferencesRef = useRef(preferences);

  // Keep preferences ref in sync for use in socket callbacks
  useEffect(() => {
    preferencesRef.current = preferences;
    audioQueue.setVolume(preferences.volume);
  }, [preferences]);

  // Track TTS audio playing state
  useEffect(() => {
    onPlayStateChange((playing) => setAudioPlaying(playing));
    return () => onPlayStateChange(() => {});
  }, []);

  const dismissAlarm = useCallback(() => {
    stopAlarm();
    setAlarmActive(null);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Handle TTS for incoming messages
  const handleIncomingTTS = useCallback(
    (msg: ChatMessage) => {
      // Skip TTS for system messages
      if (msg.isSystem) return;

      const prefs = preferencesRef.current;
      const sender = msg.sender || msg.username || '';
      const isOwnMessage = sender === session?.user.username;

      // Skip TTS for own messages unless "hear own voice" is enabled
      if (isOwnMessage && !prefs.hear_own_voice) return;

      // If message has base64 audio (premium TTS from server), play that
      if (msg.audio) {
        playAudioBlob(msg.audio, prefs.volume);
        return;
      }

      const text = msg.text || msg.content || '';
      if (!text) return;

      // Use the message's voice field (for AI agents) or the user's own preference
      const voiceId = msg.voice || prefs.voice_id || 'male';
      const browserVoices = ['male', 'female', 'robot'];
      const avatar = browserVoices.includes(voiceId) ? (voiceId as 'male' | 'female' | 'robot') : 'male';

      speak(text, { voiceAvatar: avatar, volume: prefs.volume });
    },
    [session?.user.username],
  );

  useEffect(() => {
    if (!session?.token) return;

    const socket = getSocket(session.token);
    socketInstanceRef.current = socket;

    socket.on('connect_error', (err: Error) => {
      toast(err.message === 'Authentication error' ? 'Session expired — please log in again' : err.message);
      if (err.message === 'Authentication error' || err.message === 'Account banned') {
        disconnectSocket();
        window.location.href = '/login';
      }
    });

    socket.on('chat_message', (msg: ChatMessage) => {
      // Clear typing indicator for this sender
      const sender = msg.sender || msg.username || '';
      if (sender) {
        setTypingAgents((prev) => prev.filter((name) => name !== sender));
      }

      setMessages((prev) => {
        // If this message has a nonce, replace the pending optimistic message
        if (msg.nonce) {
          const idx = prev.findIndex((m) => m.nonce === msg.nonce && m.pending);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = msg;
            return updated;
          }
        }
        return [...prev, msg];
      });
      handleIncomingTTS(msg);
    });

    socket.on('room_list_update', (data: { rooms: Room[] } | Room[]) => {
      const roomList = Array.isArray(data) ? data : data.rooms;
      if (Array.isArray(roomList)) setRooms(roomList);
    });

    socket.on(
      'room_joined',
      (data: {
        roomName: string;
        users: { userId: string; username: string }[];
        messages?: ChatMessage[];
        watchParty?: WatchPartyState | null;
      }) => {
        setCurrentRoomDisplay(data.roomName);
        setCurrentRoom(data.roomName.toLowerCase());
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setWatchParty(data.watchParty || null);
        setScreenShare(null);
        setIsScreenSharer(false);
        setPasswordDialogOpen(false);
        setRoomPassword('');
        setRoomError('');
        stopTTS();
      },
    );

    socket.on('room_join_error', (data: { error: string }) => {
      if (data.error === 'Password required for this room') {
        // Open password dialog — pendingRoom is already set by handleSwitchRoom
        setPasswordDialogOpen(true);
        return;
      }
      setRoomError(data.error);
      toast(data.error);
    });

    socket.on('agent_error', (data: { error: string }) => {
      toast(data.error);
    });

    socket.on('watch_party_start', (data: { videoId: string }) => {
      setWatchParty({ videoId: data.videoId, state: 'playing', currentTime: 0 });
    });

    socket.on('watch_party_sync', (data: WatchPartyState) => {
      setWatchParty(data);
    });

    socket.on('watch_party_end', () => {
      setWatchParty(null);
    });

    socket.on('screen_share_start', (data: { sharerId: string; sharerUsername: string }) => {
      setScreenShare({ sharerId: data.sharerId, sharerUsername: data.sharerUsername });
      setIsScreenSharer(false);
    });

    socket.on('screen_share_stop', () => {
      setScreenShare(null);
      setIsScreenSharer(false);
    });

    // Voice streaming: play audio chunks in order
    socket.on('voice_audio', (data: { sessionId: string; chunkIndex: number; audio: string; speakerId: string }) => {
      // Don't play back your own voice
      if (data.speakerId === session?.user?.id) return;
      audioQueue.enqueue(data.sessionId, data.chunkIndex, data.audio);
    });

    socket.on('voice_stream_end', (data: { sessionId: string }) => {
      // Session will drain naturally; clear after a delay
      setTimeout(() => audioQueue.clearSession(data.sessionId), 30000);
    });

    // Web browser panel updates from AI
    socket.on('web_panel_update', (data: WebPanelData) => {
      setWebPanelData(data);
      setWebPanelOpen(true);
    });

    // Fetch machines for terminal panel
    socket.emit('get_machines');
    socket.on('machines_list', (data: { machines: { id: string; name: string; status: string; os?: string }[] }) => {
      setPanelMachines(data.machines);
    });

    // Chat cleared by admin/room creator
    socket.on('chat_cleared', () => {
      setMessages([]);
    });

    // Agent typing indicator
    socket.on('agent_typing', (data: { agentName: string }) => {
      setTypingAgents((prev) => (prev.includes(data.agentName) ? prev : [...prev, data.agentName]));
    });

    // Alarm trigger
    socket.on('trigger_alarm', (data: { message: string; agentName: string }) => {
      setAlarmActive(data);
      startAlarm();
    });

    // Volume control from AI
    socket.on('set_user_volume', (data: { volume: number; agentName: string }) => {
      audioQueue.setVolume(data.volume);
      updatePreference('volume', data.volume);
    });

    // Connect after all listeners are registered so we don't miss initial events
    if (!socket.connected) {
      socket.connect();
    }

    return () => {
      disconnectSocket();
      stopTTS();
      if (voiceStream.isActive()) voiceStream.stop();
      audioQueue.clearAll();
    };
  }, [session?.token, handleIncomingTTS]);

  const stopAllAudio = useCallback(() => {
    stopTTS();
    audioQueue.clearAll();
  }, []);

  const sendMessage = useCallback(
    async (text?: string) => {
      const msgText = text || input;
      if (!msgText.trim() || !session?.token) return;

      // Interrupt bot audio (TTS) when user sends a message, but leave user voice streams alone
      stopTTS();

      const nonce = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      // Add optimistic pending message immediately
      setMessages((prev) => [
        ...prev,
        {
          id: nonce,
          sender: session.user.username,
          text: msgText,
          timestamp: new Date().toISOString(),
          pending: true,
          nonce,
        },
      ]);
      if (!text) setInput('');

      // Generate premium audio if using a premium ElevenLabs voice
      let audio: string | null = null;
      const voiceId = preferences.voice_id || 'male';
      const isPremiumVoice = !['male', 'female', 'robot'].includes(voiceId);

      if (isPremiumVoice && preferences.use_premium_voice && session.user.is_premium) {
        try {
          const result = await voiceApi.generate(session.token, {
            text: msgText,
            voice_id: voiceId,
          });
          audio = result.audioBase64 || null;
        } catch (err) {
          console.error('Premium voice generation failed, sending without audio:', err);
          toast('Premium voice generation failed, sending as text', 'warning');
        }
      }

      const socket = getSocket(session.token);
      socket.emit('chat_message', {
        text: msgText,
        voice: voiceId,
        audio,
        nonce,
      });
    },
    [input, session?.token, session?.user.is_premium, preferences.voice_id, preferences.use_premium_voice],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const [uploading, setUploading] = useState(false);

  const uploadImage = useCallback(
    async (file: File) => {
      if (!session?.token) return;
      if (!file.type.startsWith('image/')) {
        toast('Only image files can be pasted', 'warning');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast('Image too large (max 10 MB)', 'warning');
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);

        const apiHost = config.API_HOSTNAME;
        const res = await axios.post(`${apiHost}/api/v1/upload/image`, formData, {
          headers: {
            Authorization: `Bearer ${session.token}`,
            'Content-Type': 'multipart/form-data',
          },
        });

        const imageUrl: string = res.data.url;

        const nonce = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        setMessages((prev) => [
          ...prev,
          {
            id: nonce,
            sender: session.user.username,
            type: 'image',
            text: imageUrl,
            timestamp: new Date().toISOString(),
            pending: true,
            nonce,
          },
        ]);

        const socket = getSocket(session.token);
        socket.emit('chat_message', {
          text: imageUrl,
          type: 'image',
          nonce,
        });
      } catch (err) {
        const msg =
          axios.isAxiosError(err) && err.response?.data?.message ? err.response.data.message : 'Failed to upload image';
        toast(msg, 'error');
      } finally {
        setUploading(false);
      }
    },
    [session?.token, toast],
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) uploadImage(file);
          return;
        }
      }
    },
    [uploadImage],
  );

  const toggleSpeechRecognition = () => {
    if (isListening) {
      // Stop whichever mode is active
      if (voiceStream.isActive()) {
        voiceStream.stop();
      } else {
        speechRecognition.stop();
      }
      setIsListening(false);
      return;
    }

    // If user has a premium voice selected, use voice streaming (chunked TTS)
    if (preferences.use_premium_voice && preferences.voice_id && session?.token) {
      const socket = getSocket(session.token);
      const sid = voiceStream.start(socket, preferences.voice_id, {
        onStart: () => setIsListening(true),
        onEnd: () => setIsListening(false),
        onChunkSent: (idx, text) => {
          // Also post the text as a chat message so it appears in chat
          sendMessage(text);
        },
        onError: () => setIsListening(false),
      });
      if (!sid) {
        toast('Speech recognition not supported in this browser');
      }
      return;
    }

    // Fallback: basic speech recognition (sends text immediately on each final result)
    const started = speechRecognition.start('en', true, {
      onResult: (transcript) => {
        sendMessage(transcript);
      },
      onStart: () => setIsListening(true),
      onEnd: () => setIsListening(false),
      onError: () => setIsListening(false),
    });

    if (!started) {
      toast('Speech recognition not supported in this browser');
    }
  };

  const handleCreateRoom = () => {
    if (!newRoomName.trim() || !session?.token) return;

    const socket = getSocket(session.token);
    socket.emit('create_room', { roomName: newRoomName, password: newRoomPassword || undefined });
    setNewRoomName('');
    setNewRoomPassword('');
    setCreateRoomOpen(false);
  };

  const handleSwitchRoom = (room: Room) => {
    if (!session?.token) return;
    setRoomError('');

    // For password-protected rooms, try switch_room (members get through).
    // If server responds with "Password required", the room_join_error handler
    // will open the password dialog via pendingRoom state.
    if (room.hasPassword && !room.isPublic) {
      setPendingRoom(room.name);
    }

    const socket = getSocket(session.token);
    socket.emit('switch_room', { roomName: room.name });
  };

  const handleJoinWithPassword = () => {
    if (!session?.token || !pendingRoom) return;
    setRoomError('');
    const socket = getSocket(session.token);
    socket.emit('join_room', { roomName: pendingRoom, password: roomPassword });
  };

  const handleDeleteRoom = (roomName: string) => {
    if (!session?.token) return;
    const socket = getSocket(session.token);
    socket.emit('delete_room', { roomName });
  };

  const canManageRoom = (room: Room): boolean => {
    if (!session?.user) return false;
    return session.user.is_admin || room.createdBy === session.user.id;
  };

  const openRoomSettings = (roomName: string) => {
    setRoomSettingsTarget(roomName);
    setRoomSettingsOpen(true);
  };

  const handleWatchPartyPlay = useCallback(
    (time: number) => {
      if (!session?.token) return;
      getSocket(session.token).emit('watch_party_action', { action: 'play', currentTime: time });
    },
    [session?.token],
  );

  const handleWatchPartyPause = useCallback(
    (time: number) => {
      if (!session?.token) return;
      getSocket(session.token).emit('watch_party_action', { action: 'pause', currentTime: time });
    },
    [session?.token],
  );

  const handleWatchPartyEnd = useCallback(() => {
    if (!session?.token) return;
    getSocket(session.token).emit('watch_party_end');
  }, [session?.token]);

  const handleStartScreenShare = useCallback(() => {
    if (!session?.token || !session?.user) return;
    setScreenShare({ sharerId: session.user.id, sharerUsername: session.user.username });
    setIsScreenSharer(true);
  }, [session?.token, session?.user]);

  const handleScreenShareEnd = useCallback(() => {
    setScreenShare(null);
    setIsScreenSharer(false);
  }, []);

  return (
    <DashboardLayout
      onChatClick={() => {
        const pub = rooms.find((r) => r.name === 'public');
        if (pub) handleSwitchRoom(pub);
      }}
      activityBarExtra={
        <>
          {rooms
            .filter((r) => r.name !== 'public')
            .map((room) => {
              const icon = getRoomIcon(room.displayName);
              const isActive = currentRoom === room.name;
              return (
                <Tooltip key={room.name} title={`${room.displayName} (${room.users})`} placement="right">
                  <Box
                    className={`${classes.roomIcon} ${isActive ? classes.active : ''}`}
                    sx={{ bgcolor: icon.bgColor }}
                    onClick={() => handleSwitchRoom(room)}
                  >
                    {icon.initials}
                    {room.users > 0 && <Box className={classes.roomBadge}>{room.users}</Box>}
                    {room.hasPassword && !room.isPublic && (
                      <Box className={classes.roomLock}>
                        <LockIcon sx={{ fontSize: 10, color: '#aaa' }} />
                      </Box>
                    )}
                  </Box>
                </Tooltip>
              );
            })}
          <Tooltip title="Create Room" placement="right">
            <Box className={classes.addRoomButton} onClick={() => setCreateRoomOpen(true)}>
              <AddIcon sx={{ fontSize: 16 }} />
            </Box>
          </Tooltip>
        </>
      }
    >
      <Box className={classes.root}>
        <Box className={classes.chatArea}>
          <Box className={classes.chatHeader}>
            <Typography variant="h6" color="primary">
              {currentRoomDisplay}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {rooms.some((r) => r.name === currentRoom && canManageRoom(r)) && (
                <IconButton
                  size="small"
                  color={roomSettingsOpen ? 'primary' : 'default'}
                  onClick={() => openRoomSettings(currentRoomDisplay)}
                  title="Room Settings"
                >
                  <TuneIcon />
                </IconButton>
              )}
              <IconButton
                size="small"
                color={terminalPanelOpen ? 'primary' : 'default'}
                onClick={() => setTerminalPanelOpen((prev) => !prev)}
                title="Terminal / Claude"
              >
                <TerminalIcon />
              </IconButton>
              <IconButton
                size="small"
                color={watchlistPanelOpen ? 'primary' : 'default'}
                onClick={() => setWatchlistPanelOpen((prev) => !prev)}
                title="YouTube Watchlist"
              >
                <PlaylistPlayIcon />
              </IconButton>
              <IconButton
                size="small"
                color={webPanelOpen ? 'primary' : 'default'}
                onClick={() => setWebPanelOpen((prev) => !prev)}
                title="Web Browser"
              >
                <LanguageIcon />
              </IconButton>
              <IconButton
                size="small"
                color={settingsOpen ? 'primary' : 'default'}
                onClick={() => setSettingsOpen((prev) => !prev)}
                title="Voice Settings"
              >
                <SettingsIcon />
              </IconButton>
            </Box>
          </Box>
          {watchParty && (
            <YouTubePlayer
              videoId={watchParty.videoId}
              state={watchParty.state}
              currentTime={watchParty.currentTime}
              onPlay={handleWatchPartyPlay}
              onPause={handleWatchPartyPause}
              onEnd={handleWatchPartyEnd}
            />
          )}
          {screenShare && session?.token && session?.user && (
            <ScreenSharePlayer
              sharerId={screenShare.sharerId}
              sharerUsername={screenShare.sharerUsername}
              socket={getSocket(session.token)}
              userId={session.user.id}
              onEnd={handleScreenShareEnd}
              isSharer={isScreenSharer}
            />
          )}
          <Box className={classes.messages}>
            {messages.map((msg, i) => {
              const displayName = msg.sender || msg.username || 'Unknown';
              const displayText = msg.text || msg.content || '';

              if (msg.isSystem) {
                if (msg.collapsible) {
                  return (
                    <Box key={msg.id || i} sx={{ textAlign: 'center', py: 0.25 }}>
                      <details
                        style={{
                          display: 'inline-block',
                          textAlign: 'left',
                          maxWidth: '80%',
                          cursor: 'pointer',
                        }}
                      >
                        <summary
                          style={{
                            fontStyle: 'italic',
                            fontSize: '0.75rem',
                            opacity: 0.8,
                            listStyle: 'none',
                            userSelect: 'none',
                            ...(msg.systemType === 'tool-result'
                              ? { color: '#3fb950', textShadow: '0 0 6px rgba(63, 185, 80, 0.4)' }
                              : {}),
                          }}
                        >
                          {msg.collapsible} ▸
                        </summary>
                        {msg.collapsible === 'Watchlist' ? (
                          <Box
                            sx={{
                              mt: 0.5,
                              p: 1,
                              borderRadius: 1,
                              backgroundColor: 'rgba(255,255,255,0.03)',
                              fontSize: '0.8rem',
                              maxHeight: '400px',
                              overflow: 'auto',
                            }}
                          >
                            <MessageContent text={displayText} />
                          </Box>
                        ) : (
                          <Typography
                            variant="detailText"
                            component="pre"
                            sx={{
                              fontStyle: 'italic',
                              whiteSpace: 'pre-wrap',
                              mt: 0.5,
                              p: 1,
                              borderRadius: 1,
                              backgroundColor: 'rgba(255,255,255,0.03)',
                              fontSize: '0.7rem',
                              maxHeight: '300px',
                              overflow: 'auto',
                              ...(msg.systemType === 'tool-result'
                                ? { color: '#3fb950', textShadow: '0 0 6px rgba(63, 185, 80, 0.4)' }
                                : {}),
                            }}
                          >
                            {displayText}
                          </Typography>
                        )}
                      </details>
                    </Box>
                  );
                }
                return (
                  <Box key={msg.id || i} sx={{ textAlign: 'center', py: 0.25 }}>
                    <Typography
                      variant="detailText"
                      sx={{
                        fontStyle: 'italic',
                        ...(msg.systemType === 'tool-result'
                          ? { color: '#3fb950', textShadow: '0 0 6px rgba(63, 185, 80, 0.4)' }
                          : {}),
                      }}
                    >
                      {displayText}
                    </Typography>
                  </Box>
                );
              }

              const prevMsg = i > 0 ? messages[i - 1] : null;
              const prevName = prevMsg ? prevMsg.sender || prevMsg.username || '' : '';
              const showName = !prevMsg || prevMsg.isSystem || prevName !== displayName;

              const rawTs = msg.timestamp || msg.created_at;
              const timeStr = rawTs
                ? new Date(rawTs).toLocaleString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                    month: 'numeric',
                    day: 'numeric',
                    year: '2-digit',
                  })
                : '';

              return (
                <Box key={msg.id || i} className={classes.message} sx={msg.pending ? { opacity: 0.5 } : undefined}>
                  {showName && (
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                      <Typography variant="sm" color="primary">
                        {displayName}
                      </Typography>
                      {timeStr && (
                        <Typography
                          variant="detailText"
                          sx={{ color: 'text.secondary', fontSize: '0.65rem', opacity: 0.7 }}
                        >
                          {timeStr}
                        </Typography>
                      )}
                    </Box>
                  )}
                  {msg.type === 'image' ? (
                    (() => {
                      const src = displayText.startsWith('http') ? displayText : `${config.API_HOSTNAME}${displayText}`;
                      return (
                        <a href={src} target="_blank" rel="noopener noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={src}
                            alt="Shared image"
                            style={{
                              maxWidth: '400px',
                              maxHeight: '400px',
                              borderRadius: '8px',
                              marginTop: '4px',
                              cursor: 'pointer',
                              display: 'block',
                            }}
                          />
                        </a>
                      );
                    })()
                  ) : (
                    <MessageContent text={displayText} />
                  )}
                </Box>
              );
            })}
            {typingAgents.map((agentName) => (
              <Box key={agentName} className={classes.message} sx={{ opacity: 0.5 }}>
                <Typography variant="sm" color="primary">
                  {agentName}
                </Typography>
                <span className={classes.typingDots}>
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </Box>
            ))}
            <div ref={messagesEndRef} />
          </Box>

          <ChatInput
            onSend={(text) => sendMessage(text)}
            onPaste={handlePaste}
            onImageSelect={uploadImage}
            disabled={uploading}
            placeholder={uploading ? 'Uploading image...' : 'Type a message...'}
            actionButtons={
              <>
                {audioPlaying && (
                  <IconButton size="small" color="error" onClick={stopAllAudio} title="Stop Audio">
                    <StopCircleIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                )}
                <IconButton
                  size="small"
                  color={isListening ? 'error' : 'default'}
                  onClick={toggleSpeechRecognition}
                  className={isListening ? classes.micPulsing : undefined}
                  title={isListening ? 'Stop Mic' : 'Start Mic'}
                >
                  {isListening ? <MicOffIcon sx={{ fontSize: 18 }} /> : <MicIcon sx={{ fontSize: 18 }} />}
                </IconButton>
                <IconButton
                  size="small"
                  color="warning"
                  onClick={() => {
                    if (!session?.token) return;
                    const socket = getSocket(session.token);
                    socket.emit('room_alarm', { roomName: currentRoom });
                  }}
                  title="Sound Alarm"
                >
                  <NotificationsActiveIcon sx={{ fontSize: 18 }} />
                </IconButton>
                <IconButton size="small" onClick={handleStartScreenShare} disabled={!!screenShare} title="Share Screen">
                  <ScreenShareIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </>
            }
          />
        </Box>

        {settingsOpen && <SettingsPanel />}
        {terminalPanelOpen && (
          <TerminalPanel
            socket={socketInstanceRef.current}
            machines={panelMachines}
            onClose={() => setTerminalPanelOpen(false)}
          />
        )}
        {watchlistPanelOpen && (
          <WatchlistPanel onClose={() => setWatchlistPanelOpen(false)} onCommand={(cmd) => sendMessage(cmd)} />
        )}
        {webPanelOpen && <WebBrowserPanel data={webPanelData} onClose={() => setWebPanelOpen(false)} />}
      </Box>

      <Dialog open={createRoomOpen} onClose={() => setCreateRoomOpen(false)}>
        <DialogTitle>Create Room</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Room Name"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            fullWidth
            label="Password (optional)"
            type="password"
            value={newRoomPassword}
            onChange={(e) => setNewRoomPassword(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateRoomOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateRoom}>
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={passwordDialogOpen}
        onClose={() => {
          setPasswordDialogOpen(false);
          setRoomPassword('');
          setRoomError('');
        }}
      >
        <DialogTitle>Room Password</DialogTitle>
        <DialogContent>
          <Typography variant="detailText" sx={{ mb: 2 }}>
            This room is password-protected. Enter the password to join.
          </Typography>
          {roomError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {roomError}
            </Alert>
          )}
          <TextField
            fullWidth
            label="Password"
            type="password"
            value={roomPassword}
            onChange={(e) => setRoomPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleJoinWithPassword();
            }}
            autoFocus
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPasswordDialogOpen(false);
              setRoomPassword('');
              setRoomError('');
            }}
          >
            Cancel
          </Button>
          <Button variant="contained" onClick={handleJoinWithPassword}>
            Join
          </Button>
        </DialogActions>
      </Dialog>
      <RoomSettings
        roomName={roomSettingsTarget}
        open={roomSettingsOpen}
        onClose={() => setRoomSettingsOpen(false)}
        canManageRoom={rooms.some((r) => r.name === roomSettingsTarget.toLowerCase() && canManageRoom(r))}
        onDeleteRoom={handleDeleteRoom}
      />

      {/* Alarm overlay */}
      {alarmActive && (
        <Box
          onClick={dismissAlarm}
          sx={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            bgcolor: 'rgba(255, 0, 0, 0.85)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            animation: 'alarmPulse 1s infinite',
            '@keyframes alarmPulse': {
              '0%, 100%': { bgcolor: 'rgba(255, 0, 0, 0.85)' },
              '50%': { bgcolor: 'rgba(200, 0, 0, 0.95)' },
            },
          }}
        >
          <Typography sx={{ fontSize: '4rem', color: '#fff', mb: 2 }}>ALARM</Typography>
          <Typography sx={{ fontSize: '1.8rem', color: '#fff', textAlign: 'center', px: 4, mb: 4 }}>
            {alarmActive.message}
          </Typography>
          <Typography sx={{ fontSize: '1rem', color: 'rgba(255,255,255,0.7)' }}>Click anywhere to dismiss</Typography>
        </Box>
      )}
    </DashboardLayout>
  );
};

export default ChatPage;
