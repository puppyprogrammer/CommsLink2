/**
 * Hologram GA Evolution Trainer v2.0
 *
 * Offline genetic algorithm that evolves hologram poses for emotion expressions.
 * Population: 120, Generations: 180
 * Fitness = 0.55*perceptualHash + 0.35*BVHdist + 0.10*kinematicsValid
 * Convergence threshold: 0.97
 *
 * Outputs per-vertex morph target deltas compatible with HologramViewer.
 *
 * Usage:
 *   npx ts-node scripts/ga_trainer.ts                    # evolve all 4 emotions
 *   npx ts-node scripts/ga_trainer.ts --emotion=happy    # single emotion
 *   npx ts-node scripts/ga_trainer.ts --output=out.json  # custom output path
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Types ──────────────────────────────────────────────

type Vec3 = [number, number, number];

type JointDef = {
  id: string;
  position: Vec3;
  parent_id: string | null;
};

type PoseJoint = {
  rx: number;
  ry: number;
  rz: number;
};

type PoseData = {
  joints: Record<string, PoseJoint>;
};

type PointMorph = {
  joint_id: string;
  offset_delta: Vec3;
  size_scale: number;
};

type Individual = {
  pose: PoseData;
  point_morphs: PointMorph[];
  fitness: number;
};

type EmotionTarget = {
  name: string;
  target_pose: PoseData;
  point_emphasis: Record<string, { size_scale: number; offset_delta: Vec3 }>;
  kinematic_weights: Record<string, number>;
};

type MorphTargetEntry = {
  emotion: string;
  pose: PoseData;
  point_morphs: PointMorph[];
  fitness: number;
  generation: number;
};

type BVHSample = {
  label: string;
  joints: Record<string, PoseJoint>;
};

// ── Constants ──────────────────────────────────────────

const POPULATION_SIZE = 120;
const GENERATIONS = 180;
const MUTATION_RATE = 0.15;
const CROSSOVER_RATE = 0.7;
const ELITE_COUNT = 8;
const TOURNAMENT_SIZE = 5;
const MAX_JOINT_ANGLE = Math.PI * 0.75;
const ANGLE_MUTATION_SIGMA = 0.15;
const MORPH_MUTATION_SIGMA = 0.05;
const FITNESS_THRESHOLD = 0.97;

// Fitness weights (v2 spec)
const W_PERCEPTUAL = 0.55;
const W_BVH_DIST = 0.35;
const W_KINEMATICS = 0.10;

// ── Humanoid Skeleton (matches HologramEditor preset) ─

const HUMANOID_SKELETON: JointDef[] = [
  { id: 'root', position: [0, 0.9, 0], parent_id: null },
  { id: 'spine', position: [0, 0.15, 0], parent_id: 'root' },
  { id: 'chest', position: [0, 0.15, 0], parent_id: 'spine' },
  { id: 'neck', position: [0, 0.1, 0], parent_id: 'chest' },
  { id: 'head', position: [0, 0.15, 0], parent_id: 'neck' },
  { id: 'l_shoulder', position: [-0.18, 0.0, 0], parent_id: 'chest' },
  { id: 'r_shoulder', position: [0.18, 0.0, 0], parent_id: 'chest' },
  { id: 'l_elbow', position: [-0.25, 0.0, 0], parent_id: 'l_shoulder' },
  { id: 'r_elbow', position: [0.25, 0.0, 0], parent_id: 'r_shoulder' },
  { id: 'l_hand', position: [-0.22, 0.0, 0], parent_id: 'l_elbow' },
  { id: 'r_hand', position: [0.22, 0.0, 0], parent_id: 'r_elbow' },
  { id: 'l_hip', position: [-0.1, 0.0, 0], parent_id: 'root' },
  { id: 'r_hip', position: [0.1, 0.0, 0], parent_id: 'root' },
  { id: 'l_knee', position: [0, -0.4, 0], parent_id: 'l_hip' },
  { id: 'r_knee', position: [0, -0.4, 0], parent_id: 'r_hip' },
  { id: 'l_foot', position: [0, -0.4, 0], parent_id: 'l_knee' },
  { id: 'r_foot', position: [0, -0.4, 0], parent_id: 'r_knee' },
];

const HUMANOID_POINTS = [
  { joint_id: 'head', offset: [0, 0.08, 0] as Vec3 },
  { joint_id: 'head', offset: [-0.04, 0.06, 0.06] as Vec3 },
  { joint_id: 'head', offset: [0.04, 0.06, 0.06] as Vec3 },
  { joint_id: 'chest', offset: [0, 0, 0] as Vec3 },
  { joint_id: 'l_hand', offset: [0, 0, 0] as Vec3 },
  { joint_id: 'r_hand', offset: [0, 0, 0] as Vec3 },
  { joint_id: 'l_foot', offset: [0, 0, 0] as Vec3 },
  { joint_id: 'r_foot', offset: [0, 0, 0] as Vec3 },
];

const JOINT_IDS = HUMANOID_SKELETON.map((j) => j.id);

// ── BVH Reference Dataset ─────────────────────────────
// Synthetic BVH samples representing canonical human poses for each emotion.
// In a full pipeline these would be parsed from .bvh motion capture files.
// Each sample provides reference joint angles that real humans produce.

const BVH_DATASET: Record<string, BVHSample[]> = {
  happy: [
    {
      label: 'arms_raised_celebration',
      joints: {
        head: { rx: -0.12, ry: 0.05, rz: 0 },
        neck: { rx: -0.08, ry: 0, rz: 0 },
        chest: { rx: -0.06, ry: 0, rz: 0 },
        spine: { rx: -0.04, ry: 0, rz: 0 },
        l_shoulder: { rx: -0.1, ry: 0, rz: 0.7 },
        r_shoulder: { rx: -0.1, ry: 0, rz: -0.7 },
        l_elbow: { rx: 0, ry: 0, rz: 0.5 },
        r_elbow: { rx: 0, ry: 0, rz: -0.5 },
        l_hand: { rx: 0, ry: 0, rz: 0.2 },
        r_hand: { rx: 0, ry: 0, rz: -0.2 },
      },
    },
    {
      label: 'open_posture_joy',
      joints: {
        head: { rx: -0.18, ry: 0, rz: 0.03 },
        neck: { rx: -0.1, ry: 0, rz: 0 },
        chest: { rx: -0.05, ry: 0, rz: 0 },
        spine: { rx: -0.03, ry: 0, rz: 0 },
        l_shoulder: { rx: 0, ry: 0, rz: 0.5 },
        r_shoulder: { rx: 0, ry: 0, rz: -0.5 },
        l_elbow: { rx: 0, ry: 0, rz: 0.3 },
        r_elbow: { rx: 0, ry: 0, rz: -0.3 },
        l_hand: { rx: 0, ry: 0.1, rz: 0.15 },
        r_hand: { rx: 0, ry: -0.1, rz: -0.15 },
      },
    },
  ],
  sad: [
    {
      label: 'slumped_dejection',
      joints: {
        head: { rx: 0.4, ry: 0, rz: 0 },
        neck: { rx: 0.25, ry: 0, rz: 0 },
        chest: { rx: 0.18, ry: 0, rz: 0 },
        spine: { rx: 0.12, ry: 0, rz: 0 },
        l_shoulder: { rx: 0.1, ry: 0, rz: -0.25 },
        r_shoulder: { rx: 0.1, ry: 0, rz: 0.25 },
        l_elbow: { rx: 0, ry: 0, rz: -0.15 },
        r_elbow: { rx: 0, ry: 0, rz: 0.15 },
        l_hand: { rx: 0, ry: 0, rz: 0 },
        r_hand: { rx: 0, ry: 0, rz: 0 },
      },
    },
    {
      label: 'head_down_withdrawn',
      joints: {
        head: { rx: 0.3, ry: 0.1, rz: 0.05 },
        neck: { rx: 0.2, ry: 0.05, rz: 0 },
        chest: { rx: 0.12, ry: 0, rz: 0.03 },
        spine: { rx: 0.08, ry: 0, rz: 0 },
        l_shoulder: { rx: 0.15, ry: 0.1, rz: -0.35 },
        r_shoulder: { rx: 0.15, ry: -0.1, rz: 0.35 },
        l_elbow: { rx: -0.1, ry: 0, rz: -0.1 },
        r_elbow: { rx: -0.1, ry: 0, rz: 0.1 },
        l_hand: { rx: 0.05, ry: 0, rz: 0 },
        r_hand: { rx: 0.05, ry: 0, rz: 0 },
      },
    },
  ],
  angry: [
    {
      label: 'fists_clenched_forward',
      joints: {
        head: { rx: 0.08, ry: 0, rz: 0 },
        neck: { rx: 0.05, ry: 0, rz: 0 },
        chest: { rx: 0.06, ry: 0, rz: 0 },
        spine: { rx: 0.04, ry: 0, rz: 0 },
        l_shoulder: { rx: -0.35, ry: 0.2, rz: 0.45 },
        r_shoulder: { rx: -0.35, ry: -0.2, rz: -0.45 },
        l_elbow: { rx: -0.9, ry: 0, rz: 0.7 },
        r_elbow: { rx: -0.9, ry: 0, rz: -0.7 },
        l_hand: { rx: 0, ry: 0, rz: 0.35 },
        r_hand: { rx: 0, ry: 0, rz: -0.35 },
      },
    },
    {
      label: 'aggressive_stance',
      joints: {
        head: { rx: 0.12, ry: 0, rz: 0 },
        neck: { rx: 0.06, ry: 0, rz: 0 },
        chest: { rx: 0.04, ry: 0, rz: 0 },
        spine: { rx: 0.06, ry: 0, rz: 0 },
        l_shoulder: { rx: -0.25, ry: 0.15, rz: 0.35 },
        r_shoulder: { rx: -0.25, ry: -0.15, rz: -0.35 },
        l_elbow: { rx: -0.7, ry: 0, rz: 0.5 },
        r_elbow: { rx: -0.7, ry: 0, rz: -0.5 },
        l_hand: { rx: 0.05, ry: 0, rz: 0.25 },
        r_hand: { rx: 0.05, ry: 0, rz: -0.25 },
      },
    },
  ],
  neutral: [
    {
      label: 'standing_relaxed',
      joints: {
        head: { rx: 0, ry: 0, rz: 0 },
        neck: { rx: 0, ry: 0, rz: 0 },
        chest: { rx: 0, ry: 0, rz: 0 },
        spine: { rx: 0, ry: 0, rz: 0 },
        l_shoulder: { rx: 0, ry: 0, rz: 0.05 },
        r_shoulder: { rx: 0, ry: 0, rz: -0.05 },
        l_elbow: { rx: 0, ry: 0, rz: 0.05 },
        r_elbow: { rx: 0, ry: 0, rz: -0.05 },
        l_hand: { rx: 0, ry: 0, rz: 0 },
        r_hand: { rx: 0, ry: 0, rz: 0 },
      },
    },
    {
      label: 'idle_pose',
      joints: {
        head: { rx: 0.02, ry: 0.03, rz: 0 },
        neck: { rx: 0.01, ry: 0, rz: 0 },
        chest: { rx: 0.01, ry: 0, rz: 0 },
        spine: { rx: 0.01, ry: 0, rz: 0 },
        l_shoulder: { rx: 0, ry: 0, rz: 0.08 },
        r_shoulder: { rx: 0, ry: 0, rz: -0.08 },
        l_elbow: { rx: -0.05, ry: 0, rz: 0.1 },
        r_elbow: { rx: -0.05, ry: 0, rz: -0.1 },
        l_hand: { rx: 0, ry: 0, rz: 0.02 },
        r_hand: { rx: 0, ry: 0, rz: -0.02 },
      },
    },
  ],
};

// ── Emotion Target Poses (derived from body language research) ─

const EMOTION_TARGETS: Record<string, EmotionTarget> = {
  happy: {
    name: 'happy',
    target_pose: {
      joints: {
        head: { rx: -0.15, ry: 0, rz: 0 },
        neck: { rx: -0.1, ry: 0, rz: 0 },
        chest: { rx: -0.05, ry: 0, rz: 0 },
        l_shoulder: { rx: 0, ry: 0, rz: 0.6 },
        r_shoulder: { rx: 0, ry: 0, rz: -0.6 },
        l_elbow: { rx: 0, ry: 0, rz: 0.4 },
        r_elbow: { rx: 0, ry: 0, rz: -0.4 },
        l_hand: { rx: 0, ry: 0, rz: 0.2 },
        r_hand: { rx: 0, ry: 0, rz: -0.2 },
        spine: { rx: -0.05, ry: 0, rz: 0 },
      },
    },
    point_emphasis: {
      head: { size_scale: 1.3, offset_delta: [0, 0.02, 0] },
      l_hand: { size_scale: 1.2, offset_delta: [0, 0.01, 0] },
      r_hand: { size_scale: 1.2, offset_delta: [0, 0.01, 0] },
    },
    kinematic_weights: {
      head: 2.0,
      chest: 1.5,
      l_shoulder: 1.8,
      r_shoulder: 1.8,
      l_elbow: 1.2,
      r_elbow: 1.2,
    },
  },
  sad: {
    name: 'sad',
    target_pose: {
      joints: {
        head: { rx: 0.35, ry: 0, rz: 0 },
        neck: { rx: 0.2, ry: 0, rz: 0 },
        chest: { rx: 0.15, ry: 0, rz: 0 },
        spine: { rx: 0.1, ry: 0, rz: 0 },
        l_shoulder: { rx: 0.1, ry: 0, rz: -0.3 },
        r_shoulder: { rx: 0.1, ry: 0, rz: 0.3 },
        l_elbow: { rx: 0, ry: 0, rz: -0.1 },
        r_elbow: { rx: 0, ry: 0, rz: 0.1 },
        l_hand: { rx: 0, ry: 0, rz: 0 },
        r_hand: { rx: 0, ry: 0, rz: 0 },
      },
    },
    point_emphasis: {
      head: { size_scale: 0.85, offset_delta: [0, -0.02, 0] },
      chest: { size_scale: 0.9, offset_delta: [0, -0.01, 0] },
    },
    kinematic_weights: {
      head: 2.5,
      neck: 2.0,
      chest: 2.0,
      spine: 1.5,
      l_shoulder: 1.5,
      r_shoulder: 1.5,
    },
  },
  angry: {
    name: 'angry',
    target_pose: {
      joints: {
        head: { rx: 0.1, ry: 0, rz: 0 },
        neck: { rx: 0.05, ry: 0, rz: 0 },
        chest: { rx: 0.05, ry: 0, rz: 0 },
        l_shoulder: { rx: -0.3, ry: 0.2, rz: 0.4 },
        r_shoulder: { rx: -0.3, ry: -0.2, rz: -0.4 },
        l_elbow: { rx: -0.8, ry: 0, rz: 0.6 },
        r_elbow: { rx: -0.8, ry: 0, rz: -0.6 },
        l_hand: { rx: 0, ry: 0, rz: 0.3 },
        r_hand: { rx: 0, ry: 0, rz: -0.3 },
        spine: { rx: 0.05, ry: 0, rz: 0 },
      },
    },
    point_emphasis: {
      head: { size_scale: 1.4, offset_delta: [0, 0, 0.02] },
      l_hand: { size_scale: 1.5, offset_delta: [0, 0, 0] },
      r_hand: { size_scale: 1.5, offset_delta: [0, 0, 0] },
    },
    kinematic_weights: {
      l_shoulder: 2.0,
      r_shoulder: 2.0,
      l_elbow: 2.5,
      r_elbow: 2.5,
      l_hand: 1.5,
      r_hand: 1.5,
      head: 1.5,
    },
  },
  neutral: {
    name: 'neutral',
    target_pose: {
      joints: {
        head: { rx: 0, ry: 0, rz: 0 },
        neck: { rx: 0, ry: 0, rz: 0 },
        chest: { rx: 0, ry: 0, rz: 0 },
        spine: { rx: 0, ry: 0, rz: 0 },
        l_shoulder: { rx: 0, ry: 0, rz: 0.05 },
        r_shoulder: { rx: 0, ry: 0, rz: -0.05 },
        l_elbow: { rx: 0, ry: 0, rz: 0.05 },
        r_elbow: { rx: 0, ry: 0, rz: -0.05 },
        l_hand: { rx: 0, ry: 0, rz: 0 },
        r_hand: { rx: 0, ry: 0, rz: 0 },
      },
    },
    point_emphasis: {
      head: { size_scale: 1.0, offset_delta: [0, 0, 0] },
      chest: { size_scale: 1.0, offset_delta: [0, 0, 0] },
    },
    kinematic_weights: {
      head: 1.5,
      neck: 1.0,
      chest: 1.0,
      spine: 1.0,
      l_shoulder: 1.0,
      r_shoulder: 1.0,
    },
  },
};

// ── Utility Functions ──────────────────────────────────

const gaussianRandom = (mean: number, sigma: number): number => {
  const u1 = Math.random();
  const u2 = Math.random();
  return mean + sigma * Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
};

const clamp = (val: number, min: number, max: number): number => Math.max(min, Math.min(max, val));

const angleDist = (a: PoseJoint, b: PoseJoint): number => {
  const dx = a.rx - b.rx;
  const dy = a.ry - b.ry;
  const dz = a.rz - b.rz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

// ── Kinematic Validity ─────────────────────────────────

const JOINT_LIMITS: Record<string, { rx: Vec3; ry: Vec3; rz: Vec3 }> = {
  head: { rx: [-0.7, 0.7, 0], ry: [-1.0, 1.0, 0], rz: [-0.5, 0.5, 0] },
  neck: { rx: [-0.4, 0.4, 0], ry: [-0.5, 0.5, 0], rz: [-0.3, 0.3, 0] },
  chest: { rx: [-0.3, 0.5, 0], ry: [-0.3, 0.3, 0], rz: [-0.2, 0.2, 0] },
  spine: { rx: [-0.3, 0.4, 0], ry: [-0.3, 0.3, 0], rz: [-0.2, 0.2, 0] },
  l_shoulder: { rx: [-1.5, 0.5, 0], ry: [-0.5, 1.5, 0], rz: [-0.5, 2.0, 0] },
  r_shoulder: { rx: [-1.5, 0.5, 0], ry: [-1.5, 0.5, 0], rz: [-2.0, 0.5, 0] },
  l_elbow: { rx: [-2.0, 0.1, 0], ry: [-0.5, 0.5, 0], rz: [-0.2, 2.5, 0] },
  r_elbow: { rx: [-2.0, 0.1, 0], ry: [-0.5, 0.5, 0], rz: [-2.5, 0.2, 0] },
  l_hand: { rx: [-0.8, 0.8, 0], ry: [-0.5, 0.5, 0], rz: [-0.5, 0.5, 0] },
  r_hand: { rx: [-0.8, 0.8, 0], ry: [-0.5, 0.5, 0], rz: [-0.5, 0.5, 0] },
  l_hip: { rx: [-0.5, 1.5, 0], ry: [-0.5, 0.3, 0], rz: [-0.3, 0.8, 0] },
  r_hip: { rx: [-0.5, 1.5, 0], ry: [-0.3, 0.5, 0], rz: [-0.8, 0.3, 0] },
  l_knee: { rx: [0, 2.5, 0], ry: [-0.1, 0.1, 0], rz: [-0.1, 0.1, 0] },
  r_knee: { rx: [0, 2.5, 0], ry: [-0.1, 0.1, 0], rz: [-0.1, 0.1, 0] },
  l_foot: { rx: [-0.5, 0.8, 0], ry: [-0.3, 0.3, 0], rz: [-0.3, 0.3, 0] },
  r_foot: { rx: [-0.5, 0.8, 0], ry: [-0.3, 0.3, 0], rz: [-0.3, 0.3, 0] },
};

const kinematicPenalty = (jointId: string, pj: PoseJoint): number => {
  const limits = JOINT_LIMITS[jointId];
  if (!limits) return 0;

  let penalty = 0;
  const axes: Array<'rx' | 'ry' | 'rz'> = ['rx', 'ry', 'rz'];
  for (const axis of axes) {
    const val = pj[axis];
    const [min, max] = limits[axis];
    if (val < min) penalty += (min - val) * (min - val);
    if (val > max) penalty += (val - max) * (val - max);
  }
  return penalty;
};

/** Resolve absolute joint positions given a pose. */
const resolvePositions = (skeleton: JointDef[], pose: PoseData): Map<string, Vec3> => {
  const positions = new Map<string, Vec3>();

  for (const joint of skeleton) {
    const base: Vec3 = [...joint.position];
    if (joint.parent_id && positions.has(joint.parent_id)) {
      const parentPos = positions.get(joint.parent_id)!;
      base[0] += parentPos[0];
      base[1] += parentPos[1];
      base[2] += parentPos[2];
    }
    positions.set(joint.id, base);
  }

  for (const joint of skeleton) {
    const pj = pose.joints[joint.id];
    if (!pj || !joint.parent_id) continue;

    const pos = positions.get(joint.id);
    const parentPos = positions.get(joint.parent_id);
    if (!pos || !parentPos) continue;

    const ox = pos[0] - parentPos[0];
    const oy = pos[1] - parentPos[1];
    const oz = pos[2] - parentPos[2];

    const cx = Math.cos(pj.rx), sx = Math.sin(pj.rx);
    const cy = Math.cos(pj.ry), sy = Math.sin(pj.ry);
    const cz = Math.cos(pj.rz), sz = Math.sin(pj.rz);

    const nx = cy * cz * ox + (sx * sy * cz - cx * sz) * oy + (cx * sy * cz + sx * sz) * oz;
    const ny = cy * sz * ox + (sx * sy * sz + cx * cz) * oy + (cx * sy * sz - sx * cz) * oz;
    const nz = -sy * ox + sx * cy * oy + cx * cy * oz;

    positions.set(joint.id, [parentPos[0] + nx, parentPos[1] + ny, parentPos[2] + nz]);
  }

  return positions;
};

