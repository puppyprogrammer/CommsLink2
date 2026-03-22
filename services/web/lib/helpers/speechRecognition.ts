const LOCALE_MAP: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
  he: 'he-IL',
  lo: 'lo-LA',
};

type RecognitionCallbacks = {
  onResult: (transcript: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
};

let activeRecognition: SpeechRecognition | null = null;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let paused = false;
let pausedCallbacks: RecognitionCallbacks | null = null;
let pausedLanguage: string = 'en';
let pausedContinuous: boolean = true;

const isSupported = (): boolean =>
  typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

const start = (language: string, continuous: boolean, callbacks: RecognitionCallbacks): boolean => {
  if (!isSupported()) return false;

  paused = false;
  pausedCallbacks = null;
  stop();

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognitionCtor();

  recognition.lang = LOCALE_MAP[language] || 'en-US';
  recognition.continuous = true; // Always keep session alive as long as possible
  recognition.interimResults = true; // Keep the session open longer between phrases

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    const lastResult = event.results[event.results.length - 1];
    if (lastResult.isFinal) {
      callbacks.onResult(lastResult[0].transcript);
    }
  };

  recognition.onstart = () => callbacks.onStart?.();

  recognition.onend = () => {
    // If paused (audio playing), do NOT restart or fire onEnd — we'll resume later
    if (paused) return;

    if (continuous && activeRecognition === recognition) {
      // Silently restart after a delay to avoid rapid cycling and system beeps
      restartTimer = setTimeout(() => {
        if (activeRecognition === recognition && !paused) {
          try {
            recognition.start();
          } catch {
            activeRecognition = null;
            callbacks.onEnd?.();
          }
        }
      }, 1000);
      return;
    }
    activeRecognition = null;
    callbacks.onEnd?.();
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    // In continuous mode, silently ignore transient errors
    if (continuous && (event.error === 'no-speech' || event.error === 'aborted')) return;
    activeRecognition = null;
    callbacks.onError?.(event.error);
    callbacks.onEnd?.();
  };

  activeRecognition = recognition;
  pausedLanguage = language;
  pausedContinuous = continuous;
  pausedCallbacks = callbacks;
  recognition.start();
  callbacks.onStart?.();
  return true;
};

const pause = () => {
  if (!activeRecognition) return;
  paused = true;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  // Stop the recognition but keep activeRecognition set so we know to resume
  try {
    activeRecognition.stop();
  } catch {
    // Already stopped
  }
};

const resume = () => {
  if (!paused) return;
  paused = false;
  // Restart recognition with the same settings
  if (pausedCallbacks) {
    start(pausedLanguage, pausedContinuous, pausedCallbacks);
  }
};

const stop = () => {
  paused = false;
  pausedCallbacks = null;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (activeRecognition) {
    const ref = activeRecognition;
    activeRecognition = null;
    ref.stop();
  }
};

const isActive = (): boolean => activeRecognition !== null;

export { start, stop, pause, resume, isSupported, isActive };
