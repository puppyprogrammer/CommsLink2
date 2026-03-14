// ── Hologram PPO & PoseBuffer Types ─────────────────────

/** PPO hyperparameters */
export type PPOConfig = {
  gamma: number;       // Discount factor (0.99)
  lr: number;          // Learning rate (1e-4)
  clip: number;        // PPO clip epsilon (0.2)
  epochs: number;      // PPO update epochs (4)
  batchSize: number;   // Mini-batch size (32)
  rolloutSteps: number; // Steps before update (128)
  entCoeff: number;    // Entropy bonus coefficient (0.01)
  valLossWeight: number; // Value loss weight (0.5)
  gaeLambda: number;   // GAE lambda (0.95)
};

/** 12-dim state vector fed to the policy */
export type PPOState = {
  // Pose features [4]
  curEmotionIdx: number;       // 0-3 (happy/sad/angry/neutral)
  morphWeightsMean: number;    // mean of current morph weights
  jointVelocitiesMean: number; // mean joint velocity
  jointVelocitiesRms: number;  // RMS joint velocity
  // Engagement features [4]
  gazeRatio: number;           // 0-1 gaze engagement
  emojiRate: number;           // emojis per second
  msgRate: number;             // messages per second
  activeUsers: number;         // active user count
  // History features [4]
  prevActionMean: number;      // mean of previous action vector
  prevReward: number;          // reward from last step
  stepCount: number;           // total steps taken
  timeDelta: number;           // ms since last step
};

/** 8-dim action vector output by the policy */
export type PPOAction = {
  morphWeights: [number, number, number, number]; // per-emotion blend weights
  blendSpeed: number;   // 0-2 range
  nextEmotionIdx: number; // 0-3 discrete
};

/** Serialized PPO weights stored in DB (hologram_avatar.ppo_weights) */
export type PPOWeights = {
  w1: number[];  // flattened input→hidden weights (12×64 = 768)
  b1: number[];  // hidden biases (64)
  w2: number[];  // flattened hidden→actor output (64×8 = 512)
  b2: number[];  // actor output biases (8)
  wv: number[];  // flattened hidden→value output (64×1 = 64)
  bv: number[];  // value bias (1)
  stepCount: number;
  lastReward: number;
};

/** Single rollout step for PPO training */
export type RolloutStep = {
  state: Float64Array;   // 12-dim
  action: Float64Array;  // 8-dim
  logProb: number;
  value: number;
  reward: number;
  done: boolean;
};

// ── PoseBuffer Binary Protocol ──────────────────────────

/**
 * Binary layout for a single pose frame:
 *   jointRotations: 20 joints × 3 floats (rx, ry, rz) = 60 floats = 240 bytes
 *   morphWeights:   4 floats = 16 bytes
 *   emotionIdx:     1 byte (uint8)
 *   timestamp:      4 bytes (uint32)
 *   Total: 261 bytes per frame
 */
export const POSE_BUFFER_JOINTS = 20;
export const POSE_BUFFER_MORPHS = 4;
export const POSE_BUFFER_HEADER_SIZE = 5; // emotionIdx(1) + timestamp(4)
export const POSE_BUFFER_FLOAT_COUNT = POSE_BUFFER_JOINTS * 3 + POSE_BUFFER_MORPHS; // 64
export const POSE_BUFFER_BYTE_SIZE =
  POSE_BUFFER_FLOAT_COUNT * 4 + POSE_BUFFER_HEADER_SIZE; // 261 bytes

/** Canonical joint ordering for binary serialization */
export const POSE_JOINT_ORDER = [
  'root', 'spine', 'chest', 'neck', 'head',
  'l_shoulder', 'l_elbow', 'l_hand',
  'r_shoulder', 'r_elbow', 'r_hand',
  'l_hip', 'l_knee', 'l_foot',
  'r_hip', 'r_knee', 'r_foot',
  'l_toe', 'r_toe', 'pelvis',
] as const;

/** Decoded pose buffer frame */
export type PoseBufferFrame = {
  jointRotations: Record<string, { rx: number; ry: number; rz: number }>;
  morphWeights: [number, number, number, number];
  emotionIdx: number;
  timestamp: number;
};
