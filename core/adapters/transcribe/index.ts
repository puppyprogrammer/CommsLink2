import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
} from '@aws-sdk/client-transcribe-streaming';

const getClient = (): TranscribeStreamingClient =>
  new TranscribeStreamingClient({ region: process.env.AWS_REGION || 'us-east-2' });

/**
 * Async generator that yields audio chunks as AudioEvent payloads
 * for the Transcribe Streaming API.
 */
async function* audioStream(
  audioChunks: Buffer[],
): AsyncGenerator<{ AudioEvent: { AudioChunk: Buffer } }> {
  for (const chunk of audioChunks) {
    yield { AudioEvent: { AudioChunk: chunk } };
  }
}

/**
 * Transcribe accumulated PCM audio buffers (16-bit, 16kHz mono) using
 * Amazon Transcribe Streaming. Returns the final concatenated transcript.
 */
const transcribeStream = async (
  audioChunks: Buffer[],
  languageCode?: string,
): Promise<string> => {
  const client = getClient();

  const command = new StartStreamTranscriptionCommand({
    LanguageCode: languageCode || 'en-US',
    MediaEncoding: 'pcm',
    MediaSampleRateHertz: 16000,
    AudioStream: audioStream(audioChunks),
  });

  const response = await client.send(command);

  const transcriptParts: string[] = [];

  if (response.TranscriptResultStream) {
    for await (const event of response.TranscriptResultStream) {
      if (event.TranscriptEvent?.Transcript?.Results) {
        for (const result of event.TranscriptEvent.Transcript.Results) {
          // Only use final (non-partial) results
          if (!result.IsPartial && result.Alternatives && result.Alternatives.length > 0) {
            const transcript = result.Alternatives[0].Transcript;
            if (transcript) {
              transcriptParts.push(transcript);
            }
          }
        }
      }
    }
  }

  return transcriptParts.join(' ');
};

export default { transcribeStream };
