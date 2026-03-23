const getApiKey = (): string => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY environment variable is required');
  return key;
};

/**
 * Generate speech as MP3 buffer using ElevenLabs TTS.
 * output_format must be a URL query param, NOT in the JSON body.
 * Returns MP3 audio (mp3_44100_128 — available on all tiers).
 */
const generateSpeechMp3 = async (text: string, voiceId: string): Promise<Buffer> => {
  const apiKey = getApiKey();

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const mp3Buffer = Buffer.from(arrayBuffer);

  console.log(`[ElevenLabs] MP3 response: ${mp3Buffer.length} bytes, first 4 bytes: ${mp3Buffer.subarray(0, 4).toString('hex')}`);

  return mp3Buffer;
};

/**
 * List available ElevenLabs voices.
 */
const listVoices = async (): Promise<{ voice_id: string; name: string }[]> => {
  const apiKey = getApiKey();

  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    method: 'GET',
    headers: { 'xi-api-key': apiKey },
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs listVoices failed (${response.status})`);
  }

  const data = await response.json() as { voices: { voice_id: string; name: string }[] };
  return (data.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name }));
};

export { getApiKey };
export default { generateSpeechMp3, listVoices };
