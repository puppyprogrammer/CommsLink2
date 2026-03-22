import { PollyClient, SynthesizeSpeechCommand, DescribeVoicesCommand, Engine } from '@aws-sdk/client-polly';

type PollyVoice = {
  voice_id: string;
  name: string;
};

type SpeechResult = {
  audioBase64: string;
};

const getClient = (): PollyClient =>
  new PollyClient({ region: process.env.AWS_REGION || 'us-east-2' });

/**
 * Generate speech audio from text using Amazon Polly.
 *
 * @param text    - Text to synthesize.
 * @param voiceId - Polly voice ID (e.g. "Joanna", "Matthew").
 * @returns Base64 audio (mp3).
 */
const generateSpeech = async (
  text: string,
  voiceId: string,
): Promise<SpeechResult> => {
  const client = getClient();

  const command = new SynthesizeSpeechCommand({
    Text: text.trim(),
    VoiceId: voiceId as unknown as import('@aws-sdk/client-polly').VoiceId,
    OutputFormat: 'mp3',
    Engine: 'neural' as Engine,
  });

  const response = await client.send(command);

  if (!response.AudioStream) {
    throw new Error('Polly returned no audio stream');
  }

  // Convert stream to base64
  const chunks: Uint8Array[] = [];
  const stream = response.AudioStream as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  const audioBase64 = buffer.toString('base64');

  return { audioBase64 };
};

/**
 * List available Polly neural voices (English).
 *
 * @returns Array of voice objects.
 */
const listVoices = async (): Promise<PollyVoice[]> => {
  const client = getClient();

  const command = new DescribeVoicesCommand({
    Engine: 'neural' as Engine,
    LanguageCode: 'en-US',
  });

  const response = await client.send(command);

  return (response.Voices || []).map((v) => ({
    voice_id: v.Id || '',
    name: v.Name || v.Id || '',
  }));
};

export type { PollyVoice, SpeechResult };
export default { generateSpeech, listVoices };
