/**
 * Ordered audio playback queue.
 *
 * Queues base64 audio chunks keyed by sessionId + chunkIndex and plays
 * them back sequentially so they never overlap. Each session's chunks
 * play in order even if they arrive out of order.
 */

type QueuedChunk = {
  chunkIndex: number;
  audio: string; // base64 mpeg
};

type SessionQueue = {
  chunks: Map<number, string>; // chunkIndex -> base64 audio
  nextIndex: number;
  playing: boolean;
};

const sessions = new Map<string, SessionQueue>();

let globalVolume = 1.0;

const getSession = (sessionId: string): SessionQueue => {
  let s = sessions.get(sessionId);
  if (!s) {
    s = { chunks: new Map(), nextIndex: 0, playing: false };
    sessions.set(sessionId, s);
  }
  return s;
};

const playNext = async (sessionId: string): Promise<void> => {
  const session = sessions.get(sessionId);
  if (!session || session.playing) return;

  const audioData = session.chunks.get(session.nextIndex);
  if (!audioData) return; // Not yet arrived

  session.playing = true;
  session.chunks.delete(session.nextIndex);

  try {
    const audio = new Audio(`data:audio/mpeg;base64,${audioData}`);
    audio.volume = globalVolume;

    await new Promise<void>((resolve) => {
      audio.onended = () => resolve();
      audio.onerror = () => resolve();
      audio.play().catch(() => resolve());
    });
  } catch {
    // Playback failed, continue to next
  }

  session.playing = false;
  session.nextIndex++;

  // Try to play the next chunk
  playNext(sessionId);
};

/**
 * Enqueue a voice audio chunk for ordered playback.
 */
const enqueue = (sessionId: string, chunkIndex: number, audio: string): void => {
  const session = getSession(sessionId);
  session.chunks.set(chunkIndex, audio);

  // Try to play if this is the next expected chunk
  if (!session.playing) {
    playNext(sessionId);
  }
};

/**
 * Clear a session's queue (e.g. when stream ends).
 */
const clearSession = (sessionId: string): void => {
  sessions.delete(sessionId);
};

/**
 * Clear all sessions.
 */
const clearAll = (): void => {
  sessions.clear();
};

/**
 * Set the volume for all future audio playback.
 */
const setVolume = (vol: number): void => {
  globalVolume = Math.max(0, Math.min(1, vol));
};

const isAnyPlaying = (): boolean => {
  for (const session of sessions.values()) {
    if (session.playing) return true;
  }
  return false;
};

export { enqueue, clearSession, clearAll, setVolume, isAnyPlaying };
