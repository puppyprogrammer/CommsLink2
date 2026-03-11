const VALID_BROWSER_VOICES = ['male', 'female', 'robot'] as const;

const VALID_LANGUAGES = ['en', 'es', 'de', 'he', 'lo'] as const;

type BrowserVoice = (typeof VALID_BROWSER_VOICES)[number];
type SupportedLanguage = (typeof VALID_LANGUAGES)[number];

export { VALID_BROWSER_VOICES, VALID_LANGUAGES };
export type { BrowserVoice, SupportedLanguage };