// ── Perceptual Hash Similarity ─────────────────────────

const HASH_GRID_SIZE = 8;

const posePerceptualHash = (skeleton: JointDef[], pose: PoseData): Uint8Array => {
  const positions = resolvePositions(skeleton, pose);
  const hash = new Uint8Array(HASH_GRID_SIZE * HASH_GRID_SIZE);

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const [, pos] of positions) {
    minX = Math.min(minX, pos[0]);
    maxX = Math.max(maxX, pos[0]);
    minY = Math.min(minY, pos[1]);
    maxY = Math.max(maxY, pos[1]);
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  for (const [, pos] of positions) {
    const gx = Math.floor(((pos[0] - minX) / rangeX) * (HASH_GRID_SIZE - 1));
    const gy = Math.floor(((pos[1] - minY) / rangeY) * (HASH_GRID_SIZE - 1));
    hash[gy * HASH_GRID_SIZE + gx] = 1;
  }

  return hash;
};

const hashSimilarity = (a: Uint8Array, b: Uint8Array): number => {
  let matching = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 1 || b[i] === 1) {
      total++;
      if (a[i] === b[i]) matching++;
    }
  }
  return total === 0 ? 1 : matching / total;
};

// ── BVH Distance ───────────────────────────────────────

/**
 * Compute distance between an individual's pose and BVH reference samples.
 * Returns a similarity score [0..1] — 1.0 = perfect match to closest BVH sample.
 * Uses weighted joint angle comparison against all BVH samples for the emotion,
 * returning the best (closest) match.
 */
