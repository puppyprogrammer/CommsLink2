import { Queue, Worker, Job } from 'bullmq';
import { Server as SocketServer } from 'socket.io';
import IORedis from 'ioredis';

import pollyAdapter from '../polly';
import creditActions from '../../actions/credit';

type VoiceChunkJob = {
  sessionId: string;
  chunkIndex: number;
  text: string;
  userId: string;
  voiceId: string;
  roomName: string;
  username: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let queue: Queue | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let worker: Worker | null = null;

const getRedisUrl = (): string => process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Initialize the voice TTS queue and its worker.
 *
 * Each chunk is processed sequentially (concurrency 1) to maintain order.
 * The worker generates TTS audio via Amazon Polly and emits the result
 * back to the room via Socket.IO.
 */
const init = (io: SocketServer): void => {
  const redisUrl = getRedisUrl();

  const queueConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const workerConnection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  queue = new Queue('voice-tts', { connection: queueConnection as never });

  worker = new Worker(
    'voice-tts',
    async (job: Job) => {
      const { sessionId, chunkIndex, text, userId, voiceId, roomName, username } = job.data as VoiceChunkJob;

      if (!text.trim()) return;

      try {
        const hasCredits = await creditActions.hasCredits(userId);
        if (!hasCredits) {
          io.to(roomName).emit('voice_audio_error', {
            sessionId,
            chunkIndex,
            error: 'Insufficient credits',
          });
          return;
        }

        const result = await pollyAdapter.generateSpeech(text, voiceId);

        creditActions.chargePollyUsage(userId, text.length).catch(console.error);

        io.to(roomName).emit('voice_audio', {
          sessionId,
          chunkIndex,
          audio: result.audioBase64,
          text,
          username,
          speakerId: userId,
        });
      } catch (err) {
        console.error(`[VoiceQueue] TTS failed for chunk ${chunkIndex}:`, err);
        io.to(roomName).emit('voice_audio_error', {
          sessionId,
          chunkIndex,
          error: 'TTS generation failed',
        });
      }
    },
    { connection: workerConnection as never, concurrency: 1 },
  );

  worker.on('error', (err) => {
    console.error('[VoiceQueue] Worker error:', err);
  });

  console.log('[VoiceQueue] Initialized');
};

const addChunk = async (data: VoiceChunkJob): Promise<void> => {
  if (!queue) throw new Error('Voice queue not initialized');

  await queue.add(`${data.sessionId}-${data.chunkIndex}`, data, {
    removeOnComplete: true,
    removeOnFail: true,
  });
};

const shutdown = async (): Promise<void> => {
  if (worker) await worker.close();
  if (queue) await queue.close();
};

export type { VoiceChunkJob };
export default { init, addChunk, shutdown };
