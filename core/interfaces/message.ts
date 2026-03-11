type IncomingMessage = {
  text: string;
  voice: string | null;
  audio: string | null;
  nonce?: string;
  type?: string;
};

type FormattedMessage = {
  id: string;
  sender: string;
  text: string;
  voice: string | null;
  audio: string | null;
  nonce?: string;
  timestamp: string;
  type?: string;
  imageUrl?: string;
};

export type { IncomingMessage, FormattedMessage };