const bvhDistance = (pose: PoseData, emotion: string, target: EmotionTarget): number => {
  const samples = BVH_DATASET[emotion];
  if (!samples || samples.length === 0) return 0;

  let bestSimilarity = 0;

  for (const sample of samples) {
    let totalWeightedDist = 0;
    let totalWeight = 0;

    for (const jointId of JOINT_IDS) {
      const sampleJoint = sample.joints[jointId];
      if (!sampleJoint) continue;

      const poseJoint = pose.joints[jointId] || { rx: 0, ry: 0, rz: 0 };
      const weight = target.kinematic_weights[jointId] || 1.0;
      const dist = angleDist(poseJoint, sampleJoint);

      totalWeightedDist += weight * dist;
      totalWeight += weight;
    }

    const avgDist = totalWeight > 0 ? totalWeightedDist / totalWeight : 0;
    // Convert distance to similarity: exp decay, tuned so dist=0 → 1.0, dist=1.0 → ~0.14
    const similarity = Math.exp(-avgDist * 2);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
    }
  }

  return bestSimilarity;
};

// ── Fitness Function (v2 spec) ─────────────────────────
//
// fitness = 0.55 * perceptualHash(pose)
//         + 0.35 * BVHdist(pose, targetBVH)
//         + 0.10 * kinematicsValid
//
// Convergence threshold: 0.97

