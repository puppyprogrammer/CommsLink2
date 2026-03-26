import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Grok adapter
vi.mock('../../core/adapters/grok', () => ({
  default: {
    chatCompletion: vi.fn(),
  },
}));

vi.mock('../../core/data', () => {
  const army = [
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
        getArmyStructure: vi.fn().mockResolvedValue(army),
        update: vi.fn().mockResolvedValue({}),
      },
    },
  };
});

vi.mock('../../core/lib/tracer', () => ({
  default: { trace: (_name: string, fn: () => Promise<unknown>) => fn() },
}));

import grokAdapter from '../../core/adapters/grok';
import { dispatchArmyChat, generateUnitResponse } from '../../core/actions/army/chatDispatcherAction';

const mockGrok = grokAdapter.chatCompletion as ReturnType<typeof vi.fn>;

// Reference army for response generation tests
const testCenturion = { id: 'centurion-1', name: 'Theron the Bold', rank: 'centurion', maniple_id: null, maniple_name: null, squad_id: null, trait_humor: 30, trait_obedience: 40, trait_bravery: 90, trait_verbosity: 50, mood: 60, loyalty: 80, respect: 70, familiarity: 50, ai_instructions: 'Lead wisely.', ai_memories: '[]' };
const testSoldier = { id: 'soldier-1', name: 'Baldric Redhelm', rank: 'soldier', maniple_id: 1, maniple_name: 'Iron Guard', squad_id: 'a', trait_humor: 50, trait_obedience: 70, trait_bravery: 30, trait_verbosity: 40, mood: 45, loyalty: 50, respect: 40, familiarity: 20, ai_instructions: null, ai_memories: '[]' };

beforeEach(() => { vi.clearAllMocks(); });

// ┌──────────────────────────────────────────┐
// │ Fast Path Routing (no Grok call)         │
// └──────────────────────────────────────────┘

describe('Dispatcher: fast path routing', () => {

  it('Name addressing: "Baldric" → only Baldric responds (no Grok)', async () => {
    const result = await dispatchArmyChat('cmd-1', 'Baldric Redhelm, how are you?');
    expect(result.responders).toEqual(['soldier-1']);
    expect(result.listeners).not.toContain('soldier-1');
    expect(mockGrok).not.toHaveBeenCalled();
  });

  it('"Centurion" → centurion responds (no Grok)', async () => {
    const result = await dispatchArmyChat('cmd-1', 'Centurion, what do you recommend?');
    expect(result.responders).toEqual(['centurion-1']);
    expect(mockGrok).not.toHaveBeenCalled();
  });

  it('"Sergeants" → all sergeants respond (no Grok)', async () => {
    const result = await dispatchArmyChat('cmd-1', 'Sergeants, report');
    expect(result.responders).toContain('sgt-1a');
    expect(result.responders).toContain('sgt-1b');
    expect(result.responders).not.toContain('centurion-1');
    expect(mockGrok).not.toHaveBeenCalled();
  });

  it('"Squad A" → sergeant of squad A responds (no Grok)', async () => {
    const result = await dispatchArmyChat('cmd-1', 'Squad A, report status');
    // Decurion-1 is squad A leader (rank decurion > sergeant)
    expect(result.responders.length).toBe(1);
    expect(['sgt-1a', 'decurion-1']).toContain(result.responders[0]);
    expect(mockGrok).not.toHaveBeenCalled();
  });

  it('"Everyone, form up" → centurion responds + command (no Grok)', async () => {
    const result = await dispatchArmyChat('cmd-1', 'Everyone, form up on me!');
    expect(result.responders).toEqual(['centurion-1']);
    expect(result.commands_issued).toContain('form up');
    expect(mockGrok).not.toHaveBeenCalled();
  });

  it('"Hold position" → highest rank responds + hold command (no Grok)', async () => {
    const result = await dispatchArmyChat('cmd-1', 'Hold position!');
    expect(result.responders).toEqual(['centurion-1']);
    expect(result.commands_issued).toContain('hold');
    expect(mockGrok).not.toHaveBeenCalled();
  });

  it('"Iron Guard" maniple name → decurion responds (no Grok)', async () => {
    const result = await dispatchArmyChat('cmd-1', 'Iron Guard, advance!');
    expect(result.responders).toEqual(['decurion-1']);
    expect(result.commands_issued).toContain('advance');
    expect(mockGrok).not.toHaveBeenCalled();
  });

  it('"Retreat!" → highest rank responds + retreat command (no Grok)', async () => {
    const result = await dispatchArmyChat('cmd-1', 'Retreat! Fall back!');
    expect(result.responders).toEqual(['centurion-1']);
    expect(result.commands_issued).toContain('retreat');
    expect(mockGrok).not.toHaveBeenCalled();
  });
});

// ┌──────────────────────────────────────────┐
// │ Grok Fallback (ambiguous messages)       │
// └──────────────────────────────────────────┘

describe('Dispatcher: Grok fallback for ambiguous messages', () => {

  it('Ambiguous message falls back to Grok', async () => {
    mockGrok.mockResolvedValueOnce({
      text: JSON.stringify({ responder_ids: ['sgt-1a'], listener_context: 'casual chat', commands: [] }),
      inputTokens: 50, outputTokens: 30, model: 'grok-code-fast-1', toolCalls: [],
    });

    const result = await dispatchArmyChat('cmd-1', 'So what do you guys think of this weather?');
    expect(mockGrok).toHaveBeenCalled();
    expect(result.responders).toEqual(['sgt-1a']);
  });

  it('Grok failure on ambiguous → centurion fallback', async () => {
    mockGrok.mockRejectedValueOnce(new Error('API timeout'));
    const result = await dispatchArmyChat('cmd-1', 'Hmm interesting...');
    expect(result.responders).toEqual(['centurion-1']);
  });

  it('Grok garbage on ambiguous → centurion fallback', async () => {
    mockGrok.mockResolvedValueOnce({
      text: 'not json at all', inputTokens: 50, outputTokens: 10, model: 'grok-code-fast-1', toolCalls: [],
    });
    const result = await dispatchArmyChat('cmd-1', 'I wonder about life...');
    expect(result.responders).toEqual(['centurion-1']);
  });
});

// ┌──────────────────────────────────────────┐
// │ Response Generation                      │
// └──────────────────────────────────────────┘

describe('Unit response generation', () => {

  it('Uses grok-code-fast-1 for all ranks (speed priority)', async () => {
    const unit = testCenturion;
    mockGrok.mockResolvedValueOnce({
      text: 'The men are ready.\nEMOTION: determined',
      inputTokens: 50, outputTokens: 15, model: 'grok-code-fast-1', toolCalls: [],
    });

    const response = await generateUnitResponse(unit as never, 'Are we ready?');
    expect(mockGrok).toHaveBeenCalledWith(expect.any(String), expect.any(Array), 'grok-code-fast-1', 60);
    expect(response.emotion).toBe('determined');
    expect(response.response).not.toContain('EMOTION');
  });

  it('Grok failure → *nods* fallback', async () => {
    mockGrok.mockRejectedValueOnce(new Error('timeout'));
    const response = await generateUnitResponse(testSoldier as never, 'Hello');
    expect(response.response).toBe('*nods*');
    expect(response.emotion).toBe('neutral');
  });
});
