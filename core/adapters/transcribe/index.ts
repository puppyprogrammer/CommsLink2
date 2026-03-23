import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from '@aws-sdk/client-transcribe-streaming';
import type { LanguageCode, MediaEncoding } from '@aws-sdk/client-transcribe-streaming';

const getClient = (): TranscribeStreamingClient =>
  new TranscribeStreamingClient({ region: process.env.AWS_REGION || 'us-east-2' });

type TranscribeSession = {
  pushChunk: (chunk: Buffer) => void;
  end: () => void;
};

/**
 * Start a real-time transcription session.
 * Audio chunks are pushed as they arrive.
 * Calls onTranscript with each final transcript segment.
 */
const startSession = (
  onTranscript: (text: string) => void,
  onError: (err: Error) => void,
  languageCode?: string,
): TranscribeSession => {
  const client = getClient();
  const chunks: Buffer[] = [];
  let ended = false;
  let resolveWait: (() => void) | null = null;

  // Async generator that yields chunks as they arrive
  async function* audioStream(): AsyncGenerator<{ AudioEvent: { AudioChunk: Buffer } }> {
    while (!ended || chunks.length > 0) {
      if (chunks.length > 0) {
        const chunk = chunks.shift()!;
        yield { AudioEvent: { AudioChunk: chunk } };
      } else {
        // Wait for more chunks
        await new Promise<void>((resolve) => { resolveWait = resolve; });
        resolveWait = null;
      }
    }
  }

  const command = new StartStreamTranscriptionCommand({
    LanguageCode: (languageCode || 'en-US') as LanguageCode,
    MediaEncoding: 'pcm' as MediaEncoding,
    MediaSampleRateHertz: 16000,
    AudioStream: audioStream(),
  });

  // Start the streaming session in the background
  client.send(command).then(async (response) => {
    if (!response.TranscriptResultStream) return;
    for await (const event of response.TranscriptResultStream) {
      if (event.TranscriptEvent?.Transcript?.Results) {
        for (const result of event.TranscriptEvent.Transcript.Results) {
          if (!result.IsPartial && result.Alternatives?.[0]?.Transcript) {
            onTranscript(result.Alternatives[0].Transcript);
          }
        }
      }
    }
  }).catch((err) => {
    if (!ended) onError(err);
  });

  return {
    pushChunk: (chunk: Buffer) => {
      if (ended) return;
      chunks.push(chunk);
      if (resolveWait) resolveWait();
    },
    end: () => {
      ended = true;
      if (resolveWait) resolveWait();
    },
  };
};

export type { TranscribeSession };
export default { startSession };
