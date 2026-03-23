/**
 * Thinking indicator sound — soft ethereal chime/hum.
 * Two detuned sine waves with slow tremolo creates a dreamy,
 * mystical hum like a crystal resonating.
 */

let audioCtx: AudioContext | null = null;
let osc1: OscillatorNode | null = null;
let osc2: OscillatorNode | null = null;
let masterGain: GainNode | null = null;
let tremoloGain: GainNode | null = null;
let lfo: OscillatorNode | null = null;
let active = false;

const getContext = (): AudioContext => {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
};

const startThinking = (): void => {
  if (active) return;
  active = true;

  try {
    const ctx = getContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);

    // Two slightly detuned sine waves = ethereal shimmer
    osc1 = ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 220; // A3

    osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 223; // Slightly detuned — creates slow beating/shimmer

    // Tremolo LFO — slow wobble
    tremoloGain = ctx.createGain();
    tremoloGain.gain.value = 0.5;

    lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.5; // 0.5 Hz tremolo — one pulse per 2 seconds
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain);
    lfoGain.connect(tremoloGain.gain);

    osc1.connect(tremoloGain);
    osc2.connect(tremoloGain);
    tremoloGain.connect(masterGain);

    osc1.start();
    osc2.start();
    lfo.start();

    // Fade in gently
    const now = ctx.currentTime;
    masterGain.gain.setValueAtTime(0, now);
    masterGain.gain.linearRampToValueAtTime(0.03, now + 1.5);

  } catch {
    active = false;
  }
};

const stopThinking = (): void => {
  active = false;

  if (masterGain && audioCtx) {
    try {
      const now = audioCtx.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0, now + 0.8);
    } catch { /* ignore */ }
  }

  setTimeout(() => {
    [osc1, osc2, lfo].forEach((o) => { if (o) try { o.stop(); } catch { /* */ } });
    osc1 = null; osc2 = null; lfo = null;
    [tremoloGain, masterGain].forEach((g) => { if (g) try { g.disconnect(); } catch { /* */ } });
    tremoloGain = null; masterGain = null;
  }, 900);
};

const isThinking = (): boolean => active;

export { startThinking, stopThinking, isThinking };
