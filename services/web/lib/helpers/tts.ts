type VoiceAvatar = 'male' | 'female' | 'robot';

type TTSOptions = {
  voiceAvatar: VoiceAvatar;
  volume: number;
};

type QueueItem =
  | { kind: 'utterance'; utterance: SpeechSynthesisUtterance }
  | { kind: 'audio'; base64: string; volume: number };

const queue: QueueItem[] = [];
let isPlaying = false;
let currentAudio: HTMLAudioElement | null = null;
let cachedVoices: SpeechSynthesisVoice[] = [];
let onPlayingChange: ((playing: boolean) => void) | null = null;

const LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
  he: 'he-IL',
  lo: 'lo-LA',
};

// Windows/Chrome/Edge female voice name substrings
const FEMALE_PATTERNS = [
  'zira',
  'samantha',
  'victoria',
  'karen',
  'susan',
  'hazel',
  'linda',
  'jenny',
  'aria',
  'sonia',
  'helena',
  'catherine',
  'heera',
  'sabina',
  'female',
];
// Windows/Chrome/Edge male voice name substrings
const MALE_PATTERNS = ['david', 'mark', 'james', 'richard', 'george', 'daniel', 'guy', 'ryan', 'ravi', 'sean', 'male'];

const loadVoices = (): SpeechSynthesisVoice[] => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  const voices = speechSynthesis.getVoices();
  if (voices.length > 0) cachedVoices = voices;
  return cachedVoices;
};

const matchesPatterns = (name: string, patterns: string[]): boolean => {
  const lower = name.toLowerCase();
  return patterns.some((p) => lower.includes(p));
};

const getVoiceForAvatar = (avatar: VoiceAvatar, lang: string): SpeechSynthesisVoice | null => {
  const voices = loadVoices();
  if (voices.length === 0) return null;

  const locale = LOCALE_MAP[lang] || 'en-US';
  const langPrefix = lang.split('-')[0];

  // Get voices matching the language, then all voices as fallback
  const langVoices = voices.filter((v) => v.lang === locale || v.lang.startsWith(langPrefix));

  if (avatar === 'female') {
    // Try language-specific female voice first, then any female voice
    return (
      langVoices.find((v) => matchesPatterns(v.name, FEMALE_PATTERNS)) ||
      voices.find((v) => matchesPatterns(v.name, FEMALE_PATTERNS)) ||
      langVoices[1] ||
      null
    );
  }

  if (avatar === 'male') {
    return (
      langVoices.find((v) => matchesPatterns(v.name, MALE_PATTERNS)) ||
      voices.find((v) => matchesPatterns(v.name, MALE_PATTERNS)) ||
      langVoices[0] ||
      null
    );
  }

  // Robot: use any voice, modifications applied via pitch/rate
  return langVoices[0] || voices[0] || null;
};

const setPlaying = (value: boolean) => {
  if (isPlaying !== value) {
    isPlaying = value;
    onPlayingChange?.(value);
  }
};

const processQueue = () => {
  if (isPlaying || queue.length === 0) {
    if (!isPlaying && queue.length === 0) setPlaying(false);
    return;
  }

  setPlaying(true);
  const item = queue.shift()!;

  const done = () => {
    isPlaying = false;
    currentAudio = null;
    processQueue();
  };

  if (item.kind === 'utterance') {
    item.utterance.onend = done;
    item.utterance.onerror = done;
    speechSynthesis.speak(item.utterance);
  } else {
    const audio = new Audio(`data:audio/mpeg;base64,${item.base64}`);
    audio.volume = item.volume;
    currentAudio = audio;
    audio.onended = done;
    audio.onerror = done;
    audio.play().catch(done);
  }
};

const speak = (text: string, options: TTSOptions, lang: string = 'en') => {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.volume = options.volume;

  const voice = getVoiceForAvatar(options.voiceAvatar, lang);
  if (voice) {
    utterance.voice = voice;
  }

  if (options.voiceAvatar === 'robot') {
    utterance.pitch = 0.1;
    utterance.rate = 0.8;
  } else if (options.voiceAvatar === 'female') {
    utterance.pitch = 1.1;
  }

  queue.push({ kind: 'utterance', utterance });
  processQueue();
};

const playAudioBlob = (base64Audio: string, volume: number = 1.0): void => {
  queue.push({ kind: 'audio', base64: base64Audio, volume });
  processQueue();
};

const stop = () => {
  queue.length = 0;
  currentAudio?.pause();
  currentAudio = null;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
  setPlaying(false);
};

const onPlayStateChange = (cb: (playing: boolean) => void) => {
  onPlayingChange = cb;
};

const getIsPlaying = (): boolean => isPlaying;

// Pre-load voices (Chrome loads them async)
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = () => loadVoices();
}

export { speak, playAudioBlob, stop, onPlayStateChange, getIsPlaying };
export type { VoiceAvatar, TTSOptions };
