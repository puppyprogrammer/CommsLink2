/**
 * Alarm sound generator.
 *
 * Generates a loud, startling alarm tone as a WAV data URL
 * and plays it in a loop using the HTML Audio element.
 * This avoids AudioContext autoplay restrictions because
 * Audio elements work as long as the page has had any user interaction.
 */

let alarmAudio: HTMLAudioElement | null = null;

/**
 * Generate a WAV data URL containing a harsh alarm siren.
 * Two-tone alternating beep pattern at max volume.
 */
const generateAlarmWav = (): string => {
  const sampleRate = 44100;
  const duration = 2; // 2 seconds, will be looped
  const numSamples = sampleRate * duration;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Generate alarm tone: alternating 880Hz and 660Hz beeps
  // with sharp attack for startling effect
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Alternate every 0.25 seconds between high and low tone
    const cyclePos = t % 0.5;
    const freq = cyclePos < 0.25 ? 880 : 660;
    // Square-ish wave (clipped sine) for harsh sound
    let sample = Math.sin(2 * Math.PI * freq * t);
    // Add harmonics for harshness
    sample += 0.5 * Math.sin(2 * Math.PI * freq * 2 * t);
    sample += 0.3 * Math.sin(2 * Math.PI * freq * 3 * t);
    // Clip to create distortion (louder, more startling)
    sample = Math.max(-1, Math.min(1, sample * 1.5));
    // Sharp on/off envelope for beep effect (20ms gaps)
    const beepCycle = t % 0.25;
    if (beepCycle > 0.22) sample = 0; // 30ms silence gap
    // Convert to 16-bit PCM at max volume
    const pcm = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    view.setInt16(44 + i * 2, pcm, true);
  }

  // Convert to base64 data URL
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return 'data:audio/wav;base64,' + btoa(binary);
};

// Pre-generate the alarm WAV
let alarmDataUrl: string | null = null;
const getAlarmDataUrl = (): string => {
  if (!alarmDataUrl) alarmDataUrl = generateAlarmWav();
  return alarmDataUrl;
};

/**
 * Start playing the alarm sound in a loop at maximum volume.
 */
const startAlarm = (): void => {
  stopAlarm();
  try {
    const audio = new Audio(getAlarmDataUrl());
    audio.loop = true;
    audio.volume = 1.0; // Max volume always
    audio.play().catch(() => {
      // Autoplay blocked — will be silent but overlay still shows
      console.warn('[Alarm] Audio playback blocked by browser');
    });
    alarmAudio = audio;
  } catch {
    console.warn('[Alarm] Failed to create audio');
  }
};

/**
 * Stop the alarm sound.
 */
const stopAlarm = (): void => {
  if (alarmAudio) {
    alarmAudio.pause();
    alarmAudio.currentTime = 0;
    alarmAudio = null;
  }
};

export { startAlarm, stopAlarm };
