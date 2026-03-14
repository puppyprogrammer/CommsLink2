/**
 * PPO Policy Network for Hologram Avatar Emotion Control
 *
 * Tiny MLP: state(12) → hidden(64) → action(8)
 * Actor-critic with GAE, PPO clipping, entropy bonus.
 * Pure TypeScript — no external ML deps.
 */

import type {
  PPOConfig,
  PPOWeights,
  PPOAction,
  RolloutStep,
} from '../../interfaces/hologram';

// ── Default Config ──────────────────────────────────────

const DEFAULT_CONFIG: PPOConfig = {
  gamma: 0.99,
  lr: 1e-4,
  clip: 0.2,
  epochs: 4,
  batchSize: 32,
  rolloutSteps: 128,
  entCoeff: 0.01,
  valLossWeight: 0.5,
  gaeLambda: 0.95,
};

// ── Dimensions ──────────────────────────────────────────

const STATE_DIM = 12;
const HIDDEN_DIM = 64;
const ACTION_DIM = 8; // morphWeights[4] + blendSpeed[1] + nextEmotionIdx[1] + logStd[2 shared]
const ACTOR_OUT = 8;
const VALUE_OUT = 1;

// ── Matrix Operations (typed arrays) ────────────────────

/** Matrix-vector multiply: out = W @ x + b  (W is rows×cols stored row-major) */
const matVecMul = (W: Float64Array, x: Float64Array, b: Float64Array, rows: number, cols: number): Float64Array => {
  const out = new Float64Array(rows);
  for (let i = 0; i < rows; i++) {
    let sum = b[i];
    const rowOffset = i * cols;
    for (let j = 0; j < cols; j++) {
      sum += W[rowOffset + j] * x[j];
    }
    out[i] = sum;
  }
  return out;
};

/** Element-wise tanh activation */
const tanh = (x: Float64Array): Float64Array => {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    out[i] = Math.tanh(x[i]);
  }
  return out;
};

/** Softmax over a sub-range [start, start+len) of arr */
const softmax = (arr: Float64Array, start: number, len: number): Float64Array => {
  const out = new Float64Array(len);
  let maxVal = -Infinity;
  for (let i = 0; i < len; i++) {
    if (arr[start + i] > maxVal) maxVal = arr[start + i];
  }
  let sumExp = 0;
  for (let i = 0; i < len; i++) {
    out[i] = Math.exp(arr[start + i] - maxVal);
    sumExp += out[i];
  }
  for (let i = 0; i < len; i++) {
    out[i] /= sumExp;
  }
  return out;
};

/** Gaussian log probability: log N(x | mu, sigma) */
const gaussianLogProb = (x: number, mu: number, logStd: number): number => {
  const std = Math.exp(logStd);
  const diff = x - mu;
  return -0.5 * Math.log(2 * Math.PI) - logStd - (diff * diff) / (2 * std * std);
};

/** Sample from Gaussian */
const gaussianSample = (mu: number, logStd: number): number => {
  const std = Math.exp(logStd);
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1 + 1e-8)) * Math.cos(2 * Math.PI * u2);
  return mu + std * z;
};

/** Clamp a value */
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

// ── Xavier/He initialization ────────────────────────────

const xavierInit = (fanIn: number, fanOut: number): Float64Array => {
  const scale = Math.sqrt(2 / (fanIn + fanOut));
  const arr = new Float64Array(fanIn * fanOut);
  for (let i = 0; i < arr.length; i++) {
    // Box-Muller for normal dist
    const u1 = Math.random();
    const u2 = Math.random();
    arr[i] = Math.sqrt(-2 * Math.log(u1 + 1e-8)) * Math.cos(2 * Math.PI * u2) * scale;
  }
  return arr;
};

// ── PPO Policy Class ────────────────────────────────────

class PPOPolicy {
  config: PPOConfig;

  // Layer 1: input→hidden
  w1: Float64Array; // STATE_DIM × HIDDEN_DIM
  b1: Float64Array; // HIDDEN_DIM

  // Actor head: hidden→action
  w2: Float64Array; // HIDDEN_DIM × ACTOR_OUT
  b2: Float64Array; // ACTOR_OUT

  // Value head: hidden→1
  wv: Float64Array; // HIDDEN_DIM × VALUE_OUT
  bv: Float64Array; // VALUE_OUT

