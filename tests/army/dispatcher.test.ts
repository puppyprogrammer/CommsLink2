import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Grok adapter before importing the dispatcher
vi.mock('../../core/adapters/grok', () => ({
  default: {
    chatCompletion: vi.fn(),
  },
}));

// Mock the Data layer
vi.mock('../../core/data', () => {
  const mockArmy = [
    { id: 'centurion-1', name: 'Theron the Bold', rank: 'centurion', maniple_id: null, maniple_name: null, squad_id: null, commander_id: 'cmd-1', is_npc: true, is_alive: true, trait_humor: 30, trait_obedience: 40, trait_bravery: 90, trait_verbosity: 50, mood: 60, loyalty: 80, respect: 70, familiarity: 50, attraction: 0, ai_instructions: 'Lead wisely.', ai_memories: '[]' },
    { id: 'decurion-1', name: 'Marcus the Grim', rank: 'decurion', maniple_id: 1, maniple_name: 'Iron Guard', squad_id: 'a', commander_id: 'cmd-1', is_npc: true, is_alive: true, trait_humor: 20, trait_obedience: 70, trait_bravery: 65, trait_verbosity: 40, mood: 50, loyalty: 70, respect: 60, familiarity: 40, attraction: 0, ai_instructions: null, ai_memories: '[]' },
    { id: 'sgt-1a', name: 'Finn the Quick', rank: 'sergeant', maniple_id: 1, maniple_name: 'Iron Guard', squad_id: 'a', commander_id: 'cmd-1', is_npc: true, is_alive: true, trait_humor: 60, trait_obedience: 60, trait_bravery: 50, trait_verbosity: 70, mood: 55, loyalty: 60, respect: 50, familiarity: 30, attraction: 0, ai_instructions: null, ai_memories: '[]' },
    { id: 'soldier-1', name: 'Baldric Redhelm', rank: 'soldier', maniple_id: 1, maniple_name: 'Iron Guard', squad_id: 'a', commander_id: 'cmd-1', is_npc: true, is_alive: true, trait_humor: 50, trait_obedience: 70, trait_bravery: 30, trait_verbosity: 40, mood: 45, loyalty: 50, respect: 40, familiarity: 20, attraction: 0, ai_instructions: null, ai_memories: '[]' },
    { id: 'soldier-2', name: 'Conrad the Steady', rank: 'soldier', maniple_id: 1, maniple_name: 'Iron Guard', squad_id: 'a', commander_id: 'cmd-1', is_npc: true, is_alive: true, trait_humor: 40, trait_obedience: 80, trait_bravery: 40, trait_verbosity: 30, mood: 50, loyalty: 55, respect: 45, familiarity: 25, attraction: 0, ai_instructions: null, ai_memories: '[]' },
    { id: 'sgt-1b', name: 'Gareth Stonewall', rank: 'sergeant', maniple_id: 1, maniple_name: 'Iron Guard', squad_id: 'b', commander_id: 'cmd-1', is_npc: true, is_alive: true, trait_humor: 35, trait_obedience: 80, trait_bravery: 70, trait_verbosity: 35, mood: 50, loyalty: 65, respect: 55, familiarity: 30, attraction: 0, ai_instructions: null, ai_memories: '[]' },
    { id: 'soldier-3', name: 'Dunstan Oakheart', rank: 'soldier', maniple_id: 1, maniple_name: 'Iron Guard', squad_id: 'b', commander_id: 'cmd-1', is_npc: true, is_alive: true, trait_humor: 50, trait_obedience: 60, trait_bravery: 35, trait_verbosity: 50, mood: 40, loyalty: 45, respect: 40, familiarity: 15, attraction: 0, ai_instructions: null, ai_memories: '[]' },
  ];

  return {
    default: {
      playerCharacter: {
        getArmyStructure: vi.fn().mockResolvedValue(mockArmy),
        update: vi.fn().mockResolvedValue({}),
      },
    },
  };
});

// Mock tracer
vi.mock('../../core/lib/tracer', () => ({
  default: {
    trace: (_name: string, fn: () => Promise<unknown>) => fn(),
  },
}));

import grokAdapter from '../../core/adapters/grok';
import { dispatchArmyChat, generateUnitResponse } from '../../core/actions/army/chatDispatcherAction';

const mockGrok = grokAdapter.chatCompletion as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ┌──────────────────────────────────────────┐
// │ Dispatcher Routing Tests                 │
// └──────────────────────────────────────────┘

