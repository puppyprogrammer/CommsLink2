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
  Badge,
  Select,
  MenuItem,
} from '@mui/material';

// Material UI icons
import SendIcon from '@mui/icons-material/Send';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import AddIcon from '@mui/icons-material/Add';
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
import * as voiceCapture from '@/lib/helpers/voiceCapture';
import * as voiceStream from '@/lib/helpers/voiceStream';
import * as audioQueue from '@/lib/helpers/audioQueue';
import { startAlarm, stopAlarm } from '@/lib/helpers/alarm';
import { getRoomIcon } from '@/lib/helpers/roomIcon';
import voiceApi from '@/lib/api/voice';
import { useToast } from '@/lib/state/ToastContext';

// Components
import RoomSettings from '@/components/RoomSettings';
import ChatInput from '@/components/ChatInput';
import MessageContent from '@/components/MessageContent';
import StopCircleIcon from '@mui/icons-material/StopCircle';

import html2canvas from 'html2canvas';
import TerminalPanel from '@/components/TerminalPanel';
import ResizeHandle from '@/components/ResizeHandle';
import TerminalIcon from '@mui/icons-material/Terminal';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
// Models
import type { ChatMessage, Room } from '@/models/chat';

// Styles
import classes from './Chat.module.scss';

const ChatPage = () => {
  const { session } = useSession();
  const { preferences, updatePreference } = usePreferences();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [currentRoom, setCurrentRoom] = useState<string>('');
  const [currentRoomDisplay, setCurrentRoomDisplay] = useState<string>('');
  const [input, setInput] = useState(''); // kept for speech recognition
  const [isListening, setIsListening] = useState(false);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [pendingRoom, setPendingRoom] = useState<string>('');
  const [roomPassword, setRoomPassword] = useState('');
  const [roomError, setRoomError] = useState('');
  const [roomSettingsOpen, setRoomSettingsOpen] = useState(false);
  const [roomSettingsTarget, setRoomSettingsTarget] = useState<string>('');
  const [terminalPanelOpen, setTerminalPanelOpenRaw] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('terminalPanelOpen');
      if (saved !== null) return saved === 'true';
    }
    return false;
  });
  const setTerminalPanelOpen = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setTerminalPanelOpenRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      localStorage.setItem('terminalPanelOpen', String(next));
      if (!next) localStorage.setItem('terminalPanelDismissed', 'true');
      return next;
    });
  }, []);
  const [terminalNotifications, setTerminalNotifications] = useState(0);
  const [terminalTab, setTerminalTab] = useState<'terminal' | 'claude'>('claude');
  const terminalPanelOpenRef = useRef(terminalPanelOpen);
  terminalPanelOpenRef.current = terminalPanelOpen;
  const [terminalWidth, setTerminalWidth] = useState(600);
  const [panelMachines, setPanelMachines] = useState<{ id: string; name: string; status: string; os?: string }[]>([]);
  const socketInstanceRef = useRef<ReturnType<typeof getSocket> | null>(null);
  const [typingAgents, setTypingAgents] = useState<string[]>([]);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [alarmActive, setAlarmActive] = useState<{ message: string; agentName: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const preferencesRef = useRef(preferences);
  // Buffer of recently played AI speech text — used to filter mic echo
  const recentAiSpeechRef = useRef<{ text: string; time: number }[]>([]);
  const [availableVoices, setAvailableVoices] = useState<{ voice_id: string; name: string }[]>([]);

  // Fetch available voices on mount
  useEffect(() => {
    if (!session?.token) return;
    voiceApi.listVoices(session.token)
      .then((data) => setAvailableVoices(data.voices || []))
      .catch(() => {});
  }, [session?.token]);

  // Keep preferences ref in sync for use in socket callbacks
  useEffect(() => {
    preferencesRef.current = preferences;
    audioQueue.setVolume(preferences.volume);
  }, [preferences]);

  // Track TTS audio playing state — pause mic while AI audio plays to prevent feedback loop
  useEffect(() => {
    onPlayStateChange((playing) => {
      setAudioPlaying(playing);
      if (playing) {
        if (voiceCapture.isActive()) {
          voiceCapture.pause();
        } else {
          speechRecognition.pause();
        }
      } else {
        if (voiceCapture.isActive()) {
          voiceCapture.resume();
        } else {
          speechRecognition.resume();
        }
      }
    });
    return () => onPlayStateChange(() => {});
  }, []);

  // Check if a transcript is likely echo from AI speaker output
  const isEcho = useCallback((transcript: string): boolean => {
    const now = Date.now();
    const normalizedInput = transcript.toLowerCase().trim();
    if (normalizedInput.length < 4) return false; // Too short to be meaningful echo

    // Clean expired entries (older than 15 seconds)
    recentAiSpeechRef.current = recentAiSpeechRef.current.filter((e) => now - e.time < 15000);

    for (const entry of recentAiSpeechRef.current) {
      const normalizedAi = entry.text.toLowerCase();
      // Check if the transcript is a substring of recent AI speech or vice versa
      if (normalizedAi.includes(normalizedInput) || normalizedInput.includes(normalizedAi)) return true;
      // Check word overlap — if >60% of words match, it's likely echo
      const inputWords = normalizedInput.split(/\s+/);
      const aiWords = new Set(normalizedAi.split(/\s+/));
      const matchCount = inputWords.filter((w) => aiWords.has(w)).length;
      if (inputWords.length > 2 && matchCount / inputWords.length > 0.6) return true;
    }
    return false;
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
      // Skip TTS for system messages or text-only messages ({text} command)
      if (msg.isSystem || msg.noVoice) return;

      const prefs = preferencesRef.current;
      const sender = msg.sender || msg.username || '';
      const isOwnMessage = sender === session?.user.username;

      // Skip TTS for own messages unless "hear own voice" is enabled
      if (isOwnMessage && !prefs.hear_own_voice) return;

      // Play server-generated TTS audio (Polly) and track for echo cancellation
      if (msg.audio) {
        const text = msg.text || msg.content || '';
        if (text) {
          recentAiSpeechRef.current.push({ text, time: Date.now() });
        }
        playAudioBlob(msg.audio, prefs.volume);
      }
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
        avatars?: { id: string; userId: string; label: string; skeleton: unknown[]; points: unknown[]; pose: unknown; physics: boolean; morphTargets?: unknown }[];
      }) => {
        setCurrentRoomDisplay(data.roomName);
        setCurrentRoom(data.roomName.toLowerCase());
        setMessages(Array.isArray(data.messages) ? data.messages : []);
        setPasswordDialogOpen(false);
        setRoomPassword('');
        setRoomError('');
        setTypingAgents([]);
        stopTTS();
        // Auto-open terminal panel for new rooms (0 messages) if user hasn't dismissed it before
        if ((!data.messages || data.messages.length === 0) && !localStorage.getItem('terminalPanelDismissed')) {
          setTerminalPanelOpen(true);
        }
      },
    );

    socket.on('no_rooms', () => {
      // User has no room memberships — show room creation dialog
      setCreateRoomOpen(true);
    });

    socket.on('room_deleted', (data: { roomName: string; message: string }) => {
      toast(data.message, 'info');
      // Reload to switch to fallback room
      window.location.reload();
    });

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

    // Fetch machines for terminal panel
    socket.emit('get_machines');
    socket.on('machines_list', (data: { machines: { id: string; name: string; status: string; os?: string }[] }) => {
      setPanelMachines(data.machines);
    });

    // Auto-open terminal panel and switch tab when AI uses terminal/claude commands
    socket.on('panel_log', (data: { tab?: 'terminal' | 'claude' }) => {
      if (!terminalPanelOpenRef.current) {
        setTerminalPanelOpen(true);
        setTerminalNotifications(0);
      }
      if (data?.tab) {
        setTerminalTab(data.tab);
      }
    });

    // Chat cleared by admin/room creator
    socket.on('chat_cleared', () => {
      setMessages([]);
    });

    // Agent typing indicator
    socket.on('agent_typing', (data: { agentName: string }) => {
      setTypingAgents((prev) => (prev.includes(data.agentName) ? prev : [...prev, data.agentName]));
    });
    socket.on('agent_done_typing', (data: { agentName: string }) => {
      setTypingAgents((prev) => prev.filter((name) => name !== data.agentName));
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

    // AI {look} command — screenshot the page and send back
    socket.on('screenshot_request', async (data: { requestId: string }) => {
      try {
        const canvas = await html2canvas(document.body, {
          backgroundColor: '#121212',
          scale: 0.75, // Lower res for speed + smaller payload
          logging: false,
          useCORS: true,
        });
        const base64 = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
        socket.emit('screenshot_response', {
          requestId: data.requestId,
          base64,
          mimeType: 'image/jpeg',
        });
      } catch (err) {
        console.error('Screenshot capture failed:', err);
      }
    });

    // AI {ui open/close panel} commands
    socket.on('ui_command', (data: { action: 'open' | 'close'; panel: string }) => {
      const isOpen = data.action === 'open';
      switch (data.panel) {
        case 'terminal':
          setTerminalPanelOpen(isOpen);
          break;
      }
    });

    // Connect after all listeners are registered so we don't miss initial events
    if (!socket.connected) {
      socket.connect();
    }

    // If redirected from invite link, switch to the invited room once connected
    const urlParams = new URLSearchParams(window.location.search);
    const joinRoomParam = urlParams.get('joinRoom');
    if (joinRoomParam) {
      const targetRoom = joinRoomParam.toLowerCase();
      window.history.replaceState({}, '', '/chat');
      // Emit switch immediately — the server will join us to the right room
      // Use a connect listener in case socket isn't connected yet
      const doSwitch = () => socket.emit('switch_room', { roomName: targetRoom });
      if (socket.connected) {
        doSwitch();
      } else {
        socket.once('connect', doSwitch);
      }
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

      // Generate TTS audio only for typed messages (not voice-captured ones)
      let audio: string | null = null;
      const voiceId = preferences.voice_id || 'Joanna';
      const isFromVoice = !!text && (voiceCapture.isActive() || speechRecognition.isActive());

      if (!isFromVoice) {
        try {
          const result = await voiceApi.generate(session.token, {
            text: msgText,
            voice_id: voiceId,
          });
          audio = result.audioBase64 || null;
        } catch (err) {
          console.error('Voice generation failed, sending without audio:', err);
          toast('Voice generation failed, sending as text', 'warning');
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
    [input, session?.token, preferences.voice_id],
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
      if (voiceCapture.isActive()) {
        voiceCapture.stop();
      } else if (voiceStream.isActive()) {
        voiceStream.stop();
      } else {
        speechRecognition.stop();
      }
      setIsListening(false);
      return;
    }

    // Try voice capture (MediaRecorder + server STT) first, fall back to Web Speech API
    const tryVoiceCapture = async () => {
      if (voiceCapture.isSupported() && session?.token) {
        const socket = getSocket(session.token);
        const ok = await voiceCapture.start(socket, {
          onTranscript: (text) => {
            if (isEcho(text)) return;
            sendMessage(text);
          },
          onStart: () => setIsListening(true),
          onEnd: () => setIsListening(false),
          onError: (err) => {
            toast(`Voice capture error: ${err}`, 'warning');
            setIsListening(false);
          },
        });
        if (ok) return;
        // voiceCapture failed (permission denied etc) — fall back
        toast('Mic denied for voice capture, trying speech recognition...', 'info');
      }

      // Fallback: Web Speech API
      const started = speechRecognition.start('en', true, {
        onResult: (transcript) => {
          if (isEcho(transcript)) return;
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

    tryVoiceCapture().catch((err) => {
      toast(`Mic error: ${err}`, 'error');
      setIsListening(false);
    });
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
            <Typography
              variant="subtitle1"
              sx={{ fontFamily: "'Orbitron', monospace", color: 'primary.main', fontSize: '0.95rem' }}
            >
              {currentRoomDisplay}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, position: 'absolute', right: 8 }}>
              {rooms.some((r) => r.name === currentRoom && canManageRoom(r)) && (
                <IconButton
                  size="small"
                  onClick={() => openRoomSettings(currentRoomDisplay)}
                  title="Room Settings"
                  sx={{ color: roomSettingsOpen ? 'primary.main' : '#858585' }}
                >
                  <TuneIcon />
                </IconButton>
              )}
              <IconButton
                size="small"
                onClick={() => {
                  setTerminalPanelOpen((prev) => !prev);
                  setTerminalNotifications(0);
                }}
                title="Terminal / Claude"
                sx={{ color: terminalPanelOpen ? 'primary.main' : '#858585' }}
              >
                <Badge
                  badgeContent={terminalNotifications}
                  color="error"
                  max={99}
                  sx={{
                    '& .MuiBadge-badge': {
                      fontSize: '0.6rem',
                      minWidth: 16,
                      height: 16,
                      padding: '0 4px',
                    },
                  }}
                >
                  <TerminalIcon />
                </Badge>
              </IconButton>
            </Box>
          </Box>
          <Box className={classes.messages}>
            {messages.map((msg, i) => {
              const displayName = msg.sender || msg.username || 'Unknown';
              const displayText = msg.text || msg.content || '';

              // Infer systemType from message text when not set (e.g. loaded from DB)
              const sysType =
                msg.systemType ||
                (msg.isSystem && displayText
                  ? /^\[.+claude\s*→/i.test(displayText)
                    ? 'claude-prompt'
                    : /^\[Claude\b/i.test(displayText)
                      ? 'claude-response'
                      : /^\[.+terminal\s*→|^\[Terminal\b/i.test(displayText)
                        ? 'terminal'
                        : /^Security Bot:/i.test(displayText)
                          ? 'security'
                          : undefined
                  : undefined);

              // Hide panel-routed system messages from chat (they show in TerminalPanel instead)
              if (sysType === 'claude-prompt' || sysType === 'claude-response' || sysType === 'terminal') {
                return null;
              }

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
                            ...(sysType === 'claude-prompt'
                              ? { color: '#3fb950', textShadow: '0 0 6px rgba(63, 185, 80, 0.4)' }
                              : sysType === 'claude-response'
                                ? { color: '#f0883e', textShadow: '0 0 6px rgba(240, 136, 62, 0.4)' }
                                : sysType === 'terminal'
                                  ? { color: '#bc8cff', textShadow: '0 0 6px rgba(188, 140, 255, 0.4)' }
                                  : {}),
                          }}
                        >
                          {msg.collapsible} ▸
                        </summary>
                        <Typography
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
                              color:
                                sysType === 'claude-prompt'
                                  ? '#3fb950'
                                  : sysType === 'claude-response'
                                    ? '#f0883e'
                                    : sysType === 'terminal'
                                      ? '#bc8cff'
                                      : '#858585',
                              textShadow:
                                sysType === 'claude-prompt'
                                  ? '0 0 6px rgba(63, 185, 80, 0.4)'
                                  : sysType === 'claude-response'
                                    ? '0 0 6px rgba(240, 136, 62, 0.4)'
                                    : sysType === 'terminal'
                                      ? '0 0 6px rgba(188, 140, 255, 0.4)'
                                      : 'none',
                            }}
                          >
                            {displayText}
                          </Typography>
                      </details>
                    </Box>
                  );
                }
                return (
                  <Box key={msg.id || i} sx={{ textAlign: 'center', py: 0.25 }}>
                    <Typography
                      sx={{
                        fontSize: sysType === 'security' ? '0.95rem' : '0.875rem',
                        fontStyle: 'italic',
                        fontWeight: sysType === 'security' ? 700 : undefined,
                        color:
                          sysType === 'security'
                            ? '#ff4444'
                            : sysType === 'claude-prompt'
                              ? '#3fb950'
                              : sysType === 'claude-response'
                                ? '#f0883e'
                                : sysType === 'terminal'
                                  ? '#bc8cff'
                                  : '#858585',
                        textShadow:
                          sysType === 'security'
                            ? '0 0 8px rgba(255, 68, 68, 0.5)'
                            : sysType === 'claude-prompt'
                              ? '0 0 6px rgba(63, 185, 80, 0.4)'
                              : sysType === 'claude-response'
                                ? '0 0 6px rgba(240, 136, 62, 0.4)'
                                : sysType === 'terminal'
                                  ? '0 0 6px rgba(188, 140, 255, 0.4)'
                                  : 'none',
                      }}
                    >
                      <MessageContent text={displayText} />
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
                <Select
                  size="small"
                  value={preferences.voice_id || 'Joanna'}
                  onChange={(e) => updatePreference('voice_id', e.target.value)}
                  variant="standard"
                  disableUnderline
                  sx={{
                    fontSize: '0.7rem',
                    color: '#4dd8d0',
                    maxWidth: 110,
                    '& .MuiSelect-select': { py: 0, px: 0.5 },
                    '& .MuiSvgIcon-root': { fontSize: 14, color: '#556b82' },
                  }}
                >
                  {availableVoices.map((v) => (
                    <MenuItem key={v.voice_id} value={v.voice_id} sx={{ fontSize: '0.8rem' }}>
                      {v.name}
                    </MenuItem>
                  ))}
                </Select>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    width: 52,
                    height: 20,
                    position: 'relative',
                    cursor: 'pointer',
                    '&:hover .volFill': { background: '#4dd8d0' },
                    '&:hover .volThumb': { opacity: 1 },
                  }}
                  title={`Volume: ${Math.round(preferences.volume * 100)}%`}
                >
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={preferences.volume}
                    onChange={(e) => updatePreference('volume', parseFloat(e.target.value))}
                    style={{
                      position: 'absolute',
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer',
                      zIndex: 2,
                      margin: 0,
                    }}
                  />
                  <Box sx={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    height: 3,
                    borderRadius: 1.5,
                    background: 'rgba(255,255,255,0.15)',
                  }}>
                    <Box
                      className="volFill"
                      sx={{
                        width: `${preferences.volume * 100}%`,
                        height: '100%',
                        borderRadius: 1.5,
                        background: '#888',
                        transition: 'background 0.15s',
                      }}
                    />
                  </Box>
                  <Box
                    className="volThumb"
                    sx={{
                      position: 'absolute',
                      left: `calc(${preferences.volume * 100}% - 5px)`,
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      background: '#fff',
                      opacity: 0,
                      transition: 'opacity 0.15s',
                      pointerEvents: 'none',
                    }}
                  />
                </Box>
                <IconButton
                  size="small"
                  color={isListening ? 'error' : 'default'}
                  onClick={toggleSpeechRecognition}
                  className={isListening ? classes.micPulsing : undefined}
                  title={isListening ? 'Stop Mic' : 'Start Mic'}
                >
                  {isListening ? <MicOffIcon sx={{ fontSize: 18 }} /> : <MicIcon sx={{ fontSize: 18 }} />}
                </IconButton>
              </>
            }
          />
        </Box>

        {terminalPanelOpen && (
          <>
            <ResizeHandle onResize={(d) => setTerminalWidth((w) => Math.max(300, Math.min(1200, w + d)))} />
            <div
              className={classes.sidePanel}
              style={{ width: terminalWidth }}
            >
              <TerminalPanel
                socket={socketInstanceRef.current}
                machines={panelMachines}
                onClose={() => setTerminalPanelOpen(false)}
                initialTab={terminalTab}
                isCreator={rooms.some((r) => r.name === currentRoom && canManageRoom(r))}
              />
            </div>
          </>
        )}
      </Box>

      <Dialog
        open={createRoomOpen}
        onClose={() => setCreateRoomOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            background: 'linear-gradient(145deg, #0a1929 0%, #0d2137 50%, #0a1929 100%)',
            border: '1px solid rgba(77, 216, 208, 0.2)',
            borderRadius: 3,
          },
        }}
      >
        <DialogTitle sx={{
          textAlign: 'center', pt: 3,
          fontFamily: "'Orbitron', monospace",
          color: '#4dd8d0',
          textShadow: '0 0 10px rgba(77,216,208,0.3)',
          fontSize: '1.4rem',
        }}>
          Create Your Space
        </DialogTitle>
        <DialogContent sx={{ px: 4, pb: 1 }}>
          <Typography variant="body2" sx={{ color: '#8899aa', textAlign: 'center', mb: 3 }}>
            Your room is your command center — chat, deploy AI agents, run terminals, and collaborate.
          </Typography>

          <TextField
            fullWidth
            label="Room Name"
            value={newRoomName}
            onChange={(e) => setNewRoomName(e.target.value)}
            placeholder="e.g. My Lab, Game Night, Study Group"
            sx={{
              mb: 2,
              '& .MuiOutlinedInput-root': {
                '& fieldset': { borderColor: 'rgba(77,216,208,0.3)' },
                '&:hover fieldset': { borderColor: 'rgba(77,216,208,0.5)' },
                '&.Mui-focused fieldset': { borderColor: '#4dd8d0' },
              },
              '& .MuiInputLabel-root': { color: '#6688aa' },
              '& .MuiInputBase-input': { color: '#e0e8f0' },
            }}
          />

          <TextField
            fullWidth
            label="Password (leave empty for invite-only)"
            type="password"
            value={newRoomPassword}
            onChange={(e) => setNewRoomPassword(e.target.value)}
            sx={{
              mb: 3,
              '& .MuiOutlinedInput-root': {
                '& fieldset': { borderColor: 'rgba(77,216,208,0.15)' },
                '&:hover fieldset': { borderColor: 'rgba(77,216,208,0.3)' },
              },
              '& .MuiInputLabel-root': { color: '#556677' },
              '& .MuiInputBase-input': { color: '#c0c8d0' },
            }}
          />

          {/* Feature highlights */}
          <Box sx={{
            background: 'rgba(77,216,208,0.05)',
            border: '1px solid rgba(77,216,208,0.1)',
            borderRadius: 2, p: 2, mb: 2,
          }}>
            <Typography variant="caption" sx={{ color: '#4dd8d0', fontWeight: 'bold', mb: 1, display: 'block' }}>
              What you can do in your room:
            </Typography>
            {[
              { icon: '🤖', text: 'Deploy AI agents that think, speak, and work autonomously' },
              { icon: '💻', text: 'Connect remote terminals and run Claude Code sessions' },
              { icon: '🎙️', text: 'Voice chat with AI text-to-speech' },
              { icon: '👾', text: 'Customize 3D holographic avatars' },
              { icon: '🔍', text: 'AI-powered web search and browsing' },
            ].map((f, i) => (
              <Typography key={i} variant="body2" sx={{ color: '#8899aa', fontSize: '0.78rem', py: 0.3 }}>
                <span style={{ marginRight: 8 }}>{f.icon}</span>{f.text}
              </Typography>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 4, pb: 3, justifyContent: 'center', gap: 1 }}>
          <Button
            onClick={() => setCreateRoomOpen(false)}
            sx={{ color: '#667788', px: 3 }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleCreateRoom}
            sx={{
              px: 4,
              background: 'linear-gradient(135deg, #4dd8d0 0%, #3ab8b0 100%)',
              color: '#0a1929',
              fontWeight: 'bold',
              boxShadow: '0 0 15px rgba(77,216,208,0.3)',
              '&:hover': {
                background: 'linear-gradient(135deg, #5de8e0 0%, #4ac8c0 100%)',
                boxShadow: '0 0 25px rgba(77,216,208,0.5)',
              },
            }}
          >
            Create Room
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
