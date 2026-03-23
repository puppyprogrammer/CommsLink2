/**
 * Soft breathing/shimmer sound while AI is thinking.
 * Uses filtered noise — sounds like gentle "shh...shh...shh".
 */

let audioCtx: AudioContext | null = null;
let noiseSource: AudioBufferSourceNode | null = null;
let gainNode: GainNode | null = null;
let filterNode: BiquadFilterNode | null = null;
let pulseInterval: ReturnType<typeof setInterval> | null = null;
let active = false;

const getContext = (): AudioContext => {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
};

/** Create a buffer of white noise */
const createNoiseBuffer = (ctx: AudioContext, seconds: number): AudioBuffer => {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * seconds;
  const buffer = ctx.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.5;
  }
  return buffer;
};

const startThinking = (): void => {
  if (active) return;
  active = true;

  try {
    const ctx = getContext();

    // Filtered noise → soft shimmer
    const noiseBuffer = createNoiseBuffer(ctx, 2);
    noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    // Bandpass filter to make it warm, not harsh
    filterNode = ctx.createBiquadFilter();
    filterNode.type = 'bandpass';
    filterNode.frequency.value = 800;
    filterNode.Q.value = 0.5;

    gainNode = ctx.createGain();
    gainNode.gain.value = 0;

    noiseSource.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(ctx.destination);
    noiseSource.start();

    // Gentle breathing pulse — fade in/out every 2 seconds
    let pulseUp = true;
    pulseInterval = setInterval(() => {
      if (!gainNode || !active) return;
      const now = ctx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      if (pulseUp) {
        gainNode.gain.linearRampToValueAtTime(0.04, now + 0.6);
      } else {
        gainNode.gain.linearRampToValueAtTime(0.005, now + 0.8);
      }
      pulseUp = !pulseUp;
    }, 1200);
  } catch {
    active = false;
  }
};

const stopThinking = (): void => {
  active = false;

  if (pulseInterval) {
    clearInterval(pulseInterval);
    pulseInterval = null;
  }

  if (gainNode && audioCtx) {
    try {
      const now = audioCtx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + 0.3);
    } catch { /* ignore */ }
  }

  setTimeout(() => {
    if (noiseSource) {
      try { noiseSource.stop(); } catch { /* ignore */ }
      noiseSource = null;
    }
    if (filterNode) {
      try { filterNode.disconnect(); } catch { /* ignore */ }
      filterNode = null;
    }
    if (gainNode) {
      try { gainNode.disconnect(); } catch { /* ignore */ }
      gainNode = null;
    }
  }, 400);
};

const isThinking = (): boolean => active;

export { startThinking, stopThinking, isThinking };