describe('Dispatcher: who should respond', () => {

  it('Addressing a soldier by name → only that soldier responds', async () => {
    mockGrok.mockResolvedValueOnce({
      text: JSON.stringify({
        responder_ids: ['soldier-1'],
        listener_context: 'Commander asked Baldric about his status',
        commands: [],
      }),
      inputTokens: 100, outputTokens: 50, model: 'grok-code-fast-1', toolCalls: [],
    });

    const result = await dispatchArmyChat('cmd-1', 'Baldric, how are you doing?');

    expect(result.responders).toEqual(['soldier-1']);
    expect(result.listeners).toContain('centurion-1');
    expect(result.listeners).toContain('sgt-1a');
    expect(result.listeners).not.toContain('soldier-1');
  });

  it('Addressing "Centurion" → centurion responds', async () => {
    mockGrok.mockResolvedValueOnce({
      text: JSON.stringify({
        responder_ids: ['centurion-1'],
        listener_context: 'Commander wants strategic advice from the Centurion',
        commands: [],
      }),
      inputTokens: 100, outputTokens: 50, model: 'grok-code-fast-1', toolCalls: [],
    });

    const result = await dispatchArmyChat('cmd-1', 'Centurion, what do you recommend?');

    expect(result.responders).toEqual(['centurion-1']);
    expect(result.listeners.length).toBe(6); // everyone else
  });

  it('"Squad A, report" → sergeant of Squad A responds', async () => {
    mockGrok.mockResolvedValueOnce({
      text: JSON.stringify({
        responder_ids: ['sgt-1a'],
        listener_context: 'Commander asked Squad A for status',
        commands: [],
      }),
      inputTokens: 100, outputTokens: 50, model: 'grok-code-fast-1', toolCalls: [],
    });

    const result = await dispatchArmyChat('cmd-1', 'Squad A, report status');

    expect(result.responders).toEqual(['sgt-1a']);
    // Squad A soldiers should be listeners, not responders
    expect(result.listeners).toContain('soldier-1');
    expect(result.listeners).toContain('soldier-2');
  });

  it('"Everyone, form up" → centurion responds, command issued', async () => {
    mockGrok.mockResolvedValueOnce({
      text: JSON.stringify({
        responder_ids: ['centurion-1'],
        listener_context: 'Commander ordered full army to form up',
        commands: ['form up'],
      }),
      inputTokens: 100, outputTokens: 50, model: 'grok-code-fast-1', toolCalls: [],
    });

    const result = await dispatchArmyChat('cmd-1', 'Everyone, form up on me!');

    expect(result.responders).toEqual(['centurion-1']);
    expect(result.commands_issued).toContain('form up');
  });

  it('"Hold position" → centurion responds, hold command issued', async () => {
    mockGrok.mockResolvedValueOnce({
      text: JSON.stringify({
        responder_ids: ['centurion-1'],
        listener_context: 'Commander ordered hold position',
        commands: ['hold'],
      }),
      inputTokens: 100, outputTokens: 50, model: 'grok-code-fast-1', toolCalls: [],
    });

    const result = await dispatchArmyChat('cmd-1', 'Hold position!');

    expect(result.commands_issued).toContain('hold');
  });

  it('Max 3 responders enforced even if Grok returns more', async () => {
    mockGrok.mockResolvedValueOnce({
      text: JSON.stringify({
        responder_ids: ['centurion-1', 'decurion-1', 'sgt-1a', 'sgt-1b', 'soldier-1'],
        listener_context: 'Everyone wants to talk',
        commands: [],
      }),
      inputTokens: 100, outputTokens: 50, model: 'grok-code-fast-1', toolCalls: [],
    });

    const result = await dispatchArmyChat('cmd-1', 'What does everyone think?');

    expect(result.responders.length).toBeLessThanOrEqual(3);
  });

  it('Invalid IDs from Grok are filtered out', async () => {
    mockGrok.mockResolvedValueOnce({
      text: JSON.stringify({
        responder_ids: ['nonexistent-id', 'also-fake', 'soldier-1'],
        listener_context: 'test',
        commands: [],
      }),
      inputTokens: 100, outputTokens: 50, model: 'grok-code-fast-1', toolCalls: [],
    });

    const result = await dispatchArmyChat('cmd-1', 'Hello?');

    expect(result.responders).toEqual(['soldier-1']);
  });

  it('Grok failure → fallback to centurion', async () => {
    mockGrok.mockRejectedValueOnce(new Error('API timeout'));

    const result = await dispatchArmyChat('cmd-1', 'Is anyone there?');

    // Should fallback to centurion
    expect(result.responders).toEqual(['centurion-1']);
  });

  it('Grok returns garbage → fallback to centurion', async () => {
    mockGrok.mockResolvedValueOnce({
      text: 'This is not JSON at all lol',
      inputTokens: 100, outputTokens: 50, model: 'grok-code-fast-1', toolCalls: [],
    });

    const result = await dispatchArmyChat('cmd-1', 'Hello army');

    expect(result.responders).toEqual(['centurion-1']);
  });
});