const evaluateFitness = (individual: Individual, target: EmotionTarget): number => {
  const { pose } = individual;

  // 1. Perceptual hash similarity (0.55 weight)
  const indHash = posePerceptualHash(HUMANOID_SKELETON, pose);
  const targetHash = posePerceptualHash(HUMANOID_SKELETON, target.target_pose);
  const perceptualScore = hashSimilarity(indHash, targetHash);

  // 2. BVH distance — similarity to reference motion capture poses (0.35 weight)
  const bvhScore = bvhDistance(pose, target.name, target);

  // 3. Kinematic validity — penalize biomechanically impossible poses (0.10 weight)
  let kinPenalty = 0;
  for (const jointId of JOINT_IDS) {
    const pj = pose.joints[jointId];
    if (pj) kinPenalty += kinematicPenalty(jointId, pj);
  }
  const kinScore = Math.max(0, 1 - kinPenalty);

  return W_PERCEPTUAL * perceptualScore + W_BVH_DIST * bvhScore + W_KINEMATICS * kinScore;
};

// ── GA Operations ──────────────────────────────────────

const randomIndividual = (): Individual => {
  const joints: Record<string, PoseJoint> = {};

  for (const jointId of JOINT_IDS) {
    if (jointId === 'root') continue;
    const limits = JOINT_LIMITS[jointId];
    if (limits) {
      joints[jointId] = {
        rx: clamp(gaussianRandom(0, 0.3), limits.rx[0], limits.rx[1]),
        ry: clamp(gaussianRandom(0, 0.2), limits.ry[0], limits.ry[1]),
        rz: clamp(gaussianRandom(0, 0.3), limits.rz[0], limits.rz[1]),
      };
    } else {
      joints[jointId] = {
        rx: gaussianRandom(0, 0.2),
        ry: gaussianRandom(0, 0.2),
        rz: gaussianRandom(0, 0.2),
      };
    }
  }

  const point_morphs: PointMorph[] = HUMANOID_POINTS.map((p) => ({
    joint_id: p.joint_id,
    offset_delta: [
      gaussianRandom(0, MORPH_MUTATION_SIGMA),
      gaussianRandom(0, MORPH_MUTATION_SIGMA),
      gaussianRandom(0, MORPH_MUTATION_SIGMA),
    ] as Vec3,
    size_scale: clamp(1 + gaussianRandom(0, 0.15), 0.5, 2.0),
  }));

  return { pose: { joints }, point_morphs, fitness: 0 };
};