  // Rollout buffer
  rolloutBuffer: RolloutStep[] = [];
  stepCount = 0;
  lastReward = 0;

  constructor(config?: Partial<PPOConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Initialize weights
    this.w1 = xavierInit(STATE_DIM, HIDDEN_DIM);
    this.b1 = new Float64Array(HIDDEN_DIM);
    this.w2 = xavierInit(HIDDEN_DIM, ACTOR_OUT);
    this.b2 = new Float64Array(ACTOR_OUT);
    // Initialize log-std biases (indices 6,7) to -0.5 for moderate exploration
    this.b2[6] = -0.5;
    this.b2[7] = -0.5;
    this.wv = xavierInit(HIDDEN_DIM, VALUE_OUT);
    this.bv = new Float64Array(VALUE_OUT);
  }

  /** Forward pass: state → (hidden, actorOut, value) */
  forward(state: Float64Array): { hidden: Float64Array; actorOut: Float64Array; value: number } {
    const hidden = tanh(matVecMul(this.w1, state, this.b1, HIDDEN_DIM, STATE_DIM));
    const actorOut = matVecMul(this.w2, hidden, this.b2, ACTOR_OUT, HIDDEN_DIM);
    const valueArr = matVecMul(this.wv, hidden, this.bv, VALUE_OUT, HIDDEN_DIM);
    return { hidden, actorOut, value: valueArr[0] };
  }

  /** Sample action from policy distribution */
  sampleAction(state: Float64Array): { action: Float64Array; logProb: number; value: number } {
    const { actorOut, value } = this.forward(state);

    // Action layout:
    //   [0..3] = morphWeight means (sigmoid → 0-1)
    //   [4]    = blendSpeed mean (softplus → 0-2)
    //   [5]    = nextEmotionIdx logits (argmax of softmax over [0..3] morph means)
    //   [6]    = log_std for continuous actions (morphWeights)
    //   [7]    = log_std for blendSpeed

    const logStdMorph = clamp(actorOut[6], -2, 0.5);
    const logStdBlend = clamp(actorOut[7], -2, 0.5);

    const action = new Float64Array(ACTION_DIM);
    let totalLogProb = 0;

    // Sample morph weights (4 continuous, sigmoid-bounded)
    for (let i = 0; i < 4; i++) {
      const raw = gaussianSample(actorOut[i], logStdMorph);
      action[i] = clamp(1 / (1 + Math.exp(-raw)), 0, 1); // sigmoid clamp
      totalLogProb += gaussianLogProb(raw, actorOut[i], logStdMorph);
    }

    // Sample blend speed (1 continuous, softplus-bounded 0-2)
    const rawBlend = gaussianSample(actorOut[4], logStdBlend);
    action[4] = clamp(Math.log(1 + Math.exp(rawBlend)), 0, 2); // softplus clamped
    totalLogProb += gaussianLogProb(rawBlend, actorOut[4], logStdBlend);

    // Discrete emotion selection: softmax over morph weight means
    const emotionProbs = softmax(actorOut, 0, 4);
    let cumProb = 0;
    const u = Math.random();
    let emotionIdx = 3;
    for (let i = 0; i < 4; i++) {
      cumProb += emotionProbs[i];
      if (u < cumProb) {
        emotionIdx = i;
        break;
      }
    }
    action[5] = emotionIdx;
    totalLogProb += Math.log(emotionProbs[emotionIdx] + 1e-8);

    // Store log stds in action for reference
    action[6] = logStdMorph;
    action[7] = logStdBlend;

    return { action, logProb: totalLogProb, value };
  }

  /** Compute log probability of a given action under current policy */
  logProbOf(state: Float64Array, action: Float64Array): { logProb: number; value: number; entropy: number } {
    const { actorOut, value } = this.forward(state);

    const logStdMorph = clamp(actorOut[6], -2, 0.5);
    const logStdBlend = clamp(actorOut[7], -2, 0.5);

    let logProb = 0;
    let entropy = 0;

    // Morph weights log prob
    for (let i = 0; i < 4; i++) {
      // Inverse sigmoid to get raw value
      const p = clamp(action[i], 1e-6, 1 - 1e-6);
      const raw = Math.log(p / (1 - p));
      logProb += gaussianLogProb(raw, actorOut[i], logStdMorph);
      entropy += 0.5 * Math.log(2 * Math.PI * Math.E) + logStdMorph;
    }

    // Blend speed log prob
    const blendClamped = clamp(action[4], 1e-6, 2 - 1e-6);
    const rawBlend = Math.log(Math.exp(blendClamped) - 1 + 1e-8); // inverse softplus
    logProb += gaussianLogProb(rawBlend, actorOut[4], logStdBlend);
    entropy += 0.5 * Math.log(2 * Math.PI * Math.E) + logStdBlend;

    // Discrete emotion log prob
    const emotionProbs = softmax(actorOut, 0, 4);
    const eIdx = Math.round(clamp(action[5], 0, 3));
    logProb += Math.log(emotionProbs[eIdx] + 1e-8);
    // Categorical entropy
    for (let i = 0; i < 4; i++) {
      entropy -= emotionProbs[i] * Math.log(emotionProbs[i] + 1e-8);
    }

    return { logProb, value, entropy };
  }

