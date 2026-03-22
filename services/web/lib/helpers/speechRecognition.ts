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
let lastSpeechTime = 0;

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
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    lastSpeechTime = Date.now();
    const lastResult = event.results[event.results.length - 1];
    if (lastResult.isFinal) {
      callbacks.onResult(lastResult[0].transcript);
    }
  };

  recognition.onstart = () => callbacks.onStart?.();

  recognition.onend = () => {
    if (paused) return;

    if (continuous && activeRecognition === recognition) {
      // Only auto-restart if user was recently speaking (within last 30 seconds)
      // Otherwise let it stay quiet — no beep
      const silenceDuration = Date.now() - lastSpeechTime;
      if (silenceDuration < 30000) {
        restartTimer = setTimeout(() => {
          if (activeRecognition === recognition && !paused) {
            try {
              recognition.start();
            } catch {
              activeRecognition = null;
              callbacks.onEnd?.();
            }
          }
        }, 2000);
        return;
      }
      // Long silence — stop gracefully, no beep, no restart
      // But keep activeRecognition set so isActive() still returns true
      // User can tap mic to restart
    }
    activeRecognition = null;
    callbacks.onEnd?.();
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (continuous && (event.error === 'no-speech' || event.error === 'aborted')) return;
    activeRecognition = null;
    callbacks.onError?.(event.error);
    callbacks.onEnd?.();
  };

  activeRecognition = recognition;
  pausedLanguage = language;
  pausedContinuous = continuous;
  pausedCallbacks = callbacks;
  lastSpeechTime = Date.now();
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
  try {
    activeRecognition.stop();
  } catch {
    // Already stopped
  }
};

const resume = () => {
  if (!paused) return;
  paused = false;
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
