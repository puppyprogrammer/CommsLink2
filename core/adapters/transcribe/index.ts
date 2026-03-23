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

type TranscribeCallbacks = {
  onTranscript: (text: string) => void;
  onPartial?: (text: string) => void;
  onError: (err: Error) => void;
};

/**
 * Start a real-time transcription session.
 * Audio chunks are pushed as they arrive.
 * Calls onTranscript with each final transcript segment.
 * If speech continues for >5s without a final result, flushes the partial.
 */
const startSession = (
  callbacks: TranscribeCallbacks,
  languageCode?: string,
): TranscribeSession => {
  const client = getClient();
  const chunks: Buffer[] = [];
  let ended = false;
  let resolveWait: (() => void) | null = null;
  let lastPartial = '';
  let lastFinalTime = Date.now();
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  async function* audioStream(): AsyncGenerator<{ AudioEvent: { AudioChunk: Buffer } }> {
    while (!ended || chunks.length > 0) {
      if (chunks.length > 0) {
        const chunk = chunks.shift()!;
        yield { AudioEvent: { AudioChunk: chunk } };
      } else {
        await new Promise<void>((resolve) => { resolveWait = resolve; });
        resolveWait = null;
      }
    }
  }

  // Flush partial transcript if no final result in 5 seconds
  flushTimer = setInterval(() => {
    if (lastPartial && Date.now() - lastFinalTime > 5000) {
      callbacks.onTranscript(lastPartial);
      lastPartial = '';
      lastFinalTime = Date.now();
    }
  }, 2000);

  const command = new StartStreamTranscriptionCommand({
    LanguageCode: (languageCode || 'en-US') as LanguageCode,
    MediaEncoding: 'pcm' as MediaEncoding,
    MediaSampleRateHertz: 16000,
    AudioStream: audioStream(),
  });

  client.send(command).then(async (response) => {
    if (!response.TranscriptResultStream) return;
    for await (const event of response.TranscriptResultStream) {
      if (event.TranscriptEvent?.Transcript?.Results) {
        for (const result of event.TranscriptEvent.Transcript.Results) {
          const text = result.Alternatives?.[0]?.Transcript;
          if (!text) continue;

          if (result.IsPartial) {
            lastPartial = text;
            callbacks.onPartial?.(text);
          } else {
            lastPartial = '';
            lastFinalTime = Date.now();
            callbacks.onTranscript(text);
          }
        }
      }
    }
  }).catch((err) => {
    if (!ended) callbacks.onError(err);
  });

  return {
    pushChunk: (chunk: Buffer) => {
      if (ended) return;
      chunks.push(chunk);
      if (resolveWait) resolveWait();
    },
    end: () => {
      ended = true;
      if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
      // Flush any remaining partial
      if (lastPartial) {
        callbacks.onTranscript(lastPartial);
        lastPartial = '';
      }
      if (resolveWait) resolveWait();
    },
  };
};

export type { TranscribeSession };
export default { startSession };
