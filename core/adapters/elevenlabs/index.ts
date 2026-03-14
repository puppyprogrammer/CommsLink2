type ElevenLabsVoice = {
  voice_id: string;
  name: string;
  category: string;
  labels: Record<string, string>;
};

type AlignmentData = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

type SpeechResult = {
  audioBase64: string;
  alignment: AlignmentData | null;
};

const getApiKey = (): string => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key)
    throw new Error("ELEVENLABS_API_KEY environment variable is required");
  return key;
};

/**
 * Generate speech audio from text.
 *
 * @param text    - Text to synthesize.
 * @param voiceId - ElevenLabs voice ID.
 * @returns Base64 audio and alignment data.
 */
const generateSpeech = async (
  text: string,
  voiceId: string,
): Promise<SpeechResult> => {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`,
    {
      method: "POST",
      headers: {
        "xi-api-key": getApiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: text.trim(),
        model_id: "eleven_multilingual_v2",
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`ElevenLabs API error: ${response.statusText}`);
  }

  const data = (await response.json()) as {
    audio_base64: string;
    alignment?: AlignmentData;
  };

  return {
    audioBase64: data.audio_base64,
    alignment: data.alignment ?? null,
  };
};

/**
 * List available voices.
 *
 * @returns Array of voice objects.
 */
const listVoices = async (): Promise<ElevenLabsVoice[]> => {
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": getApiKey() },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch ElevenLabs voices");
  }

  const data = (await response.json()) as { voices: ElevenLabsVoice[] };
  return data.voices;
};

export type { ElevenLabsVoice, SpeechResult, AlignmentData };
export default { generateSpeech, listVoices };
