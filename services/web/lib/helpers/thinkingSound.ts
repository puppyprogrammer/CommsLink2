/**
 * Ethereal whisper effect while AI is thinking.
 * Layered filtered noise at different frequencies creates
 * a hushed, breathy whisper that fades in and out.
 */

let audioCtx: AudioContext | null = null;
let sources: AudioBufferSourceNode[] = [];
let gains: GainNode[] = [];
let masterGain: GainNode | null = null;
let pulseInterval: ReturnType<typeof setInterval> | null = null;
let active = false;

const getContext = (): AudioContext => {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
};

const createNoiseBuffer = (ctx: AudioContext, seconds: number): AudioBuffer => {
  const length = ctx.sampleRate * seconds;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    // Shape the noise to sound more like breath — emphasize low frequencies
    data[i] = (Math.random() * 2 - 1) * (0.3 + Math.random() * 0.2);
  }
  return buffer;
};

/** Create a whisper layer — filtered noise at a specific frequency range */
const createWhisperLayer = (
  ctx: AudioContext,
  noiseBuffer: AudioBuffer,
  freq: number,
  q: number,
  type: BiquadFilterType,
): { source: AudioBufferSourceNode; gain: GainNode } => {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;

  const gain = ctx.createGain();
  gain.gain.value = 0;

  source.connect(filter);
  filter.connect(gain);

  return { source, gain };
};

const startThinking = (): void => {
  if (active) return;
  active = true;

  try {
    const ctx = getContext();
    const noiseBuffer = createNoiseBuffer(ctx, 3);

    masterGain = ctx.createGain();
    masterGain.gain.value = 1;
    masterGain.connect(ctx.destination);

    // Layer 1: Low breathy base (like "hhh")
    const layer1 = createWhisperLayer(ctx, noiseBuffer, 400, 0.8, 'bandpass');
    // Layer 2: Mid sibilance (like "sss/shh")
    const layer2 = createWhisperLayer(ctx, noiseBuffer, 2500, 1.2, 'bandpass');
    // Layer 3: High air (like breath through teeth)
    const layer3 = createWhisperLayer(ctx, noiseBuffer, 6000, 0.6, 'highpass');

    [layer1, layer2, layer3].forEach(({ source, gain }) => {
      gain.connect(masterGain!);
      source.start();
      sources.push(source);
      gains.push(gain);
    });

    // Whisper pulse — irregular, organic rhythm like hushed murmuring
    let phase = 0;
    pulseInterval = setInterval(() => {
      if (!active || gains.length === 0) return;
      const now = ctx.currentTime;
      phase++;

      // Vary each layer independently for organic feel
      const breathIn = phase % 2 === 0;
      const intensity = 0.02 + Math.random() * 0.015; // Slight randomness

      // Base breath
      gains[0].gain.cancelScheduledValues(now);
      gains[0].gain.setValueAtTime(gains[0].gain.value, now);
      gains[0].gain.linearRampToValueAtTime(breathIn ? intensity : 0.003, now + (breathIn ? 0.4 : 0.6));

      // Sibilance — slightly delayed, quieter
      gains[1].gain.cancelScheduledValues(now);
      gains[1].gain.setValueAtTime(gains[1].gain.value, now);
      gains[1].gain.linearRampToValueAtTime(breathIn ? intensity * 0.4 : 0.001, now + (breathIn ? 0.5 : 0.5));

      // High air — sparse, only on some pulses
      if (phase % 3 === 0) {
        gains[2].gain.cancelScheduledValues(now);
        gains[2].gain.setValueAtTime(gains[2].gain.value, now);
        gains[2].gain.linearRampToValueAtTime(breathIn ? intensity * 0.2 : 0, now + 0.3);
      }
    }, 800 + Math.random() * 400); // Irregular timing

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

  // Fade out smoothly
  if (masterGain && audioCtx) {
    try {
      const now = audioCtx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0, now + 0.5);
    } catch { /* ignore */ }
  }

  setTimeout(() => {
    sources.forEach((s) => { try { s.stop(); } catch { /* */ } });
    sources = [];
    gains.forEach((g) => { try { g.disconnect(); } catch { /* */ } });
    gains = [];
    if (masterGain) { try { masterGain.disconnect(); } catch { /* */ } masterGain = null; }
  }, 600);
};

const isThinking = (): boolean => active;

export { startThinking, stopThinking, isThinking };
