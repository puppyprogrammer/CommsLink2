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

const isSupported = (): boolean =>
  typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

const start = (language: string, continuous: boolean, callbacks: RecognitionCallbacks): boolean => {
  if (!isSupported()) return false;

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
    if (continuous && activeRecognition === recognition) {
      // Silently restart after a brief delay to avoid rapid cycling and system sounds
      restartTimer = setTimeout(() => {
        if (activeRecognition === recognition) {
          try {
            recognition.start();
          } catch {
            activeRecognition = null;
            callbacks.onEnd?.();
          }
        }
      }, 300);
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
  recognition.start();
  callbacks.onStart?.();
  return true;
};

const stop = () => {
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

export { start, stop, isSupported, isActive };
