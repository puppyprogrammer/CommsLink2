import type { ChatMessage, GrokResponse, ToolCall, ToolDefinition } from '../grok';

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const getApiKey = (): string => {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) throw new Error('CLAUDE_API_KEY environment variable is required');
  return key;
};

/**
 * Convert OpenAI-style tool definitions to Claude format.
 * Grok/OpenAI: { type: 'function', function: { name, description, parameters } }
 * Claude:      { name, description, input_schema }
 */
const convertTools = (
  tools: ToolDefinition[],
): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> =>
  tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));

/**
 * Send a chat completion request to Claude (Anthropic).
 *
 * Matches the grokAdapter.chatCompletion signature so it can be used as a drop-in replacement.
 */
const chatCompletion = async (
  systemPrompt: string,
  messages: ChatMessage[],
  model?: string,
  maxTokens?: number,
  tools?: ToolDefinition[],
  _toolChoice?: 'auto' | 'none' | 'required',
): Promise<GrokResponse> => {
  const apiKey = getApiKey();

  // Filter out system messages — Claude uses a top-level `system` field instead
  const filteredMessages = messages.filter((m) => m.role !== 'system');

  // Clamp max_tokens to 200–4000 range, default 1500
  const tokens = Math.max(200, Math.min(4000, maxTokens || 1500));

  const body: Record<string, unknown> = {
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: tokens,
    system: systemPrompt,
    messages: filteredMessages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  };

  if (tools && tools.length > 0) {
    body.tools = convertTools(tools);
    // Claude tool_choice format differs from OpenAI
    if (_toolChoice === 'required') {
      body.tool_choice = { type: 'any' };
    } else if (_toolChoice === 'none') {
      body.tool_choice = { type: 'none' };
    } else {
      body.tool_choice = { type: 'auto' };
    }
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error (${response.status}): ${errorText}`);
  }

  const usedModel = model || 'claude-sonnet-4-20250514';

  const data = (await response.json()) as {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >;
    usage: { input_tokens: number; output_tokens: number };
  };

  // Extract text content
  const textBlocks = data.content.filter((b) => b.type === 'text') as Array<{
    type: 'text';
    text: string;
  }>;
  const text = textBlocks.map((b) => b.text).join('\n');

  // Extract tool calls and convert to OpenAI/Grok format
  const toolUseBlocks = data.content.filter((b) => b.type === 'tool_use') as Array<{
    type: 'tool_use';
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>;
  const toolCalls: ToolCall[] = toolUseBlocks.map((tc) => ({
    id: tc.id,
    type: 'function' as const,
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.input),
    },
  }));

  return {
    text,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
    model: usedModel,
    toolCalls,
  };
};

export default { chatCompletion };
