import Boom from '@hapi/boom';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import type { VoiceId, Engine } from '@aws-sdk/client-polly';

import Data from '../../data';
import elevenlabsAdapter from '../../adapters/elevenlabs';

type TTSResult = {
  buffer: Buffer;
  format: 'wav' | 'mp3';
};

const getPollyClient = () => new PollyClient({ region: process.env.AWS_REGION || 'us-east-2' });

/** Create a WAV header for raw PCM data */
const createWavHeader = (pcmLength: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer => {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
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
 * Generate TTS audio for an FFXIVoices user.
 * Routes to ElevenLabs (MP3) for voices prefixed with "el:", otherwise Polly (WAV).
 */
const generateTTS = async (
  userId: string,
  text: string,
  voiceId?: string,
): Promise<TTSResult> => {
  const user = await Data.ffxivUser.findById(userId);
  if (!user) throw Boom.notFound('User not found');
  if (user.credit_balance <= 0) throw Boom.paymentRequired('Insufficient credits');

  const selectedVoice = voiceId || user.voice_id || 'Joanna';

  if (selectedVoice.startsWith('el:')) {
    // ElevenLabs premium voice — returns MP3 (PCM requires Pro tier)
    const elVoiceId = selectedVoice.substring(3);
    const mp3Buffer = await elevenlabsAdapter.generateSpeechMp3(text.trim(), elVoiceId);

    const creditCost = Math.max(1, Math.ceil(text.length / 50) * 3);
    await Data.ffxivUser.deductCredits(user.id, creditCost);

    return { buffer: mp3Buffer, format: 'mp3' };
  } else {
    // Polly free voice — returns WAV
    const client = getPollyClient();
    const command = new SynthesizeSpeechCommand({
      Text: text.trim(),
      VoiceId: selectedVoice as VoiceId,
      OutputFormat: 'pcm',
      SampleRate: '16000',
      Engine: 'standard' as Engine,
    });

    const response = await client.send(command);
    if (!response.AudioStream) throw new Error('Polly returned no audio stream');

    const chunks: Uint8Array[] = [];
    const stream = response.AudioStream as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    const pcmBuffer = Buffer.concat(chunks);
    const wavHeader = createWavHeader(pcmBuffer.length, 16000, 1, 16);
    const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);

    const creditCost = Math.max(1, Math.ceil(text.length / 50));
    await Data.ffxivUser.deductCredits(user.id, creditCost);

    return { buffer: wavBuffer, format: 'wav' };
  }
};

export { generateTTS };