/** Create an individual seeded from a BVH sample. */
const bvhSeededIndividual = (sample: BVHSample): Individual => {
  const joints: Record<string, PoseJoint> = {};

  for (const jointId of JOINT_IDS) {
    if (jointId === 'root') continue;
    const sampleJoint = sample.joints[jointId];
    if (sampleJoint) {
      // Add small noise to BVH reference
      joints[jointId] = {
        rx: sampleJoint.rx + gaussianRandom(0, 0.05),
        ry: sampleJoint.ry + gaussianRandom(0, 0.05),
        rz: sampleJoint.rz + gaussianRandom(0, 0.05),
      };
    } else {
      joints[jointId] = { rx: 0, ry: 0, rz: 0 };
    }
  }

  const point_morphs: PointMorph[] = HUMANOID_POINTS.map((p) => ({
    joint_id: p.joint_id,
    offset_delta: [
      gaussianRandom(0, MORPH_MUTATION_SIGMA),
      gaussianRandom(0, MORPH_MUTATION_SIGMA),
      gaussianRandom(0, MORPH_MUTATION_SIGMA),
    ] as Vec3,
    size_scale: clamp(1 + gaussianRandom(0, 0.1), 0.5, 2.0),
  }));

  return { pose: { joints }, point_morphs, fitness: 0 };
};

