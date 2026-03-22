/**
 * Voice stream manager.
 *
 * Keeps the mic on, runs speech recognition continuously, and sends
 * accumulated text to the server in 5-second chunks for TTS.
 */

const CHUNK_INTERVAL_MS = 5000;

type VoiceStreamSocket = {
  emit: (event: string, data: Record<string, unknown>) => void;
};

type VoiceStreamCallbacks = {
  onStart?: () => void;
  onEnd?: () => void;
  onChunkSent?: (chunkIndex: number, text: string) => void;
  onError?: (error: string) => void;
};

let sessionId: string | null = null;
let chunkIndex = 0;
let accumulatedText = '';
let chunkTimer: ReturnType<typeof setInterval> | null = null;
let recognition: SpeechRecognition | null = null;
let activeSocket: VoiceStreamSocket | null = null;
let activeVoiceId: string | null = null;
let activeCallbacks: VoiceStreamCallbacks = {};
let stopped = false;

const generateSessionId = (): string => `vs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const flushChunk = (): void => {
  const text = accumulatedText.trim();
  accumulatedText = '';

  if (!text || !activeSocket || !sessionId || !activeVoiceId) return;

  const idx = chunkIndex++;

  activeSocket.emit('voice_chunk', {
    sessionId,
    chunkIndex: idx,
    text,
    voiceId: activeVoiceId,
  });

  activeCallbacks.onChunkSent?.(idx, text);
};

const startRecognition = (): void => {
  if (typeof window === 'undefined') return;

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    activeCallbacks.onError?.('Speech recognition not supported');
    return;
  }

  recognition = new SpeechRecognitionCtor();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    const lastResult = event.results[event.results.length - 1];
    if (lastResult.isFinal) {
      const transcript = lastResult[0].transcript;
      if (transcript.trim()) {
        accumulatedText += (accumulatedText ? ' ' : '') + transcript.trim();
      }
    }
  };

  recognition.onend = () => {
    // Auto-restart if not intentionally stopped
    if (!stopped && recognition) {
      try {
        recognition.start();
      } catch {
        // Already started or stopped
      }
    }
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (event.error === 'no-speech') return;
    if (event.error === 'aborted') return;
    activeCallbacks.onError?.(event.error);
  };

  recognition.start();
};

/**
 * Start a voice streaming session.
 *
 * The mic stays on, speech recognition runs continuously, and every 5 seconds
 * accumulated text is sent to the server for TTS processing.
 */
const start = (socket: VoiceStreamSocket, voiceId: string, callbacks: VoiceStreamCallbacks = {}): string | null => {
  if (sessionId) return sessionId; // Already running

  if (typeof window === 'undefined') return null;

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    callbacks.onError?.('Speech recognition not supported');
    return null;
  }

  stopped = false;
  sessionId = generateSessionId();
  chunkIndex = 0;
  accumulatedText = '';
  activeSocket = socket;
  activeVoiceId = voiceId;
  activeCallbacks = callbacks;

  // Notify server that streaming has started
  socket.emit('voice_stream_start', { sessionId, voiceId });

  // Start speech recognition
  startRecognition();

  // Start chunk timer — flush accumulated text every 5 seconds
  chunkTimer = setInterval(flushChunk, CHUNK_INTERVAL_MS);

  callbacks.onStart?.();
  return sessionId;
};

/**
 * Stop the voice streaming session.
 *
 * Flushes any remaining text and notifies the server.
 */
const stop = (): void => {
  stopped = true;

  // Flush remaining text
  flushChunk();

  // Stop chunk timer
  if (chunkTimer) {
    clearInterval(chunkTimer);
    chunkTimer = null;
  }

  // Stop speech recognition
  if (recognition) {
    const ref = recognition;
    recognition = null;
    ref.stop();
  }

  // Notify server
  if (activeSocket && sessionId) {
    activeSocket.emit('voice_stream_end', { sessionId });
  }

  activeCallbacks.onEnd?.();

  // Reset state
  sessionId = null;
  chunkIndex = 0;
  accumulatedText = '';
  activeSocket = null;
  activeVoiceId = null;
  activeCallbacks = {};
};

const isActive = (): boolean => sessionId !== null;
const getSessionId = (): string | null => sessionId;

export { start, stop, isActive, getSessionId };
