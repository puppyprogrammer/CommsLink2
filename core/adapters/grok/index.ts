type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type GrokResponse = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

const AVAILABLE_MODELS = [
  { id: 'grok-4-1-fast-reasoning', label: 'Grok 4.1 Fast (Reasoning)', cost: '$0.20/$0.50' },
  { id: 'grok-4-1-fast-non-reasoning', label: 'Grok 4.1 Fast', cost: '$0.20/$0.50' },
  { id: 'grok-4-fast-reasoning', label: 'Grok 4 Fast (Reasoning)', cost: '$0.20/$0.50' },
  { id: 'grok-4-fast-non-reasoning', label: 'Grok 4 Fast', cost: '$0.20/$0.50' },
  { id: 'grok-4-0709', label: 'Grok 4 (0709)', cost: '$3.00/$15.00' },
  { id: 'grok-3', label: 'Grok 3', cost: '$3.00/$15.00' },
  { id: 'grok-3-mini', label: 'Grok 3 Mini', cost: '$0.30/$0.50' },
  { id: 'grok-code-fast-1', label: 'Grok Code Fast', cost: '$0.20/$1.50' },
] as const;

const DEFAULT_MODEL = 'grok-4-1-fast-non-reasoning';

const getApiKey = (): string => {
  const key = process.env.GROK_API_KEY || process.env.XAI_API_KEY;
  if (!key) throw new Error('GROK_API_KEY or XAI_API_KEY environment variable is required');
  return key;
};

const getModel = (): string => process.env.GROK_MODEL || DEFAULT_MODEL;

/**
 * Send a chat completion request to Grok (xAI).
 *
 * @param systemPrompt - System instructions for the agent.
 * @param messages     - Conversation history.
 * @param model        - Optional model override (defaults to env or grok-4-1-fast-non-reasoning).
 * @returns Generated response text.
 */
const chatCompletion = async (
  systemPrompt: string,
  messages: ChatMessage[],
  model?: string,
): Promise<GrokResponse> => {
  const apiKey = getApiKey();

  const allMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model || getModel(),
      messages: allMessages,
      max_tokens: 500,
      temperature: 0.8,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Grok API error (${response.status}): ${errorText}`);
  }

  const usedModel = model || getModel();

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    text: data.choices[0]?.message?.content || 'No response generated.',
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
    model: usedModel,
  };
};

/**
 * Check an image for illegal content using Grok vision.
 * Returns { safe: true } or { safe: false, reason: string }.
 */
const moderateImage = async (
  base64Data: string,
  mimeType: string,
): Promise<{ safe: boolean; reason?: string }> => {
  const apiKey = getApiKey();

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'grok-2-vision-latest',
      messages: [
        {
          role: 'system',
          content:
            'You are a content moderation system. Analyze the image and determine if it contains illegal content. ' +
            'Illegal content includes: child sexual abuse material (CSAM), depictions of minors in sexual situations, ' +
            'real violence/gore involving minors, or content that appears to depict real crimes against children. ' +
            'Adult nudity, artistic nudity, memes, and other legal content are ALLOWED. ' +
            'Respond with ONLY a JSON object: {"safe": true} or {"safe": false, "reason": "brief explanation"}',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Is this image safe to share in a chat room?' },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Data}` },
            },
          ],
        },
      ],
      max_tokens: 100,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`[Moderation] Grok vision API error (${response.status}): ${errText}`);
    // Allow through if moderation API is unavailable — don't block users over API issues
    return { safe: true };
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const text = data.choices[0]?.message?.content || '';
  console.log(`[Moderation] Grok response: ${text}`);

  try {
    // Try to extract JSON from the response (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[^}]+\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    const parsed = JSON.parse(jsonStr);
    return { safe: !!parsed.safe, reason: parsed.reason };
  } catch {
    // If we can't parse, check for "safe": true in raw text
    if (text.toLowerCase().includes('"safe": true') || text.toLowerCase().includes('"safe":true')) {
      return { safe: true };
    }
    // Default to allowing if we can't determine
    console.warn('[Moderation] Could not parse response, allowing image');
    return { safe: true };
  }
};

export type { ChatMessage, GrokResponse };
export { AVAILABLE_MODELS };
export default { chatCompletion, moderateImage };
