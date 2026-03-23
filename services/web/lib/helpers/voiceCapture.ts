/**
 * Voice capture using Web Audio API (raw PCM).
 *
 * Captures raw PCM audio and sends chunks to the server over Socket.IO
 * for server-side STT via Amazon Transcribe. Uses AudioContext + ScriptProcessor
 * to get raw samples — no MediaRecorder, no Android beeping.
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

let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let stream: MediaStream | null = null;
let socket: VoiceCaptureSocket | null = null;
let callbacks: VoiceCaptureCallbacks | null = null;
let active = false;
let paused = false;

let transcriptHandler: ((data: unknown) => void) | null = null;

/** Downsample Float32 audio from source rate to 16kHz and convert to 16-bit PCM. */
const float32To16kPCM = (input: Float32Array, sourceSampleRate: number): Buffer | ArrayBuffer => {
  const ratio = sourceSampleRate / 16000;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    const sample = Math.max(-1, Math.min(1, input[srcIndex]));
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
  }
  return output.buffer;
};

const isSupported = (): boolean => {
  if (typeof window === 'undefined') return false;
  return !!(navigator.mediaDevices?.getUserMedia) && !!(window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext);
};

const isActive = (): boolean => active && !paused;

const start = async (
  sock: VoiceCaptureSocket,
  cbs: VoiceCaptureCallbacks,
): Promise<boolean> => {
  if (!isSupported()) return false;

  stop();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    cbs.onError?.(`Microphone access denied: ${err}`);
    return false;
  }

  socket = sock;
  callbacks = cbs;

  const AudioContextCtor = window.AudioContext || (window as unknown as Record<string, unknown>).webkitAudioContext as typeof AudioContext;
  audioContext = new AudioContextCtor();
  sourceNode = audioContext.createMediaStreamSource(stream);

  // ScriptProcessor with 4096 buffer (~93ms at 44.1kHz)
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);

  processorNode.onaudioprocess = (e: AudioProcessingEvent) => {
    if (!active || paused || !socket) return;

    const inputData = e.inputBuffer.getChannelData(0);
    const pcmBuffer = float32To16kPCM(inputData, audioContext!.sampleRate);
    socket.emit('voice_stt_chunk', pcmBuffer);
  };

  sourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination);

  // Listen for server transcription results
  transcriptHandler = (data: unknown) => {
    const d = data as { text?: string };
    if (d?.text && callbacks) {
      callbacks.onTranscript(d.text);
    }
  };
  socket.on('voice_stt_transcript', transcriptHandler);

  active = true;
  paused = false;
  socket.emit('voice_stt_start', { encoding: 'pcm', sampleRate: 16000 });
  cbs.onStart?.();
  return true;
};

const pause = (): void => {
  paused = true;
};

const resume = (): void => {
  paused = false;
};

const stop = (): void => {
  active = false;
  paused = false;

  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
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
    socket = null;
  }

  const cbs = callbacks;
  callbacks = null;
  cbs?.onEnd?.();
};

export { start, stop, pause, resume, isActive, isSupported };
export type { VoiceCaptureCallbacks };