const tournamentSelect = (population: Individual[]): Individual => {
  let best: Individual | null = null;
  for (let i = 0; i < TOURNAMENT_SIZE; i++) {
    const candidate = population[Math.floor(Math.random() * population.length)];
    if (!best || candidate.fitness > best.fitness) {
      best = candidate;
    }
  }
  return best!;
};

const crossover = (parent1: Individual, parent2: Individual): Individual => {
  const joints: Record<string, PoseJoint> = {};

  for (const jointId of JOINT_IDS) {
    if (jointId === 'root') continue;
    const p1 = parent1.pose.joints[jointId] || { rx: 0, ry: 0, rz: 0 };
    const p2 = parent2.pose.joints[jointId] || { rx: 0, ry: 0, rz: 0 };

    if (Math.random() < 0.5) {
      joints[jointId] = { ...p1 };
    } else {
      joints[jointId] = { ...p2 };
    }
  }

  const point_morphs: PointMorph[] = parent1.point_morphs.map((m, i) => {
    const m2 = parent2.point_morphs[i];
    const alpha = Math.random();
    return {
      joint_id: m.joint_id,
      offset_delta: [
        m.offset_delta[0] * alpha + m2.offset_delta[0] * (1 - alpha),
        m.offset_delta[1] * alpha + m2.offset_delta[1] * (1 - alpha),
        m.offset_delta[2] * alpha + m2.offset_delta[2] * (1 - alpha),
      ] as Vec3,
      size_scale: m.size_scale * alpha + m2.size_scale * (1 - alpha),
    };
  });

  return { pose: { joints }, point_morphs, fitness: 0 };
};

