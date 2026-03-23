const getApiKey = (): string => {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY environment variable is required');
  return key;
};

const createWavHeader = (pcmLength: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer => {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmLength, 40);
  return header;
};

/**
 * Generate speech as a WAV buffer using ElevenLabs TTS.
 *
 * @param text - Text to synthesize.
 * @param voiceId - ElevenLabs voice ID.
 * @returns Complete WAV buffer (44-byte header + PCM data).
 */
const generateSpeechWav = async (text: string, voiceId: string): Promise<Buffer> => {
  const apiKey = getApiKey();

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      output_format: 'pcm_44100',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const srcBuffer = Buffer.from(arrayBuffer);

  // Downsample from 44100Hz to 16000Hz (signed 16-bit LE samples)
  const srcSampleRate = 44100;
  const dstSampleRate = 16000;
  const ratio = srcSampleRate / dstSampleRate;
  const srcSamples = srcBuffer.length / 2; // 16-bit = 2 bytes per sample
  const dstSamples = Math.floor(srcSamples / ratio);
  const pcmData = Buffer.alloc(dstSamples * 2);
  for (let i = 0; i < dstSamples; i++) {
    const srcIndex = Math.floor(i * ratio) * 2;
    if (srcIndex + 1 < srcBuffer.length) {
      pcmData.writeInt16LE(srcBuffer.readInt16LE(srcIndex), i * 2);
    }
  }

  const wavHeader = createWavHeader(pcmData.length, 16000, 1, 16);

  return Buffer.concat([wavHeader, pcmData]);
};

/**
 * List available ElevenLabs voices.
 *
 * @returns Array of voice objects with id and name.
 */
const listVoices = async (): Promise<{ voice_id: string; name: string }[]> => {
  const apiKey = getApiKey();

  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    method: 'GET',
    headers: {
      'xi-api-key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs listVoices failed (${response.status})`);
  }

  const data = await response.json() as { voices: { voice_id: string; name: string }[] };

  return (data.voices || []).map((v) => ({
    voice_id: v.voice_id,
    name: v.name,
  }));
};

export { getApiKey };
export default { generateSpeechWav, listVoices };
