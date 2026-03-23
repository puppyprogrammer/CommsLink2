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
 * Sends finalized transcript segments via onTranscript.
 * Forces a flush every ~5s during continuous speech so monologues
 * don't buffer forever.
 */
const startSession = (
  callbacks: TranscribeCallbacks,
  languageCode?: string,
): TranscribeSession => {
  const client = getClient();
  const chunks: Buffer[] = [];
  let ended = false;
  let resolveWait: (() => void) | null = null;

  // Track what we already sent to avoid duplicates
  let lastSentText = '';
  let lastPartial = '';
  let lastFinalTime = Date.now();
  let flushTimer: ReturnType<typeof setInterval> | null = null;

  const emitTranscript = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    // If this text starts with what we already sent, only send the new part
    if (lastSentText && trimmed.toLowerCase().startsWith(lastSentText.toLowerCase())) {
      const newPart = trimmed.slice(lastSentText.length).trim();
      if (!newPart) return; // Nothing new
      lastSentText = trimmed;
      callbacks.onTranscript(newPart);
    } else {
      lastSentText = trimmed;
      callbacks.onTranscript(trimmed);
    }
  };

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

  // Flush partial every 5s during continuous speech
  flushTimer = setInterval(() => {
    if (lastPartial && Date.now() - lastFinalTime > 5000) {
      emitTranscript(lastPartial);
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
            emitTranscript(text);
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
      if (lastPartial) {
        emitTranscript(lastPartial);
        lastPartial = '';
      }
      if (resolveWait) resolveWait();
    },
  };
};

export type { TranscribeSession };
export default { startSession };