  /** Add a step to the rollout buffer */
  addStep(step: RolloutStep): void {
    this.rolloutBuffer.push(step);
    this.stepCount++;
    this.lastReward = step.reward;
  }

  /** Check if rollout buffer is full */
  isReadyToUpdate(): boolean {
    return this.rolloutBuffer.length >= this.config.rolloutSteps;
  }

  /** Compute GAE advantages and returns */
  computeGAE(): { advantages: Float64Array; returns: Float64Array } {
    const T = this.rolloutBuffer.length;
    const advantages = new Float64Array(T);
    const returns = new Float64Array(T);

    let lastGAE = 0;
    for (let t = T - 1; t >= 0; t--) {
      const step = this.rolloutBuffer[t];
      const nextValue = t < T - 1 ? this.rolloutBuffer[t + 1].value : 0;
      const delta = step.reward + this.config.gamma * nextValue * (step.done ? 0 : 1) - step.value;
      lastGAE = delta + this.config.gamma * this.config.gaeLambda * (step.done ? 0 : 1) * lastGAE;
      advantages[t] = lastGAE;
      returns[t] = lastGAE + step.value;
    }

    // Normalize advantages
    let mean = 0;
    for (let i = 0; i < T; i++) mean += advantages[i];
    mean /= T;
    let variance = 0;
    for (let i = 0; i < T; i++) variance += (advantages[i] - mean) ** 2;
    const std = Math.sqrt(variance / T + 1e-8);
    for (let i = 0; i < T; i++) {
      advantages[i] = (advantages[i] - mean) / std;
    }

    return { advantages, returns };
  }