// ┌──────────────────────────────────────────┐
// │ Response Generation Tests                │
// └──────────────────────────────────────────┘

describe('Unit response generation', () => {

  it('Centurion uses grok-3-mini (reasoning model)', async () => {
    const centurion = {
      id: 'centurion-1', name: 'Theron the Bold', rank: 'centurion',
      maniple_id: null, maniple_name: null, squad_id: null,
      trait_humor: 30, trait_obedience: 40, trait_bravery: 90, trait_verbosity: 50,
      mood: 60, loyalty: 80, respect: 70, familiarity: 50,
      ai_instructions: 'Lead wisely.', ai_memories: '[]',
    };

    mockGrok.mockResolvedValueOnce({
      text: 'The men are ready, Commander. Say the word.\nEMOTION: determined',
      inputTokens: 200, outputTokens: 30, model: 'grok-3-mini', toolCalls: [],
    });

    const response = await generateUnitResponse(centurion as never, 'Are we ready?');

    // Verify grok-3-mini was used for centurion
    expect(mockGrok).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      'grok-3-mini',
      150,
    );
    expect(response.response).toContain('The men are ready');
    expect(response.emotion).toBe('determined');
  });

  it('Soldier uses grok-code-fast-1 (cheap model)', async () => {
    const soldier = {
      id: 'soldier-1', name: 'Baldric Redhelm', rank: 'soldier',
      maniple_id: 1, maniple_name: 'Iron Guard', squad_id: 'a',
      trait_humor: 50, trait_obedience: 70, trait_bravery: 30, trait_verbosity: 40,
      mood: 45, loyalty: 50, respect: 40, familiarity: 20,
      ai_instructions: null, ai_memories: '[]',
    };

    mockGrok.mockResolvedValueOnce({
      text: 'Yes sir, all good here.\nEMOTION: respectful',
      inputTokens: 200, outputTokens: 20, model: 'grok-code-fast-1', toolCalls: [],
    });

    const response = await generateUnitResponse(soldier as never, 'Baldric, status?');

    expect(mockGrok).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      'grok-code-fast-1',
      150,
    );
    expect(response.emotion).toBe('respectful');
  });

  it('Emotion is parsed correctly from response', async () => {
    const soldier = {
      id: 'soldier-1', name: 'Test', rank: 'soldier',
      maniple_id: 1, maniple_name: 'Test', squad_id: 'a',
      trait_humor: 50, trait_obedience: 50, trait_bravery: 50, trait_verbosity: 50,
      mood: 50, loyalty: 50, respect: 50, familiarity: 50,
      ai_instructions: null, ai_memories: '[]',
    };

    mockGrok.mockResolvedValueOnce({
      text: 'I... I think we should run, Commander.\nEMOTION: fearful',
      inputTokens: 100, outputTokens: 20, model: 'grok-code-fast-1', toolCalls: [],
    });

    const response = await generateUnitResponse(soldier as never, 'What do you see?');

    expect(response.emotion).toBe('fearful');
    expect(response.response).not.toContain('EMOTION');
    expect(response.response).toContain('I think we should run');
  });

  it('Grok failure → graceful fallback *nods*', async () => {
    const soldier = {
      id: 'soldier-1', name: 'Test', rank: 'soldier',
      maniple_id: 1, maniple_name: 'Test', squad_id: 'a',
      trait_humor: 50, trait_obedience: 50, trait_bravery: 50, trait_verbosity: 50,
      mood: 50, loyalty: 50, respect: 50, familiarity: 50,
      ai_instructions: null, ai_memories: '[]',
    };

    mockGrok.mockRejectedValueOnce(new Error('timeout'));

    const response = await generateUnitResponse(soldier as never, 'Hello');

    expect(response.response).toBe('*nods*');
    expect(response.emotion).toBe('neutral');
  });
});