const mutate = (individual: Individual): void => {
  for (const jointId of JOINT_IDS) {
    if (jointId === 'root') continue;
    const pj = individual.pose.joints[jointId];
    if (!pj) continue;

    if (Math.random() < MUTATION_RATE) {
      const limits = JOINT_LIMITS[jointId];
      pj.rx = clamp(pj.rx + gaussianRandom(0, ANGLE_MUTATION_SIGMA), limits?.rx[0] ?? -MAX_JOINT_ANGLE, limits?.rx[1] ?? MAX_JOINT_ANGLE);
      pj.ry = clamp(pj.ry + gaussianRandom(0, ANGLE_MUTATION_SIGMA), limits?.ry[0] ?? -MAX_JOINT_ANGLE, limits?.ry[1] ?? MAX_JOINT_ANGLE);
      pj.rz = clamp(pj.rz + gaussianRandom(0, ANGLE_MUTATION_SIGMA), limits?.rz[0] ?? -MAX_JOINT_ANGLE, limits?.rz[1] ?? MAX_JOINT_ANGLE);
    }
  }

  for (const morph of individual.point_morphs) {
    if (Math.random() < MUTATION_RATE) {
      morph.offset_delta[0] += gaussianRandom(0, MORPH_MUTATION_SIGMA);
      morph.offset_delta[1] += gaussianRandom(0, MORPH_MUTATION_SIGMA);
      morph.offset_delta[2] += gaussianRandom(0, MORPH_MUTATION_SIGMA);
      morph.size_scale = clamp(morph.size_scale + gaussianRandom(0, 0.1), 0.5, 2.0);
    }
  }
};

// ── Main GA Loop ───────────────────────────────────────