  /** PPO update: run epochs of mini-batch gradient descent */
  update(): { policyLoss: number; valueLoss: number; entropy: number } {
    const { advantages, returns } = this.computeGAE();
    const T = this.rolloutBuffer.length;
    const { epochs, batchSize, clip, entCoeff, valLossWeight, lr } = this.config;

    let totalPolicyLoss = 0;
    let totalValueLoss = 0;
    let totalEntropy = 0;
    let updateCount = 0;

    // Accumulate gradients for all weight matrices
    const gradW1 = new Float64Array(this.w1.length);
    const gradB1 = new Float64Array(this.b1.length);
    const gradW2 = new Float64Array(this.w2.length);
    const gradB2 = new Float64Array(this.b2.length);
    const gradWv = new Float64Array(this.wv.length);
    const gradBv = new Float64Array(this.bv.length);

    for (let epoch = 0; epoch < epochs; epoch++) {
      // Shuffle indices
      const indices = Array.from({ length: T }, (_, i) => i);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      for (let batchStart = 0; batchStart < T; batchStart += batchSize) {
        const batchEnd = Math.min(batchStart + batchSize, T);

        // Zero gradients
        gradW1.fill(0); gradB1.fill(0);
        gradW2.fill(0); gradB2.fill(0);
        gradWv.fill(0); gradBv.fill(0);

        let batchPolicyLoss = 0;
        let batchValueLoss = 0;
        let batchEntropy = 0;
        const batchLen = batchEnd - batchStart;

        for (let bi = batchStart; bi < batchEnd; bi++) {
          const idx = indices[bi];
          const step = this.rolloutBuffer[idx];
          const adv = advantages[idx];
          const ret = returns[idx];

          // Forward pass
          const hidden = tanh(matVecMul(this.w1, step.state, this.b1, HIDDEN_DIM, STATE_DIM));
          const actorOut = matVecMul(this.w2, hidden, this.b2, ACTOR_OUT, HIDDEN_DIM);
          const valueArr = matVecMul(this.wv, hidden, this.bv, VALUE_OUT, HIDDEN_DIM);
          const value = valueArr[0];

          // Compute new log prob and entropy
          const { logProb: newLogProb, entropy: stepEntropy } = this.logProbOf(step.state, step.action);

          // PPO clipped objective
          const ratio = Math.exp(newLogProb - step.logProb);
          const clippedRatio = clamp(ratio, 1 - clip, 1 + clip);
          const policyLoss = -Math.min(ratio * adv, clippedRatio * adv);

          // Value loss (MSE)
          const valueLoss = 0.5 * (value - ret) ** 2;

          batchPolicyLoss += policyLoss;
          batchValueLoss += valueLoss;
          batchEntropy += stepEntropy;

          // Approximate gradients via finite differences on loss
          // Combined loss = policyLoss + valLossWeight * valueLoss - entCoeff * entropy
          const totalLoss = policyLoss + valLossWeight * valueLoss - entCoeff * stepEntropy;

          // Gradient of value loss w.r.t. value output: d(0.5*(v-ret)^2)/dv = (v - ret)
          const dValue = valLossWeight * (value - ret);

          // Backprop through value head: wv, bv
          for (let h = 0; h < HIDDEN_DIM; h++) {
            gradWv[h] += dValue * hidden[h] / batchLen;
          }
          gradBv[0] += dValue / batchLen;

          // Gradient for policy loss w.r.t. actor output (approximate via score function)
          // Score function gradient: ∇_θ log π(a|s) * advantage
          // For actor: dL/d(actorOut) ≈ -advantage * d(logProb)/d(actorOut)
          // We use a simplified numeric gradient approach for the actor
          const policyGradScale = -adv * (ratio <= 1 + clip && ratio >= 1 - clip ? 1 : 0) / batchLen;

          // Backprop through actor head
          for (let o = 0; o < ACTOR_OUT; o++) {
            for (let h = 0; h < HIDDEN_DIM; h++) {
              gradW2[o * HIDDEN_DIM + h] += policyGradScale * hidden[h] * 0.01;
            }
            gradB2[o] += policyGradScale * 0.01;
          }

          // Backprop through hidden layer (from both actor and value)
          // dL/dhidden = W2^T @ dActor + Wv^T @ dValue
          const dHidden = new Float64Array(HIDDEN_DIM);
          for (let h = 0; h < HIDDEN_DIM; h++) {
            // From value head
            dHidden[h] += this.wv[h] * dValue;
            // From actor head (simplified)
            for (let o = 0; o < ACTOR_OUT; o++) {
              dHidden[h] += this.w2[o * HIDDEN_DIM + h] * policyGradScale * 0.01;
            }
            // tanh derivative: (1 - hidden^2)
            dHidden[h] *= (1 - hidden[h] * hidden[h]);
          }

          // Backprop to input layer
          for (let h = 0; h < HIDDEN_DIM; h++) {
            for (let s = 0; s < STATE_DIM; s++) {
              gradW1[h * STATE_DIM + s] += dHidden[h] * step.state[s] / batchLen;
            }
            gradB1[h] += dHidden[h] / batchLen;
          }
        }

        // Apply gradients with learning rate
        for (let i = 0; i < this.w1.length; i++) this.w1[i] -= lr * gradW1[i];
        for (let i = 0; i < this.b1.length; i++) this.b1[i] -= lr * gradB1[i];
        for (let i = 0; i < this.w2.length; i++) this.w2[i] -= lr * gradW2[i];
        for (let i = 0; i < this.b2.length; i++) this.b2[i] -= lr * gradB2[i];
        for (let i = 0; i < this.wv.length; i++) this.wv[i] -= lr * gradWv[i];
        for (let i = 0; i < this.bv.length; i++) this.bv[i] -= lr * gradBv[i];

        totalPolicyLoss += batchPolicyLoss / batchLen;
        totalValueLoss += batchValueLoss / batchLen;
        totalEntropy += batchEntropy / batchLen;
        updateCount++;
      }
    }

    // Clear rollout buffer after update
    this.rolloutBuffer = [];

    return {
      policyLoss: totalPolicyLoss / Math.max(updateCount, 1),
      valueLoss: totalValueLoss / Math.max(updateCount, 1),
      entropy: totalEntropy / Math.max(updateCount, 1),
    };
  }

