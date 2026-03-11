// Libraries
import client, { authHeaders } from './client';

type GenerateVoicePayload = {
  text: string;
  voice_id: string;
};

const voice = {
  generate: async (bearerToken: string, payload: GenerateVoicePayload) => {
    const { data } = await client.post(
      '/voice/generate',
      { text: payload.text, voiceId: payload.voice_id },
      { headers: authHeaders(bearerToken) },
    );
    return data;
  },

  listVoices: async (bearerToken: string) => {
    const { data } = await client.get<{ voices: Array<{ voice_id: string; name: string }> }>('/voice/list', {
      headers: authHeaders(bearerToken),
    });
    return data;
  },
};

export default voice;