const runGA = (emotion: string): { results: MorphTargetEntry[]; convergedGen: number | null; peakFitness: number } => {
  const target = EMOTION_TARGETS[emotion];
  if (!target) {
    console.error(`Unknown emotion: ${emotion}. Available: ${Object.keys(EMOTION_TARGETS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n═══ GA Evolution: ${emotion.toUpperCase()} ═══`);
  console.log(`Population: ${POPULATION_SIZE} | Generations: ${GENERATIONS} | Threshold: ${FITNESS_THRESHOLD}`);
  console.log(`Fitness: ${W_PERCEPTUAL}*perceptual + ${W_BVH_DIST}*BVH + ${W_KINEMATICS}*kinematics\n`);

  // Initialize population
  const population: Individual[] = [];

  // Seed with target pose
  population.push({
    pose: JSON.parse(JSON.stringify(target.target_pose)),
    point_morphs: HUMANOID_POINTS.map((p) => {
      const emphasis = target.point_emphasis[p.joint_id];
      return {
        joint_id: p.joint_id,
        offset_delta: emphasis?.offset_delta ? [...emphasis.offset_delta] as Vec3 : [0, 0, 0] as Vec3,
        size_scale: emphasis?.size_scale ?? 1.0,
      };
    }),
    fitness: 0,
  });

  // Seed with BVH samples (with noise variants)
  const bvhSamples = BVH_DATASET[emotion] || [];
  for (const sample of bvhSamples) {
    // 3 variants per BVH sample
    for (let v = 0; v < 3; v++) {
      population.push(bvhSeededIndividual(sample));
    }
  }

  // Fill rest with random individuals
  while (population.length < POPULATION_SIZE) {
    population.push(randomIndividual());
  }

  let bestEver: Individual = population[0];
  let convergedGen: number | null = null;

  for (let gen = 0; gen < GENERATIONS; gen++) {
    // Evaluate fitness
    for (const ind of population) {
      ind.fitness = evaluateFitness(ind, target);
    }

    // Sort by fitness (descending)
    population.sort((a, b) => b.fitness - a.fitness);

    if (population[0].fitness > bestEver.fitness) {
      bestEver = {
        ...population[0],
        pose: JSON.parse(JSON.stringify(population[0].pose)),
        point_morphs: population[0].point_morphs.map((m) => ({ ...m, offset_delta: [...m.offset_delta] as Vec3 })),
      };
    }

    // Check convergence
    if (convergedGen === null && bestEver.fitness >= FITNESS_THRESHOLD) {
      convergedGen = gen;
      console.log(`  ★ CONVERGED at gen ${gen} (fitness=${bestEver.fitness.toFixed(4)} ≥ ${FITNESS_THRESHOLD})`);
    }

    // Log progress every 20 generations
    if (gen % 20 === 0 || gen === GENERATIONS - 1) {
      const avg = population.reduce((s, p) => s + p.fitness, 0) / population.length;
      console.log(
        `  Gen ${String(gen).padStart(3)}: best=${population[0].fitness.toFixed(4)} avg=${avg.toFixed(4)} worst=${population[population.length - 1].fitness.toFixed(4)}`,
      );
    }

    if (gen === GENERATIONS - 1) break;

    // Create next generation
    const nextGen: Individual[] = [];

    // Elitism
    for (let i = 0; i < ELITE_COUNT; i++) {
      nextGen.push({
        pose: JSON.parse(JSON.stringify(population[i].pose)),
        point_morphs: population[i].point_morphs.map((m) => ({ ...m, offset_delta: [...m.offset_delta] as Vec3 })),
        fitness: population[i].fitness,
      });
    }

    // Fill with crossover + mutation
    while (nextGen.length < POPULATION_SIZE) {
      const parent1 = tournamentSelect(population);
      const parent2 = tournamentSelect(population);

      let child: Individual;
      if (Math.random() < CROSSOVER_RATE) {
        child = crossover(parent1, parent2);
      } else {
        child = {
          pose: JSON.parse(JSON.stringify(parent1.pose)),
          point_morphs: parent1.point_morphs.map((m) => ({ ...m, offset_delta: [...m.offset_delta] as Vec3 })),
          fitness: 0,
        };
      }

      mutate(child);
      nextGen.push(child);
    }

    population.length = 0;
    population.push(...nextGen);
  }

  // Collect top 10 unique results
  population.sort((a, b) => b.fitness - a.fitness);
  const top10: MorphTargetEntry[] = [];
  const seen = new Set<string>();

  for (const ind of population) {
    const key = JSON.stringify(ind.pose);
    if (seen.has(key)) continue;
    seen.add(key);
    top10.push({
      emotion,
      pose: ind.pose,
      point_morphs: ind.point_morphs,
      fitness: ind.fitness,
      generation: GENERATIONS,
    });
    if (top10.length >= 10) break;
  }

  console.log(`\n  Best fitness: ${bestEver.fitness.toFixed(4)}${convergedGen !== null ? ` (converged @ gen ${convergedGen})` : ' (did not converge)'}`);
  console.log(`  Top 10 saved (fitness range: ${top10[0].fitness.toFixed(4)} - ${top10[top10.length - 1].fitness.toFixed(4)})\n`);

  return { results: top10, convergedGen, peakFitness: bestEver.fitness };
};

// ── CLI Entry Point ────────────────────────────────────

const main = (): void => {
  const startTime = Date.now();
  const args = process.argv.slice(2);
  const emotionArg = args.find((a) => a.startsWith('--emotion='))?.split('=')[1];
  const outputFile = args.find((a) => a.startsWith('--output='))?.split('=')[1] || 'hologram_samples.json';

  // Default: all 4 target emotions
  const emotions = emotionArg ? [emotionArg] : ['happy', 'sad', 'angry', 'neutral'];

  console.log('╔════════════════════════════════════════════════╗');
  console.log('║   Hologram GA Evolution Trainer v2.0           ║');
  console.log('║   pop=120 gen=180 fitness=pHash+BVH+kin        ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`Emotions to evolve: ${emotions.join(', ')}`);
  console.log(`Fitness threshold: ${FITNESS_THRESHOLD}`);
  console.log(`Output: ${outputFile}`);

  const allResults: Record<string, MorphTargetEntry[]> = {};
  const perfStats: Record<string, { convergedGen: number | null; peakFitness: number; runtimeMs: number }> = {};

  for (const emotion of emotions) {
    const emotionStart = Date.now();
    const { results, convergedGen, peakFitness } = runGA(emotion);
    allResults[emotion] = results;
    perfStats[emotion] = {
      convergedGen,
      peakFitness,
      runtimeMs: Date.now() - emotionStart,
    };
  }

  const totalMs = Date.now() - startTime;

  // Summary
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║   EVOLUTION SUMMARY                            ║');
  console.log('╚════════════════════════════════════════════════╝');
  for (const [emotion, stats] of Object.entries(perfStats)) {
    const status = stats.peakFitness >= FITNESS_THRESHOLD ? '✓ CONVERGED' : '✗ NOT CONVERGED';
    console.log(
      `  ${emotion.padEnd(10)} ${status}  fitness=${stats.peakFitness.toFixed(4)}  gen=${stats.convergedGen ?? '-'}  time=${(stats.runtimeMs / 1000).toFixed(1)}s`,
    );
  }
  console.log(`\n  Total runtime: ${(totalMs / 1000).toFixed(1)}s`);

  // Build output payload
  const output = {
    version: '2.0',
    generated: new Date().toISOString(),
    params: {
      population: POPULATION_SIZE,
      generations: GENERATIONS,
      fitness_weights: { perceptual: W_PERCEPTUAL, bvh: W_BVH_DIST, kinematics: W_KINEMATICS },
      threshold: FITNESS_THRESHOLD,
    },
    performance: perfStats,
    morphTargets: allResults,
  };

  const outPath = path.resolve(outputFile);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`\nResults saved to ${outPath}`);
};

main();
