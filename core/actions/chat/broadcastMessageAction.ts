import { v4 as uuidv4 } from 'uuid';

import type { IncomingMessage, FormattedMessage } from '../../interfaces/message';

/**
 * Format an incoming chat message for broadcast.
 *
 * @param username - Sender username.
 * @param data     - Raw incoming message data.
 * @returns Formatted message with ID and timestamp.
 */
const broadcastMessageAction = (username: string, data: IncomingMessage): FormattedMessage => ({
  id: uuidv4(),
  sender: username,
  text: data.text,
  voice: data.voice,
  audio: data.audio,
  nonce: data.nonce,
  timestamp: new Date().toISOString(),
  type: data.type,
  imageUrl: data.type === 'image' ? data.text : undefined,
});

export default broadcastMessageAction;
