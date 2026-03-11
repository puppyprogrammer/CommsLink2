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

const isSupported = (): boolean =>
  typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

const start = (language: string, continuous: boolean, callbacks: RecognitionCallbacks): boolean => {
  if (!isSupported()) return false;

  stop();

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognitionCtor();

  recognition.lang = LOCALE_MAP[language] || 'en-US';
  recognition.continuous = continuous;
  recognition.interimResults = false;

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    const lastResult = event.results[event.results.length - 1];
    if (lastResult.isFinal) {
      callbacks.onResult(lastResult[0].transcript);
    }
  };

  recognition.onstart = () => callbacks.onStart?.();

  recognition.onend = () => {
    if (continuous && activeRecognition === recognition) {
      // Auto-restart in continuous mode
      try {
        recognition.start();
      } catch {
        activeRecognition = null;
        callbacks.onEnd?.();
      }
      return;
    }
    activeRecognition = null;
    callbacks.onEnd?.();
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (event.error === 'no-speech' && continuous) return;
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
  if (activeRecognition) {
    const ref = activeRecognition;
    activeRecognition = null;
    ref.stop();
  }
};

const isActive = (): boolean => activeRecognition !== null;

export { start, stop, isSupported, isActive };
