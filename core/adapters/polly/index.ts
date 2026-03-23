import { PollyClient, SynthesizeSpeechCommand, DescribeVoicesCommand } from '@aws-sdk/client-polly';
import type { VoiceId, Engine } from '@aws-sdk/client-polly';

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
 * Pick the best engine for a voice. Prefer generative > neural > standard.
 */
const pickEngine = (supportedEngines: string[]): Engine => {
  if (supportedEngines.includes('generative')) return 'generative' as Engine;
  if (supportedEngines.includes('long-form')) return 'long-form' as Engine;
  if (supportedEngines.includes('neural')) return 'neural' as Engine;
  return 'standard' as Engine;
};

// Cache voice -> best engine mapping
const voiceEngineCache = new Map<string, Engine>();

/**
 * Generate speech audio from text using Amazon Polly.
 */
const generateSpeech = async (
  text: string,
  voiceId: string,
): Promise<SpeechResult> => {
  const client = getClient();

  // Determine best engine for this voice
  let engine = voiceEngineCache.get(voiceId);
  if (!engine) {
    // Default to standard, will be updated after first listVoices call
    engine = 'standard' as Engine;
  }

  const command = new SynthesizeSpeechCommand({
    Text: text.trim(),
    VoiceId: voiceId as VoiceId,
    OutputFormat: 'mp3',
    Engine: engine,
  });

  const response = await client.send(command);

  if (!response.AudioStream) {
    throw new Error('Polly returned no audio stream');
  }

  const chunks: Uint8Array[] = [];
  const stream = response.AudioStream as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  return { audioBase64: buffer.toString('base64') };
};

/**
 * List available Polly voices (English US).
 */
const listVoices = async (): Promise<PollyVoice[]> => {
  const client = getClient();

  const command = new DescribeVoicesCommand({
    LanguageCode: 'en-US',
  });

  const response = await client.send(command);

  const voices = (response.Voices || []).map((v) => {
    const engines = (v.SupportedEngines || []) as string[];
    const bestEngine = pickEngine(engines);
    // Cache the best engine for each voice
    if (v.Id) voiceEngineCache.set(v.Id, bestEngine);

    return {
      voice_id: v.Id || '',
      name: `${v.Name || v.Id || ''} (${v.Gender || ''})`,
    };
  });

  return voices;
};

type SentimentInput = {
  sentiment: string;
  scores: {
    positive: number;
    negative: number;
    neutral: number;
    mixed: number;
  };
};

/**
 * Generate speech with optional SSML prosody adjustments based on sentiment.
 * Falls back to regular generateSpeech when no sentiment is provided.
 */
const generateSpeechWithEmotion = async (
  text: string,
  voiceId: string,
  sentiment?: SentimentInput,
): Promise<SpeechResult> => {
  if (!sentiment) {
    return generateSpeech(text, voiceId);
  }

  let useSSML = false;
  let processedText = text.trim();

  if (sentiment.sentiment === 'POSITIVE' && sentiment.scores.positive > 0.7) {
    processedText = `<prosody rate="105%" pitch="+5%">${processedText}</prosody>`;
    useSSML = true;
  } else if (sentiment.sentiment === 'NEGATIVE' && sentiment.scores.negative > 0.7) {
    processedText = `<prosody rate="92%" pitch="-5%">${processedText}</prosody>`;
    useSSML = true;
  }

  if (!useSSML) {
    return generateSpeech(text, voiceId);
  }

  const ssmlText = `<speak>${processedText}</speak>`;

  const client = getClient();

  let engine = voiceEngineCache.get(voiceId);
  if (!engine) {
    engine = 'standard' as Engine;
  }

  const command = new SynthesizeSpeechCommand({
    Text: ssmlText,
    TextType: 'ssml',
    VoiceId: voiceId as VoiceId,
    OutputFormat: 'mp3',
    Engine: engine,
  });

  const response = await client.send(command);

  if (!response.AudioStream) {
    throw new Error('Polly returned no audio stream');
  }

  const chunks: Uint8Array[] = [];
  const stream = response.AudioStream as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);
  return { audioBase64: buffer.toString('base64') };
};

export type { PollyVoice, SpeechResult, SentimentInput };
export default { generateSpeech, generateSpeechWithEmotion, listVoices };