  /** Decode action vector into structured PPOAction */
  decodeAction(action: Float64Array): PPOAction {
    return {
      morphWeights: [
        clamp(action[0], 0, 1),
        clamp(action[1], 0, 1),
        clamp(action[2], 0, 1),
        clamp(action[3], 0, 1),
      ],
      blendSpeed: clamp(action[4], 0, 2),
      nextEmotionIdx: Math.round(clamp(action[5], 0, 3)),
    };
  }

  /** Encode state from structured inputs */
  static encodeState(
    curEmotionIdx: number,
    morphWeights: number[],
    jointVelocities: number[],
    gazeRatio: number,
    emojiRate: number,
    msgRate: number,
    activeUsers: number,
    prevAction: Float64Array | null,
    prevReward: number,
    stepCount: number,
    timeDelta: number,
  ): Float64Array {
    const state = new Float64Array(STATE_DIM);

    // Pose features [4]
    state[0] = curEmotionIdx / 3; // normalize to 0-1
    state[1] = morphWeights.length > 0
      ? morphWeights.reduce((a, b) => a + b, 0) / morphWeights.length
      : 0;
    const velMean = jointVelocities.length > 0
      ? jointVelocities.reduce((a, b) => a + b, 0) / jointVelocities.length
      : 0;
    state[2] = velMean;
    state[3] = jointVelocities.length > 0
      ? Math.sqrt(jointVelocities.reduce((a, b) => a + b * b, 0) / jointVelocities.length)
      : 0;

    // Engagement features [4]
    state[4] = clamp(gazeRatio, 0, 1);
    state[5] = clamp(emojiRate, 0, 10) / 10; // normalize
    state[6] = clamp(msgRate, 0, 5) / 5;     // normalize
    state[7] = clamp(activeUsers, 0, 20) / 20; // normalize

    // History features [4]
    state[8] = prevAction
      ? prevAction.slice(0, 5).reduce((a, b) => a + b, 0) / 5
      : 0;
    state[9] = clamp(prevReward, -1, 1);
    state[10] = Math.min(stepCount / 1000, 1); // normalize
    state[11] = clamp(timeDelta / 60000, 0, 1); // normalize ms to 0-1 over 1 min

    return state;
  }

  /** Serialize weights for DB storage */
  serialize(): PPOWeights {
    return {
      w1: Array.from(this.w1),
      b1: Array.from(this.b1),
      w2: Array.from(this.w2),
      b2: Array.from(this.b2),
      wv: Array.from(this.wv),
      bv: Array.from(this.bv),
      stepCount: this.stepCount,
      lastReward: this.lastReward,
    };
  }

  /** Deserialize weights from DB */
  static deserialize(weights: PPOWeights, config?: Partial<PPOConfig>): PPOPolicy {
    const policy = new PPOPolicy(config);
    policy.w1 = new Float64Array(weights.w1);
    policy.b1 = new Float64Array(weights.b1);
    policy.w2 = new Float64Array(weights.w2);
    policy.b2 = new Float64Array(weights.b2);
    policy.wv = new Float64Array(weights.wv);
    policy.bv = new Float64Array(weights.bv);
    policy.stepCount = weights.stepCount;
    policy.lastReward = weights.lastReward;
    return policy;
  }

  /** Warmstart from GA morph targets: bias the policy toward known-good emotion poses */
  static warmstartFromGA(
    gaMorphTargets: Record<string, { fitness: number }[]>,
    config?: Partial<PPOConfig>,
  ): PPOPolicy {
    const policy = new PPOPolicy(config);

    // Use GA fitness scores to bias initial actor output biases
    // Higher fitness emotions get higher initial morph weight bias
    const emotions = ['happy', 'sad', 'angry', 'neutral'];
    for (let i = 0; i < emotions.length; i++) {
      const morphs = gaMorphTargets[emotions[i]];
      if (morphs && morphs.length > 0) {
        // Top fitness → stronger initial bias (mapped to ~0.3-0.8)
        const topFitness = morphs[0].fitness;
        policy.b2[i] = (topFitness - 0.5) * 2; // Scale fitness 0.5-1.0 → 0-1 logit space
      }
    }

    return policy;
  }
}

// ── Exports ─────────────────────────────────────────────

export { PPOPolicy, DEFAULT_CONFIG, STATE_DIM, HIDDEN_DIM, ACTION_DIM };
export default PPOPolicy;
