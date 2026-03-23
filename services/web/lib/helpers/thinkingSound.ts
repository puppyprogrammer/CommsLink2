/**
 * Subtle pulsing tone that plays while AI is thinking/typing.
 * Uses Web Audio API — no sound files needed.
 */

let audioCtx: AudioContext | null = null;
let oscillator: OscillatorNode | null = null;
let gainNode: GainNode | null = null;
let pulseInterval: ReturnType<typeof setInterval> | null = null;
let active = false;

const getContext = (): AudioContext => {
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as unknown as Record<string, typeof AudioContext>).webkitAudioContext;
    audioCtx = new Ctor();
  }
  return audioCtx;
};

/**
 * Start a gentle pulsing tone indicating the AI is thinking.
 * Soft, non-intrusive — a quiet "boop...boop...boop" pulse.
 */
const startThinking = (): void => {
  if (active) return;
  active = true;

  try {
    const ctx = getContext();

    gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(ctx.destination);

    oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = 440; // A4 — soft and pleasant
    oscillator.connect(gainNode);
    oscillator.start();

    // Pulse: fade in and out every 1.5 seconds
    let pulseUp = true;
    pulseInterval = setInterval(() => {
      if (!gainNode || !active) return;
      const now = ctx.currentTime;
      if (pulseUp) {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0.03, now + 0.3); // Very quiet
      } else {
        gainNode.gain.cancelScheduledValues(now);
        gainNode.gain.setValueAtTime(gainNode.gain.value, now);
        gainNode.gain.linearRampToValueAtTime(0, now + 0.3);
      }
      pulseUp = !pulseUp;
    }, 750);
  } catch {
    // Audio context not available
    active = false;
  }
};

/**
 * Stop the thinking sound.
 */
const stopThinking = (): void => {
  active = false;

  if (pulseInterval) {
    clearInterval(pulseInterval);
    pulseInterval = null;
  }

  if (gainNode) {
    try {
      const now = audioCtx?.currentTime || 0;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      gainNode.gain.linearRampToValueAtTime(0, now + 0.15);
    } catch { /* ignore */ }
  }

  // Clean up after fade out
  setTimeout(() => {
    if (oscillator) {
      try { oscillator.stop(); } catch { /* ignore */ }
      oscillator = null;
    }
    if (gainNode) {
      try { gainNode.disconnect(); } catch { /* ignore */ }
      gainNode = null;
    }
  }, 200);
};

const isThinking = (): boolean => active;

export { startThinking, stopThinking, isThinking };
