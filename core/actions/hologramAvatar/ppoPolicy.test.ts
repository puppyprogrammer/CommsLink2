import { describe, it, expect } from 'vitest';
import { PPOPolicy, STATE_DIM, ACTION_DIM } from './ppoPolicy';

describe('PPOPolicy', () => {
  it('creates a policy with correct weight dimensions', () => {
    const policy = new PPOPolicy();
    expect(policy.w1.length).toBe(STATE_DIM * 64); // 12×64 = 768
    expect(policy.b1.length).toBe(64);
    expect(policy.w2.length).toBe(64 * ACTION_DIM); // 64×8 = 512
    expect(policy.b2.length).toBe(ACTION_DIM);
    expect(policy.wv.length).toBe(64);
    expect(policy.bv.length).toBe(1);
  });

  it('forward pass produces valid output dimensions', () => {
    const policy = new PPOPolicy();
    const state = new Float64Array(STATE_DIM).fill(0.5);
    const { hidden, actorOut, value } = policy.forward(state);

    expect(hidden.length).toBe(64);
    expect(actorOut.length).toBe(ACTION_DIM);
    expect(typeof value).toBe('number');
    expect(Number.isFinite(value)).toBe(true);
  });

  it('hidden activations are bounded by tanh (-1, 1)', () => {
    const policy = new PPOPolicy();
    const state = new Float64Array(STATE_DIM);
    for (let i = 0; i < STATE_DIM; i++) state[i] = Math.random() * 10 - 5;

    const { hidden } = policy.forward(state);
    for (let i = 0; i < hidden.length; i++) {
      expect(hidden[i]).toBeGreaterThanOrEqual(-1);
      expect(hidden[i]).toBeLessThanOrEqual(1);
    }
  });

  it('sampleAction returns valid action vector and log prob', () => {
    const policy = new PPOPolicy();
    const state = new Float64Array(STATE_DIM).fill(0.3);
    const { action, logProb, value } = policy.sampleAction(state);

    expect(action.length).toBe(ACTION_DIM);
    expect(Number.isFinite(logProb)).toBe(true);
    expect(Number.isFinite(value)).toBe(true);

    // Morph weights should be in [0, 1]
    for (let i = 0; i < 4; i++) {
      expect(action[i]).toBeGreaterThanOrEqual(0);
      expect(action[i]).toBeLessThanOrEqual(1);
    }

    // Blend speed should be in [0, 2]
    expect(action[4]).toBeGreaterThanOrEqual(0);
    expect(action[4]).toBeLessThanOrEqual(2);

    // Emotion index should be 0-3
    expect(action[5]).toBeGreaterThanOrEqual(0);
    expect(action[5]).toBeLessThanOrEqual(3);
    expect(action[5]).toBe(Math.floor(action[5])); // integer
  });

  it('decodeAction produces correctly typed PPOAction', () => {
    const policy = new PPOPolicy();
    const state = new Float64Array(STATE_DIM).fill(0.5);
    const { action } = policy.sampleAction(state);
    const decoded = policy.decodeAction(action);

    expect(decoded.morphWeights).toHaveLength(4);
    expect(decoded.blendSpeed).toBeGreaterThanOrEqual(0);
    expect(decoded.blendSpeed).toBeLessThanOrEqual(2);
    expect(decoded.nextEmotionIdx).toBeGreaterThanOrEqual(0);
    expect(decoded.nextEmotionIdx).toBeLessThanOrEqual(3);
  });

  it('encodeState produces 12-dim normalized vector', () => {
    const state = PPOPolicy.encodeState(
      1, // sad
      [0.5, 0.3, 0.1, 0.0],
      [0.1, 0.2, 0.15],
      0.7,
      2.0,
      1.5,
      3,
      null,
      0.5,
      100,
      5000,
    );

    expect(state.length).toBe(STATE_DIM);
    // All values should be finite
    for (let i = 0; i < STATE_DIM; i++) {
      expect(Number.isFinite(state[i])).toBe(true);
    }
    // Normalized values should be roughly in [0, 1]
    expect(state[0]).toBeCloseTo(1 / 3); // emotionIdx=1 / 3
    expect(state[4]).toBeCloseTo(0.7); // gazeRatio
    expect(state[7]).toBeCloseTo(3 / 20); // activeUsers normalized
  });

  it('serialize/deserialize roundtrips weights correctly', () => {
    const policy = new PPOPolicy();
    // Modify some weights
    policy.w1[0] = 42;
    policy.b2[3] = -1.5;
    policy.stepCount = 99;
    policy.lastReward = 0.75;

    const serialized = policy.serialize();
    const restored = PPOPolicy.deserialize(serialized);

    expect(restored.w1[0]).toBe(42);
    expect(restored.b2[3]).toBe(-1.5);
    expect(restored.stepCount).toBe(99);
    expect(restored.lastReward).toBe(0.75);
    expect(restored.w1.length).toBe(policy.w1.length);
    expect(restored.wv.length).toBe(policy.wv.length);
  });

  it('logProbOf returns finite values for valid state/action', () => {
    const policy = new PPOPolicy();
    const state = new Float64Array(STATE_DIM).fill(0.5);
    const { action } = policy.sampleAction(state);
    const { logProb, value, entropy } = policy.logProbOf(state, action);

    expect(Number.isFinite(logProb)).toBe(true);
    expect(Number.isFinite(value)).toBe(true);
    expect(Number.isFinite(entropy)).toBe(true);
    expect(entropy).toBeGreaterThanOrEqual(0); // entropy should be non-negative
  });

  it('rollout buffer tracks steps and triggers update', () => {
    const policy = new PPOPolicy({ rolloutSteps: 4 });
    const state = new Float64Array(STATE_DIM).fill(0.5);

    for (let i = 0; i < 3; i++) {
      policy.addStep({
        state,
        action: new Float64Array(ACTION_DIM).fill(0.5),
        logProb: -1,
        value: 0.5,
        reward: 0.5,
        done: false,
      });
      expect(policy.isReadyToUpdate()).toBe(false);
    }

    policy.addStep({
      state,
      action: new Float64Array(ACTION_DIM).fill(0.5),
      logProb: -1,
      value: 0.5,
      reward: 0.5,
      done: false,
    });
    expect(policy.isReadyToUpdate()).toBe(true);
    expect(policy.stepCount).toBe(4);
  });

  it('computeGAE returns correct-length arrays', () => {
    const policy = new PPOPolicy({ rolloutSteps: 8 });
    const state = new Float64Array(STATE_DIM).fill(0.5);

    for (let i = 0; i < 8; i++) {
      policy.addStep({
        state,
        action: new Float64Array(ACTION_DIM).fill(0.5),
        logProb: -1,
        value: 0.5 + i * 0.1,
        reward: 0.3 + Math.random() * 0.4,
        done: false,
      });
    }

    const { advantages, returns } = policy.computeGAE();
    expect(advantages.length).toBe(8);
    expect(returns.length).toBe(8);

    // Advantages should be normalized (mean ≈ 0)
    let mean = 0;
    for (let i = 0; i < 8; i++) mean += advantages[i];
    mean /= 8;
    expect(Math.abs(mean)).toBeLessThan(0.1);
  });

  it('update runs without errors and clears buffer', () => {
    const policy = new PPOPolicy({ rolloutSteps: 8, epochs: 2, batchSize: 4 });
    const state = new Float64Array(STATE_DIM).fill(0.5);

    for (let i = 0; i < 8; i++) {
      const { action, logProb, value } = policy.sampleAction(state);
      policy.addStep({
        state,
        action,
        logProb,
        value,
        reward: Math.random(),
        done: false,
      });
    }

    const result = policy.update();
    expect(Number.isFinite(result.policyLoss)).toBe(true);
    expect(Number.isFinite(result.valueLoss)).toBe(true);
    expect(Number.isFinite(result.entropy)).toBe(true);
    expect(policy.rolloutBuffer.length).toBe(0); // buffer cleared
  });

  it('warmstartFromGA biases output toward high-fitness emotions', () => {
    const gaMorphs = {
      happy: [{ fitness: 0.98 }],
      sad: [{ fitness: 0.95 }],
      angry: [{ fitness: 0.82 }],
      neutral: [{ fitness: 1.0 }],
    };

    const policy = PPOPolicy.warmstartFromGA(gaMorphs);
    // Happy (0.98 fitness) should have higher bias than angry (0.82)
    expect(policy.b2[0]).toBeGreaterThan(policy.b2[2]);
    // Neutral (1.0) should have highest
    expect(policy.b2[3]).toBeGreaterThan(policy.b2[1]);
  });
});
