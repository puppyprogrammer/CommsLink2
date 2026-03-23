/**
 * Voice capture using MediaRecorder.
 *
 * Captures raw audio via MediaRecorder and sends chunks to the server
 * over Socket.IO for server-side STT. This replaces the Web Speech API
 * on Android (and other platforms) to eliminate the beeping sound that
 * occurs when SpeechRecognition restarts.
 */

type VoiceCaptureSocket = {
  emit: (event: string, ...args: unknown[]) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off: (event: string, handler: (...args: unknown[]) => void) => void;
};

type VoiceCaptureCallbacks = {
  onTranscript: (text: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
};

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let socket: VoiceCaptureSocket | null = null;
let callbacks: VoiceCaptureCallbacks | null = null;

// Socket event handlers (stored for cleanup)
let transcriptHandler: ((data: unknown) => void) | null = null;
let partialHandler: ((data: unknown) => void) | null = null;

const isSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  return !!(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
};

const isActive = (): boolean => {
  return recorder !== null && (recorder.state === 'recording' || recorder.state === 'paused');
};

const start = async (
  sock: VoiceCaptureSocket,
  cbs: VoiceCaptureCallbacks,
): Promise<boolean> => {
  if (!isSupported()) return false;

  // Clean up any previous session
  stop();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
    });
  } catch (err) {
    cbs.onError?.(`Microphone access denied: ${err}`);
    return false;
  }

  socket = sock;
  callbacks = cbs;

  // Pick a supported mime type
  let mimeType = 'audio/webm;codecs=opus';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      // Let the browser pick its default
      mimeType = '';
    }
  }

  try {
    recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
  } catch (err) {
    cbs.onError?.(`MediaRecorder creation failed: ${err}`);
    cleanup();
    return false;
  }

  // Listen for server transcription events
  transcriptHandler = (data: unknown) => {
    const d = data as { text?: string };
    if (d?.text && callbacks) {
      callbacks.onTranscript(d.text);
    }
  };
  partialHandler = (_data: unknown) => {
    // Partial transcripts could be used for UI feedback in the future
  };

  socket.on('voice_stt_transcript', transcriptHandler);
  socket.on('voice_stt_partial', partialHandler);

  // Send audio chunks to the server
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0 && socket) {
      event.data.arrayBuffer().then((buffer) => {
        socket!.emit('voice_stt_chunk', buffer);
      });
    }
  };

  recorder.onstart = () => {
    socket?.emit('voice_stt_start', { mimeType: recorder?.mimeType || mimeType });
    callbacks?.onStart?.();
  };

  recorder.onstop = () => {
    // Only fire onEnd if we're fully stopping (not just pausing)
    // The stop() function handles cleanup and onEnd
  };

  recorder.onerror = () => {
    callbacks?.onError?.('MediaRecorder error');
    stop();
  };

  recorder.start(250); // 250ms timeslice
  return true;
};

const pause = (): void => {
  if (recorder && recorder.state === 'recording') {
    recorder.pause();
  }
};

const resume = (): void => {
  if (recorder && recorder.state === 'paused') {
    recorder.resume();
  }
};

const stop = (): void => {
  if (recorder) {
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Already stopped
      }
    }
    recorder = null;
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  if (socket) {
    socket.emit('voice_stt_stop', {});
    if (transcriptHandler) {
      socket.off('voice_stt_transcript', transcriptHandler);
      transcriptHandler = null;
    }
    if (partialHandler) {
      socket.off('voice_stt_partial', partialHandler);
      partialHandler = null;
    }
    socket = null;
  }

  const cbs = callbacks;
  callbacks = null;
  cbs?.onEnd?.();
};

const cleanup = (): void => {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  socket = null;
  callbacks = null;
  recorder = null;
};

export { start, stop, pause, resume, isActive, isSupported };
export type { VoiceCaptureCallbacks };
