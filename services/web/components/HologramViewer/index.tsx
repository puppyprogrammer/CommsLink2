'use client';

// React modules
import { useEffect, useRef, useCallback, useMemo, useState } from 'react';

// Node modules
import * as THREE from 'three';

// GA-evolved morph target samples (fallback when backend doesn't provide them)
import gaSamples from '../../public/hologram_samples.json';

// Aura shader for emotion-modulated glow
import { auraVertexShader, auraFragmentShader, AURA_COLORS } from './auraShader';

// Styles
import classes from './HologramViewer.module.scss';
import AnimationPanel from './AnimationPanel';

// ── Binary PoseBuffer constants (must match core/interfaces/hologram.ts) ──
const POSE_BUFFER_JOINTS = 20;
const POSE_BUFFER_MORPHS = 4;
const POSE_BUFFER_BYTE_SIZE = (POSE_BUFFER_JOINTS * 3 + POSE_BUFFER_MORPHS) * 4 + 5; // 261
const POSE_JOINT_ORDER = [
  'root',
  'spine',
  'chest',
  'neck',
  'head',
  'l_shoulder',
  'l_elbow',
  'l_hand',
  'r_shoulder',
  'r_elbow',
  'r_hand',
  'l_hip',
  'l_knee',
  'l_foot',
  'r_hip',
  'r_knee',
  'r_foot',
  'l_toe',
  'r_toe',
  'pelvis',
] as const;

/** Decode binary pose buffer into joint rotations + morph weights */
const decodePoseBuffer = (
  data: Uint8Array,
): {
  joints: Record<string, { rx: number; ry: number; rz: number }>;
  morphWeights: [number, number, number, number];
  emotionIdx: number;
} | null => {
  if (data.byteLength < POSE_BUFFER_BYTE_SIZE) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  const joints: Record<string, { rx: number; ry: number; rz: number }> = {};
  for (let i = 0; i < POSE_BUFFER_JOINTS; i++) {
    const rx = view.getFloat32(offset, true);
    offset += 4;
    const ry = view.getFloat32(offset, true);
    offset += 4;
    const rz = view.getFloat32(offset, true);
    offset += 4;
    if (rx !== 0 || ry !== 0 || rz !== 0) {
      joints[POSE_JOINT_ORDER[i]] = { rx, ry, rz };
    }
  }
  const morphWeights: [number, number, number, number] = [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
    view.getFloat32(offset + 12, true),
  ];
  offset += 16;
  const emotionIdx = view.getUint8(offset);
  return { joints, morphWeights, emotionIdx };
};

// ── Types ──────────────────────────────────────────────

type JointDef = {
  id: string;
  position: [number, number, number];
  parent_id: string | null;
};

type PointDef = {
  joint_id: string;
  offset: [number, number, number];
  color: string;
  size: number;
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
  offset_delta: [number, number, number];
  size_scale: number;
};

type MorphTargetEntry = {
  emotion: string;
  pose: PoseData;
  point_morphs: PointMorph[];
  fitness: number;
};

type AvatarData = {
  id: string;
  userId: string;
  label: string;
  skeleton: JointDef[];
  points: PointDef[];
  pose: PoseData | null;
  physics: boolean;
  morphTargets?: Record<string, MorphTargetEntry[]>;
  activeMorph?: string; // Current emotion morph being applied
  morphWeight?: number; // 0..1 blend weight
};

type VisemeState = {
  viseme: string;
  weight: number;
};

type HologramViewerProps = {
  avatars: AvatarData[];
  visemeStates?: Map<string, VisemeState>; // keyed by avatar label (agent name)
};

// ── Constants ──────────────────────────────────────────

const HOLOGRAM_COLOR = 0x63c5c0;

// Organ color tags for debug mode identification
const ORGAN_COLORS: Record<string, string> = {
  '#ff69b4': 'breastDensity', '#ff2020': 'heartDensity',
  '#ff8888': 'lungDensity', '#e8b030': 'stomachDensity',
  '#c89040': 'intestineDensity', '#ff40a0': 'wombDensity',
  '#ff80c0': 'ovaryDensity', '#ff60b0': 'fallopianDensity',
  '#ff50a0': 'vaginaDensity', '#ff3090': 'cervixDensity',
};
const BONE_COLOR = 0x2a7a76;
const GRID_COLOR = 0x1a3a38;
const MAX_POINT_INSTANCES = 80000;
const MORPH_LERP_SPEED = 4.0; // Weight units per second for smooth transitions

// Debug color map: 10 body-part groups with distinct colors
const DEBUG_COLORS: Record<string, string> = {};
// Head — green
['head'].forEach((j) => (DEBUG_COLORS[j] = '#44cc66'));
// Neck/Shoulders — yellow
['neck', 'l_shoulder', 'r_shoulder'].forEach((j) => (DEBUG_COLORS[j] = '#ffdd44'));
// Chest — orange
['chest'].forEach((j) => (DEBUG_COLORS[j] = '#ff9944'));
// Torso/Spine — yellow-green
['root', 'spine', 'pelvis'].forEach((j) => (DEBUG_COLORS[j] = '#aacc44'));
// Elbows — blue
['l_elbow', 'r_elbow'].forEach((j) => (DEBUG_COLORS[j] = '#4488ff'));
// Hands/Forearms — cyan
['l_hand', 'r_hand'].forEach((j) => (DEBUG_COLORS[j] = '#44ddff'));
// Hips — light pink
['l_hip', 'r_hip'].forEach((j) => (DEBUG_COLORS[j] = '#ff99cc'));
// Knees/Upper legs — pink
['l_knee', 'r_knee'].forEach((j) => (DEBUG_COLORS[j] = '#ff69b4'));
// Feet — magenta
['l_foot', 'r_foot'].forEach((j) => (DEBUG_COLORS[j] = '#cc44cc'));
// Toes — light magenta
['l_toe', 'r_toe'].forEach((j) => (DEBUG_COLORS[j] = '#ee66ee'));

// Global debug API: window.__hologramDebug = { enabled: true, highlight: 'legs' }
type HologramDebugConfig = { enabled: boolean; highlight?: string };
declare global {
  interface Window {
    __hologramDebug?: HologramDebugConfig;
  }
}

// Highlight group mapping for window.__hologramDebug.highlight
const HIGHLIGHT_GROUPS: Record<string, string[]> = {
  head: ['head'],
  neck: ['neck', 'l_shoulder', 'r_shoulder'],
  chest: ['chest'],
  torso: ['root', 'spine', 'pelvis'],
  arms: ['l_elbow', 'r_elbow', 'l_hand', 'r_hand', 'l_shoulder', 'r_shoulder'],
  elbows: ['l_elbow', 'r_elbow'],
  hands: ['l_hand', 'r_hand'],
  legs: ['l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_foot', 'r_foot', 'l_toe', 'r_toe'],
  hips: ['l_hip', 'r_hip'],
  knees: ['l_knee', 'r_knee'],
  feet: ['l_foot', 'r_foot', 'l_toe', 'r_toe'],
};

// ── Particle Hair System ─────────────────────────────────
// Volumetric particle hair: scalp cap + swept-back flow + ponytail
// Rendered as THREE.Points with shader-based sway animation

type HairParticleSystem = {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Points;
  uniforms: { uTime: { value: number } };
};

// Simple 3D noise (hash-based, no dependency)
function noise3D(x: number, y: number, z: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1; // -1..1
}

/** Build the particle hair system: scalp cap + swept-back flow + ponytail.
 *  All positions are relative to the head joint. */
function buildHairParticles(): {
  positions: Float32Array;
  hairT: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
} {
  const allPositions: number[] = [];
  const allHairT: number[] = [];
  const allColors: number[] = [];
  const allSizes: number[] = [];

  // Head geometry constants (relative to head joint)
  // New head: center at [0, 0.08, 0], W=0.066, H=0.043, D=0.037
  const scalpCenter = new THREE.Vector3(0, 0.08, 0);
  const scalpRadius = 0.07; // slightly larger than head to sit on top
  const tiePoint = new THREE.Vector3(0, 0.04, -0.08);
  const ponytailLength = 0.35;
  const ponytailSpread = 0.05;
  const noiseScale = 5.0;
  const noiseAmp = 0.03;

  const baseColor = new THREE.Color('#7eeae5'); // bright teal at scalp
  const tipColor = new THREE.Color('#3a9e98'); // darker teal at tips

  // ── Zone 1: Scalp Cap (~2500 particles) ──
  for (let i = 0; i < 2500; i++) {
    // Upper hemisphere, biased to top/back (avoid face)
    const phi = Math.acos(1 - Math.random() * 0.7); // 0..~0.8 rad from top
    const theta = Math.random() * Math.PI * 2;

    // Skip front-face area: if pointing forward (+Z) and low, skip
    const sz = Math.sin(phi) * Math.sin(theta);
    if (sz > 0.4 && phi > 0.5) continue;

    const x = scalpCenter.x + scalpRadius * Math.sin(phi) * Math.cos(theta);
    const y = scalpCenter.y + scalpRadius * Math.cos(phi);
    const z = scalpCenter.z + scalpRadius * Math.sin(phi) * Math.sin(theta);

    // Slight random displacement along normal for texture
    const disp = 0.01 + Math.random() * 0.02;
    const nx = (x - scalpCenter.x) / scalpRadius;
    const ny = (y - scalpCenter.y) / scalpRadius;
    const nz = (z - scalpCenter.z) / scalpRadius;

    allPositions.push(x + nx * disp, y + ny * disp, z + nz * disp);
    allHairT.push(0); // scalp = 0
    const c = baseColor.clone().lerp(tipColor, Math.random() * 0.2);
    allColors.push(c.r, c.g, c.b);
    allSizes.push(0.008 + Math.random() * 0.005);
  }

  // ── Zone 2: Swept-Back Flow (~2000 particles, 40 guide curves) ──
  const flowCurveCount = 40;
  const flowParticlesPerCurve = 50;

  for (let ci = 0; ci < flowCurveCount; ci++) {
    // Start: random point on upper scalp
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.5; // upper half
    const start = new THREE.Vector3(
      scalpCenter.x + scalpRadius * Math.sin(phi) * Math.cos(theta),
      scalpCenter.y + scalpRadius * Math.cos(phi),
      scalpCenter.z + scalpRadius * Math.sin(phi) * Math.sin(theta),
    );

    const end = tiePoint.clone();

    // Control points sweep back along head surface
    const cp1 = start.clone().lerp(end, 0.33);
    cp1.y += 0.02;
    // Push cp1 outward from head center to keep curve on surface
    const cp1Dir = cp1.clone().sub(scalpCenter).normalize();
    cp1.copy(scalpCenter).addScaledVector(cp1Dir, scalpRadius * 1.05);

    const cp2 = start.clone().lerp(end, 0.66);
    const cp2Dir = cp2.clone().sub(scalpCenter).normalize();
    cp2.copy(scalpCenter).addScaledVector(cp2Dir, scalpRadius * 1.02);

    const curve = new THREE.CubicBezierCurve3(start, cp1, cp2, end);

    for (let pi = 0; pi < flowParticlesPerCurve; pi++) {
      const t = pi / (flowParticlesPerCurve - 1);
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();

      // Perpendicular vectors for volume offset
      const up = new THREE.Vector3(0, 1, 0);
      const perp1 = new THREE.Vector3().crossVectors(tangent, up).normalize();
      if (perp1.lengthSq() < 0.001) perp1.set(1, 0, 0);
      const perp2 = new THREE.Vector3().crossVectors(tangent, perp1).normalize();

      // Noise-based perpendicular offset for volume (key for avoiding flat-line look)
      const radius = noiseAmp * (1 - t * 0.6); // thicker near scalp
      const nAngle = noise3D(point.x * noiseScale, point.y * noiseScale, point.z * noiseScale + ci) * Math.PI * 2;
      const nRadius =
        Math.abs(noise3D(point.x * noiseScale + 100, point.y * noiseScale, point.z * noiseScale + ci)) * radius;

      const offset = perp1
        .clone()
        .multiplyScalar(Math.cos(nAngle) * nRadius)
        .add(perp2.clone().multiplyScalar(Math.sin(nAngle) * nRadius));

      allPositions.push(point.x + offset.x, point.y + offset.y, point.z + offset.z);
      allHairT.push(0.1 + t * 0.4); // 0.1..0.5 for flow zone
      const c = baseColor.clone().lerp(tipColor, t * 0.4);
      allColors.push(c.r, c.g, c.b);
      allSizes.push(0.007 + Math.random() * 0.004);
    }
  }

  // ── Zone 3: Ponytail (~2500 particles, 20 guide curves) ──
  const tailCurveCount = 20;
  const tailParticlesPerCurve = 125;

  for (let ci = 0; ci < tailCurveCount; ci++) {
    const start = tiePoint.clone();

    // End: hanging down with slight spread
    const spreadAngle = Math.random() * Math.PI * 2;
    const spreadR = Math.random() * ponytailSpread;
    const end = new THREE.Vector3(
      tiePoint.x + Math.cos(spreadAngle) * spreadR * 0.5,
      tiePoint.y - ponytailLength,
      tiePoint.z + Math.sin(spreadAngle) * spreadR * 0.5 - 0.03, // slight backward bias
    );

    const cp1 = start.clone();
    cp1.y -= ponytailLength * 0.3;
    cp1.x += (Math.random() - 0.5) * 0.02;
    cp1.z -= 0.02;

    const cp2 = end.clone();
    cp2.y += ponytailLength * 0.2;

    const curve = new THREE.CubicBezierCurve3(start, cp1, cp2, end);

    for (let pi = 0; pi < tailParticlesPerCurve; pi++) {
      const t = pi / (tailParticlesPerCurve - 1);
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();

      const up = new THREE.Vector3(0, 1, 0);
      const perp1 = new THREE.Vector3().crossVectors(tangent, up).normalize();
      if (perp1.lengthSq() < 0.001) perp1.set(1, 0, 0);
      const perp2 = new THREE.Vector3().crossVectors(tangent, perp1).normalize();

      // Wider offset for ponytail, tapers toward tips
      const radius = (noiseAmp + 0.03) * (1 - t * 0.7);
      const nAngle =
        noise3D(point.x * noiseScale + 50, point.y * noiseScale, point.z * noiseScale + ci * 7) * Math.PI * 2;
      const nRadius =
        Math.abs(noise3D(point.x * noiseScale + 200, point.y * noiseScale, point.z * noiseScale + ci * 7)) * radius;

      const offset = perp1
        .clone()
        .multiplyScalar(Math.cos(nAngle) * nRadius)
        .add(perp2.clone().multiplyScalar(Math.sin(nAngle) * nRadius));

      allPositions.push(point.x + offset.x, point.y + offset.y, point.z + offset.z);
      allHairT.push(0.5 + t * 0.5); // 0.5..1.0 for ponytail
      const c = baseColor.clone().lerp(tipColor, 0.3 + t * 0.5);
      allColors.push(c.r, c.g, c.b);
      allSizes.push(0.009 + Math.random() * 0.004 - t * 0.003); // slightly smaller at tips
    }
  }

  return {
    positions: new Float32Array(allPositions),
    hairT: new Float32Array(allHairT),
    colors: new Float32Array(allColors),
    sizes: new Float32Array(allSizes),
  };
}

// Hair particle vertex shader — sway animation, depth-based sizing
const hairVertexShader = `
  uniform float uTime;
  attribute float hairT;
  attribute float size;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;

  void main() {
    vec3 pos = position;

    // Ponytail sway — only particles below tie point (hairT > 0.5)
    float swayFactor = smoothstep(0.5, 1.0, hairT);
    pos.x += sin(uTime * 0.8 + pos.y * 2.0) * 0.015 * swayFactor;
    pos.z += sin(uTime * 0.6 + pos.y * 1.5 + 1.0) * 0.01 * swayFactor;

    // Subtle drift for all hair particles
    pos += sin(uTime * 0.3 + pos * 3.0) * 0.002;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    vDepth = -mvPosition.z;
    vColor = color;
    vAlpha = 1.0 - hairT * 0.4; // fade toward tips

    gl_Position = projectionMatrix * mvPosition;
    // Size: larger when close, attenuated by depth
    gl_PointSize = size * 500.0 / -mvPosition.z;
  }
`;

const hairFragmentShader = `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vDepth;

  void main() {
    // Circular point with soft edge
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float softEdge = 1.0 - smoothstep(0.3, 0.5, dist);

    // Depth-based brightness
    float depthNorm = clamp((vDepth - 0.5) / 2.0, 0.0, 1.0);
    float depthBrightness = mix(1.3, 0.5, depthNorm);

    vec3 finalColor = vColor * depthBrightness * 1.5;
    float alpha = vAlpha * softEdge * mix(0.9, 0.45, depthNorm);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// FABRIK IK constants
const FABRIK_ITERATIONS = 10;
const FABRIK_TOLERANCE = 0.001;

// Emotion → index mapping for morphTargetInfluences-style array
const EMOTIONS = ['happy', 'sad', 'angry', 'neutral'] as const;
type Emotion = (typeof EMOTIONS)[number];
const EMOTION_INDEX: Record<string, number> = { happy: 0, sad: 1, angry: 2, neutral: 3 };

// Pre-extract top-1 GA morph per emotion as fallback data
const GA_MORPH_TARGETS: Record<string, MorphTargetEntry[]> = gaSamples.morphTargets as unknown as Record<
  string,
  MorphTargetEntry[]
>;

// Per-avatar morph interpolation state (lives outside React state for animation loop access)
type MorphState = {
  targetEmotion: string;
  targetWeight: number;
  currentWeight: number; // Lerped toward targetWeight each frame
  currentInfluences: Float32Array; // [happy, sad, angry, neutral] — lerped per frame
  targetInfluences: Float32Array;
  dirty: boolean; // Needs geometry rebuild this frame
};

// ── Custom Glow Shader ────────────────────────────────

const hologramGlowVertexShader = `
  uniform float uTime;
  uniform float uSizeScale;

  attribute float instanceScale;
  attribute vec3 instanceColor;
  attribute float instanceGlow;
  attribute float instanceOpacity;

  varying vec3 vColor;
  varying float vGlow;
  varying float vOpacity;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vDepth;

  void main() {
    vColor = instanceColor;
    vGlow = instanceGlow;
    vOpacity = instanceOpacity;
    vNormal = normalMatrix * normal;

    // Per-particle drift: unique phase per instance, slow sine wave ±0.005 units
    float instanceId = float(gl_InstanceID);
    float phaseX = instanceId * 1.37;
    float phaseY = instanceId * 2.19;
    float phaseZ = instanceId * 0.83;
    vec3 drift = vec3(
      sin(uTime * 0.5 + phaseX) * 0.005,
      sin(uTime * 0.4 + phaseY) * 0.005,
      sin(uTime * 0.6 + phaseZ) * 0.003
    );

    vec3 scaledPos = position * instanceScale * uSizeScale;
    vec4 worldPos = instanceMatrix * vec4(scaledPos, 1.0);
    worldPos.xyz += drift;

    vec4 mvPosition = modelViewMatrix * worldPos;
    vViewPosition = -mvPosition.xyz;
    vDepth = -mvPosition.z;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const hologramGlowFragmentShader = `
  uniform float uBrightness;
  uniform float uAlpha;
  uniform float uCoreBoost;
  uniform float uGradientPower;
  uniform float uSizeScale;

  varying vec3 vColor;
  varying float vGlow;
  varying float vOpacity;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vDepth;

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float facing = max(dot(viewDir, normalize(vNormal)), 0.0);

    float gradient = pow(facing, uGradientPower);
    float coreBoost = pow(facing, 2.0);

    vec3 finalColor = vColor * (uBrightness + coreBoost * uCoreBoost);

    float alpha = gradient * uAlpha * vOpacity;

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

// ── FABRIK IK Solver ──────────────────────────────────

type FABRIKChain = {
  jointIds: string[];
  boneLengths: number[]; // distances between consecutive joints
};

/** Build a FABRIK chain from resolved joint positions */
const buildFABRIKChain = (positions: Map<string, THREE.Vector3>, chainJointIds: string[]): FABRIKChain | null => {
  const boneLengths: number[] = [];
  for (let i = 1; i < chainJointIds.length; i++) {
    const prev = positions.get(chainJointIds[i - 1]);
    const curr = positions.get(chainJointIds[i]);
    if (!prev || !curr) return null;
    boneLengths.push(prev.distanceTo(curr));
  }
  return { jointIds: chainJointIds, boneLengths };
};

/** FABRIK: solve IK chain so end effector reaches target position */
const solveFABRIK = (
  chain: FABRIKChain,
  positions: Map<string, THREE.Vector3>,
  target: THREE.Vector3,
): Map<string, THREE.Vector3> => {
  const n = chain.jointIds.length;
  if (n < 2) return new Map(positions);

  const pts = chain.jointIds.map((id) => positions.get(id)!.clone());
  const root = pts[0].clone();

  // Check reachability
  const totalLength = chain.boneLengths.reduce((a, b) => a + b, 0);
  const distToTarget = root.distanceTo(target);
  if (distToTarget > totalLength) {
    // Target unreachable — stretch toward it
    const dir = target.clone().sub(root).normalize();
    for (let i = 1; i < n; i++) {
      pts[i].copy(pts[i - 1].clone().add(dir.clone().multiplyScalar(chain.boneLengths[i - 1])));
    }
  } else {
    // Iterative FABRIK
    for (let iter = 0; iter < FABRIK_ITERATIONS; iter++) {
      if (pts[n - 1].distanceTo(target) < FABRIK_TOLERANCE) break;

      // Forward reaching (end → root)
      pts[n - 1].copy(target);
      for (let i = n - 2; i >= 0; i--) {
        const dir = pts[i]
          .clone()
          .sub(pts[i + 1])
          .normalize();
        pts[i].copy(pts[i + 1].clone().add(dir.multiplyScalar(chain.boneLengths[i])));
      }

      // Backward reaching (root → end)
      pts[0].copy(root);
      for (let i = 1; i < n; i++) {
        const dir = pts[i]
          .clone()
          .sub(pts[i - 1])
          .normalize();
        pts[i].copy(pts[i - 1].clone().add(dir.multiplyScalar(chain.boneLengths[i - 1])));
      }
    }
  }

  const result = new Map<string, THREE.Vector3>();
  for (let i = 0; i < n; i++) {
    result.set(chain.jointIds[i], pts[i]);
  }
  return result;
};

// ── Helper: get effective morph targets (avatar-provided or GA fallback) ──

const getEffectiveMorphTargets = (avatar: AvatarData): Record<string, MorphTargetEntry[]> =>
  avatar.morphTargets && Object.keys(avatar.morphTargets).length > 0 ? avatar.morphTargets : GA_MORPH_TARGETS;

// ── Helper: blend multiple emotions via influences array ──

const blendPoseMulti = (
  basePose: PoseData | null,
  morphTargets: Record<string, MorphTargetEntry[]>,
  influences: Float32Array,
): PoseData | null => {
  // Sum of all influences — if zero, return base
  let totalWeight = 0;
  for (let i = 0; i < EMOTIONS.length; i++) totalWeight += influences[i];
  if (totalWeight <= 0.001) return basePose;

  const baseJoints = basePose?.joints || {};
  const blended: Record<string, PoseJoint> = {};

  // Collect all joint IDs across base + all active morphs
  const allKeys = new Set(Object.keys(baseJoints));
  for (let i = 0; i < EMOTIONS.length; i++) {
    if (influences[i] <= 0) continue;
    const morph = morphTargets[EMOTIONS[i]]?.[0];
    if (morph) {
      for (const k of Object.keys(morph.pose.joints)) allKeys.add(k);
    }
  }

  for (const key of allKeys) {
    const base = baseJoints[key] || { rx: 0, ry: 0, rz: 0 };
    let rx = base.rx,
      ry = base.ry,
      rz = base.rz;

    for (let i = 0; i < EMOTIONS.length; i++) {
      const w = influences[i];
      if (w <= 0) continue;
      const morph = morphTargets[EMOTIONS[i]]?.[0];
      if (!morph) continue;
      const mj = morph.pose.joints[key];
      if (!mj) continue;
      rx += (mj.rx - base.rx) * w;
      ry += (mj.ry - base.ry) * w;
      rz += (mj.rz - base.rz) * w;
    }

    blended[key] = { rx, ry, rz };
  }

  return { joints: blended };
};

// ── Joint transform result (position + world rotation) ──

type JointTransforms = {
  positions: Map<string, THREE.Vector3>;
  rotations: Map<string, THREE.Quaternion>;
};

// ── Default/test avatar for empty-panel fallback ──────────

const DEFAULT_SKELETON: JointDef[] = [
  { id: 'root', position: [0, 0, 0], parent_id: null },
  { id: 'spine', position: [0, 0.20, 0], parent_id: 'root' },
  { id: 'chest', position: [0, 0.18, 0], parent_id: 'spine' },
  { id: 'neck', position: [0, 0.10, 0], parent_id: 'chest' },
  { id: 'head', position: [0, 0.10, 0], parent_id: 'neck' },
  { id: 'l_shoulder', position: [-0.15, 0, 0], parent_id: 'chest' },
  { id: 'l_elbow', position: [0, -0.16, 0], parent_id: 'l_shoulder' },
  { id: 'l_hand', position: [0, -0.14, 0], parent_id: 'l_elbow' },
  { id: 'r_shoulder', position: [0.15, 0, 0], parent_id: 'chest' },
  { id: 'r_elbow', position: [0, -0.16, 0], parent_id: 'r_shoulder' },
  { id: 'r_hand', position: [0, -0.14, 0], parent_id: 'r_elbow' },
  { id: 'l_hip', position: [-0.1, 0, 0], parent_id: 'root' },
  { id: 'l_knee', position: [0, -0.36, 0], parent_id: 'l_hip' },
  { id: 'l_foot', position: [0, -0.34, 0], parent_id: 'l_knee' },
  { id: 'r_hip', position: [0.1, 0, 0], parent_id: 'root' },
  { id: 'r_knee', position: [0, -0.36, 0], parent_id: 'r_hip' },
  { id: 'r_foot', position: [0, -0.34, 0], parent_id: 'r_knee' },
];

/** Generate simple ellipsoid points around each joint for a test/fallback avatar */
const generateDefaultPoints = (): PointDef[] => {
  const points: PointDef[] = [];
  const col = '#4dd8d0';

  const jointRadii: Record<string, [number, number, number, number]> = {
    // [rx, ry, rz, count]
    head: [0.05, 0.06, 0.05, 200],
    neck: [0.02, 0.03, 0.02, 40],
    chest: [0.08, 0.06, 0.05, 250],
    spine: [0.06, 0.08, 0.05, 200],
    root: [0.08, 0.04, 0.06, 150],
    l_shoulder: [0.04, 0.03, 0.03, 60],
    r_shoulder: [0.04, 0.03, 0.03, 60],
    l_elbow: [0.02, 0.06, 0.02, 80],
    r_elbow: [0.02, 0.06, 0.02, 80],
    l_hand: [0.015, 0.02, 0.008, 40],
    r_hand: [0.015, 0.02, 0.008, 40],
    l_hip: [0.04, 0.14, 0.04, 150],
    r_hip: [0.04, 0.14, 0.04, 150],
    l_knee: [0.025, 0.14, 0.025, 120],
    r_knee: [0.025, 0.14, 0.025, 120],
    l_foot: [0.02, 0.015, 0.04, 40],
    r_foot: [0.02, 0.015, 0.04, 40],
  };

  for (const [jointId, [rx, ry, rz, count]] of Object.entries(jointRadii)) {
    for (let i = 0; i < count; i++) {
      const lat = Math.random() * Math.PI - Math.PI / 2;
      const lon = Math.random() * Math.PI * 2;
      points.push({
        joint_id: jointId,
        offset: [
          rx * Math.cos(lat) * Math.cos(lon),
          ry * Math.sin(lat),
          rz * Math.cos(lat) * Math.sin(lon),
        ],
        size: 0.35 + Math.random() * 0.1,
        color: col,
      });
    }
  }
  return points;
};

let _cachedDefaultPoints: PointDef[] | null = null;
const getDefaultAvatar = (): AvatarData => {
  if (!_cachedDefaultPoints) _cachedDefaultPoints = generateDefaultPoints();
  return {
    id: '__default__',
    userId: '__default__',
    label: 'Test Avatar',
    skeleton: DEFAULT_SKELETON,
    points: _cachedDefaultPoints,
    pose: null,
    physics: false,
  };
};

// ── Component ──────────────────────────────────────────

// Viseme → lip Y-offset deltas for upper and lower lip particles
const VISEME_LIP_OFFSETS: Record<string, { upperY: number; lowerY: number }> = {
  rest: { upperY: 0, lowerY: 0 },
  open: { upperY: 0.006, lowerY: -0.008 },
  narrow: { upperY: 0.003, lowerY: -0.004 },
  closed: { upperY: -0.001, lowerY: 0.001 },
  teeth: { upperY: 0.004, lowerY: -0.002 },
  wide: { upperY: 0.003, lowerY: -0.005 },
};

/** Check if a head-joint point is an upper lip particle by its offset coordinates */
// Lip detection: head joint at Y=0.62, upper lip at Y≈0.652 (offset≈0.032), lower at Y≈0.645 (offset≈0.025)
const isUpperLip = (offset: [number, number, number]): boolean =>
  offset[1] >= 0.025 && offset[1] <= 0.045 && offset[2] >= 0.04 && offset[2] <= 0.06;

/** Check if a head-joint point is a lower lip particle */
const isLowerLip = (offset: [number, number, number]): boolean =>
  offset[1] >= 0.015 && offset[1] <= 0.035 && offset[2] >= 0.04 && offset[2] <= 0.06;

const HologramViewer: React.FC<HologramViewerProps> = ({ avatars: avatarsProp, visemeStates }) => {
  // Use default test avatar when no avatars provided so the 3D scene always renders
  const avatars = useMemo(
    () => (avatarsProp.length > 0 ? avatarsProp : [getDefaultAvatar()]),
    [avatarsProp],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [poseOpen, setPoseOpen] = useState(false);
  const [animOpen, setAnimOpen] = useState(false);
  const [animPlaying, setAnimPlaying] = useState(false);
  const [poseAngles, setPoseAngles] = useState<Record<string, { rx: number; ry: number; rz: number }>>({});
  const poseAnglesRef = useRef(poseAngles);
  useEffect(() => {
    poseAnglesRef.current = poseAngles;
    for (const [, ms] of morphStateRef.current) ms.dirty = true;
  }, [poseAngles]);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['rendering']));

  // ── Particle Editor state ──
  const [editMode, setEditMode] = useState(false);
  const [editRadius, setEditRadius] = useState(0.05);
  const [editPos, setEditPos] = useState<[number, number, number]>([0, 0, 0]);
  const [deletedParticles, setDeletedParticles] = useState<Set<number>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('holoDeletedParticles');
        if (saved) return new Set(JSON.parse(saved));
      } catch { /* ignore */ }
    }
    return new Set();
  });
  const deletedRef = useRef(deletedParticles);
  useEffect(() => { deletedRef.current = deletedParticles; }, [deletedParticles]);
  const editSphereRef = useRef<THREE.Mesh | null>(null);
  const [editPart, setEditPart] = useState('chest');
  const editPartRef = useRef(editPart);
  const editModeRef = useRef(editMode);
  useEffect(() => {
    editPartRef.current = editPart;
    editModeRef.current = editMode;
    for (const [, ms] of morphStateRef.current) ms.dirty = true;
  }, [editPart, editMode]);
  const [editAddCount, setEditAddCount] = useState(20);
  const [addedParticles, setAddedParticles] = useState<Array<{ joint_id: string; offset: [number, number, number]; size: number; color: string }>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('holoAddedParticles');
        if (saved) return JSON.parse(saved);
      } catch { /* ignore */ }
    }
    return [];
  });
  const addedParticlesRef = useRef(addedParticles);
  useEffect(() => { addedParticlesRef.current = addedParticles; }, [addedParticles]);
  const applyDebugColorsRef = useRef<((enabled: boolean) => void) | null>(null);
  const jointPositionsRef = useRef<Map<string, THREE.Vector3> | null>(null);

  // ── All hologram settings in one object ──
  const allDefaults = {
    // Rendering
    brightness: 1.8, alpha: 0.75, coreBoost: 0.9, gradientPower: 0.4,
    sizeScale: 1.0, gridOpacity: 0.3, driftSpeed: 1.0,
    // Body proportions
    headScale: 1.0, headY: 0, neckWidth: 1.0, shoulderWidth: 1.0, bustSize: 1.0,
    torsoWidth: 1.0, waistWidth: 1.0, hipWidth: 1.0, armThickness: 1.0,
    thighWidth: 1.0, calfWidth: 1.0,
    // Face
    faceWidth: 1.0, faceHeight: 1.0, faceDepth: 1.0, foreheadHeight: 1.0,
    jawWidth: 1.0, chinWidth: 1.0, chinLength: 1.0, cheekboneWidth: 1.0,
    // Eyes
    eyeSpacing: 1.0, eyeHeight: 0, eyeSize: 1.0, eyeBrightness: 1.0,
    eyeSocketDepth: 1.0, pupilSize: 1.0, eyelidThickness: 1.0,
    // Eyebrows
    browHeight: 0, browArch: 1.0, browThickness: 1.0, browLength: 1.0, browSpacing: 1.0,
    // Nose
    noseLength: 1.0, noseWidth: 1.0, noseProjection: 1.0, noseBridgeWidth: 1.0,
    noseTipSize: 1.0, noseHeight: 0,
    // Mouth
    mouthWidth: 1.0, mouthHeight: 0, upperLipFullness: 1.0, lowerLipFullness: 1.0,
    lipProjection: 1.0, smileAmount: 0.2, lipBrightness: 1.0,
    // Neck & Shoulders
    neckLength: 1.0, neckThickness: 1.0, shoulderSlope: 1.0, shoulderRoundness: 1.0,
    neckOffsetX: 0, neckOffsetY: 0, shoulderOffsetX: 0, shoulderOffsetY: 0,
    // Torso shape
    bustProjection: 1.0, bustSpacing: 1.0, bustHeight: 0, bustWidth: 1.0,
    bustOffsetX: 0, bustOffsetY: 0, bustOffsetZ: 0, bustDrop: 0,
    nippleSize: 1.0, nippleProjection: 1.0, nippleOffsetX: 0, nippleOffsetY: 0,
    nippleDensity: 1.0, bustDensity: 1.0,
    ribcageWidth: 1.0,
    bellyDepth: 1.0, gluteSize: 1.0, torsoLength: 1.0,
    upperTorsoOffsetY: 0, upperTorsoHeight: 1.0,
    waistOffsetY: 0, waistHeight: 1.0,
    torsoOffsetX: 0, torsoOffsetY: 0,
    // Legs
    legLength: 1.0, upperLegLength: 1.0, lowerLegLength: 1.0, legSpacing: 1.0,
    kneeWidth: 1.0, ankleWidth: 1.0, footSize: 1.0,
    hipOffsetX: 0, hipOffsetY: 0, hipHeight: 1.0, hipDepth: 1.0,
    legOffsetX: 0, legOffsetY: 0, legOffsetZ: 0,
    calfOffsetX: 0, calfOffsetY: 0, calfOffsetZ: 0,
    footOffsetX: 0, footOffsetY: 0, footOffsetZ: 0,
    // Arms
    armLength: 1.0, upperArmLength: 1.0, forearmLength: 1.0, armSpread: 1.0,
    elbowWidth: 1.0, wristWidth: 1.0, handSize: 1.0, fingerLength: 1.0,
    armOffsetX: 0, armOffsetY: 0, armOffsetZ: 0,
    handOffsetX: 0, handOffsetY: 0, handOffsetZ: 0,
    // Z offsets for other parts
    headOffsetZ: 0, neckOffsetZ: 0, shoulderOffsetZ: 0, torsoOffsetZ: 0,
    // Part densities (size multiplier — bigger = denser looking)
    headDensity: 1.0, faceDensity: 1.0, eyeDensity: 1.0, noseDensity: 1.0,
    mouthDensity: 1.0, browDensity: 1.0,
    earDensity: 1.0, earOffsetX: 0, earOffsetY: 0, earOffsetZ: 0, earSize: 1.0, earSpacing: 1.0,
    neckDensity: 1.0, shoulderDensity: 1.0, torsoDensity: 1.0,
    armDensity: 1.0, handDensity: 1.0,
    thighDensity: 1.0, calfDensity: 1.0, footDensity: 1.0,
    // Organs
    breastDensity: 1.0, heartDensity: 1.0, lungDensity: 1.0, stomachDensity: 1.0,
    intestineDensity: 1.0, wombDensity: 1.0, ovaryDensity: 1.0,
    fallopianDensity: 1.0, cervixDensity: 1.0, vaginaDensity: 1.0,
    // Joint offsets (per-joint X/Y position adjustment)
    rootX: 0, rootY: 0, spineX: 0, spineY: 0, chestX: 0, chestY: 0,
    neckJointX: 0, neckJointY: 0, headJointX: 0, headJointY: 0,
    lShoulderX: 0, lShoulderY: 0, rShoulderX: 0, rShoulderY: 0,
    lElbowX: 0, lElbowY: 0, rElbowX: 0, rElbowY: 0,
    lHandX: 0, lHandY: 0, rHandX: 0, rHandY: 0,
    lHipX: 0, lHipY: 0, rHipX: 0, rHipY: 0,
    lKneeX: 0, lKneeY: 0, rKneeX: 0, rKneeY: 0,
    lFootX: 0, lFootY: 0, rFootX: 0, rFootY: 0,
    // Debug colors (hex as numeric — 1.0 = show organ debug colors, 0 = normal)
    debugOrgans: 0,
    // Debug
    showSilhouette: 0, showSkeleton: 0, showJoints: 0, showDebugColors: 0, showGrid: 1,
  };
  type HoloSettings = typeof allDefaults;

  const [cfg, setCfg] = useState<HoloSettings>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('holoCfg');
        if (saved) return { ...allDefaults, ...JSON.parse(saved) };
      } catch { /* ignore */ }
    }
    return { ...allDefaults };
  });
  const cfgRef = useRef(cfg);

  // Aliases for backward compat with existing code
  const holoSettings = cfg;
  const bodyProportions = cfg;
  const bodyProportionsRef = cfgRef;

  useEffect(() => {
    cfgRef.current = cfg;
    if (morphStateRef.current.size > 0) {
      for (const [, mState] of morphStateRef.current) {
        mState.dirty = true;
      }
    }
  }, [cfg]);

  // Section definitions
  type SliderDef = { key: string; label: string; min: number; max: number; step: number; info: string };
  type SectionDef = { id: string; title: string; color: string; sliders: SliderDef[] };

  const S = 0.01; // step for offsets
  const M = 0.05; // step for multipliers

  const sections: SectionDef[] = [
    { id: 'rendering', title: 'Rendering', color: '#4dd8d0', sliders: [
      { key: 'brightness', label: 'Brightness', min: 0, max: 10, step: 0.1, info: 'Color intensity multiplier' },
      { key: 'alpha', label: 'Opacity', min: 0, max: 2.0, step: 0.05, info: 'Particle transparency' },
      { key: 'coreBoost', label: 'Core Glow', min: 0, max: 5.0, step: 0.1, info: 'Center brightness boost' },
      { key: 'gradientPower', label: 'Edge Falloff', min: 0.05, max: 5.0, step: 0.05, info: 'Edge fade speed' },
      { key: 'sizeScale', label: 'Particle Size', min: 0.1, max: 5.0, step: 0.1, info: 'Size multiplier' },
      { key: 'gridOpacity', label: 'Grid Opacity', min: 0, max: 1.0, step: 0.05, info: 'Floor grid visibility' },
      { key: 'driftSpeed', label: 'Drift Speed', min: 0, max: 5.0, step: 0.1, info: 'Particle animation speed' },
    ]},
    { id: 'body', title: 'Body Proportions', color: '#e0a040', sliders: [
      { key: 'headScale', label: 'Head Size', min: 0.1, max: 5.0, step: M, info: 'Scale head width/depth' },
      { key: 'headY', label: 'Head Y Offset', min: -0.5, max: 0.5, step: S, info: 'Move head up/down' },
      { key: 'neckWidth', label: 'Neck Width', min: 0.1, max: 5.0, step: M, info: 'Neck thickness' },
      { key: 'shoulderWidth', label: 'Shoulder Width', min: 0.1, max: 5.0, step: M, info: 'Shoulder spread' },
      { key: 'bustSize', label: 'Bust Size', min: 0.1, max: 5.0, step: M, info: 'Bust/chest depth' },
      { key: 'torsoWidth', label: 'Upper Torso', min: 0.1, max: 5.0, step: M, info: 'Ribcage/chest width' },
      { key: 'waistWidth', label: 'Waist Width', min: 0.1, max: 5.0, step: M, info: 'Waist/belly width' },
      { key: 'hipWidth', label: 'Hip Width', min: 0.1, max: 5.0, step: M, info: 'Hip/lower abdomen' },
      { key: 'armThickness', label: 'Arm Thickness', min: 0.1, max: 5.0, step: M, info: 'Arm cross-section' },
      { key: 'thighWidth', label: 'Thigh Width', min: 0.1, max: 5.0, step: M, info: 'Upper leg thickness' },
      { key: 'calfWidth', label: 'Calf Width', min: 0.1, max: 5.0, step: M, info: 'Lower leg thickness' },
    ]},
    { id: 'face', title: 'Face Shape', color: '#40e080', sliders: [
      { key: 'faceWidth', label: 'Face Width', min: 0.1, max: 5.0, step: M, info: 'Scale all head widths' },
      { key: 'faceHeight', label: 'Face Height', min: 0.1, max: 5.0, step: M, info: 'Taller/shorter head' },
      { key: 'faceDepth', label: 'Face Depth', min: 0.1, max: 5.0, step: M, info: 'Front-to-back depth' },
      { key: 'foreheadHeight', label: 'Forehead Height', min: 0.1, max: 5.0, step: M, info: 'Brow to crown distance' },
      { key: 'jawWidth', label: 'Jaw Width', min: 0.1, max: 5.0, step: M, info: 'Width below cheekbones' },
      { key: 'chinWidth', label: 'Chin Width', min: 0.1, max: 5.0, step: M, info: 'Width below jaw' },
      { key: 'chinLength', label: 'Chin Length', min: 0.1, max: 5.0, step: M, info: 'Chin extension below mouth' },
      { key: 'cheekboneWidth', label: 'Cheekbone Width', min: 0.1, max: 5.0, step: M, info: 'Width at cheekbone level' },
      { key: 'headOffsetZ', label: 'Head Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift head forward/back' },
    ]},
    { id: 'eyes', title: 'Eyes', color: '#a060e0', sliders: [
      { key: 'eyeSpacing', label: 'Eye Spacing', min: 0.1, max: 5.0, step: M, info: 'Eyes apart/together' },
      { key: 'eyeHeight', label: 'Eye Height', min: -0.1, max: 0.1, step: S, info: 'Move eyes up/down' },
      { key: 'eyeSize', label: 'Eye Size', min: 0.1, max: 5.0, step: 0.1, info: 'Eyeball particle size' },
      { key: 'eyeBrightness', label: 'Eye Brightness', min: 0, max: 5.0, step: 0.1, info: 'Eye color brightness' },
      { key: 'eyeSocketDepth', label: 'Socket Depth', min: 0, max: 5.0, step: 0.1, info: 'Socket exclusion strength' },
      { key: 'pupilSize', label: 'Pupil Size', min: 0.1, max: 5.0, step: 0.1, info: 'Iris particle size' },
      { key: 'eyelidThickness', label: 'Eyelid Thickness', min: 0, max: 5.0, step: 0.1, info: 'Eyelid particle count' },
    ]},
    { id: 'brows', title: 'Eyebrows', color: '#a060e0', sliders: [
      { key: 'browHeight', label: 'Brow Height', min: -0.1, max: 0.1, step: S, info: 'Move brows up/down' },
      { key: 'browArch', label: 'Brow Arch', min: 0, max: 5.0, step: 0.1, info: 'Arch curve height' },
      { key: 'browThickness', label: 'Brow Thickness', min: 0.1, max: 5.0, step: 0.1, info: 'Brow particle density' },
      { key: 'browLength', label: 'Brow Length', min: 0.1, max: 5.0, step: M, info: 'Brow X extent' },
      { key: 'browSpacing', label: 'Brow Spacing', min: 0.1, max: 5.0, step: M, info: 'Distance from center' },
    ]},
    { id: 'nose', title: 'Nose', color: '#a060e0', sliders: [
      { key: 'noseLength', label: 'Nose Length', min: 0.1, max: 5.0, step: M, info: 'Nose Y extent' },
      { key: 'noseWidth', label: 'Nose Width', min: 0.1, max: 5.0, step: 0.1, info: 'Nostril spacing and body width' },
      { key: 'noseProjection', label: 'Nose Projection', min: 0.1, max: 5.0, step: 0.1, info: 'How far nose sticks out (Z)' },
      { key: 'noseBridgeWidth', label: 'Bridge Width', min: 0.1, max: 5.0, step: 0.1, info: 'Bridge X spread' },
      { key: 'noseTipSize', label: 'Tip Size', min: 0.1, max: 5.0, step: 0.1, info: 'Tip particle spread' },
      { key: 'noseHeight', label: 'Nose Height', min: -0.1, max: 0.1, step: S, info: 'Move nose up/down' },
    ]},
    { id: 'mouth', title: 'Mouth', color: '#a060e0', sliders: [
      { key: 'mouthWidth', label: 'Mouth Width', min: 0.1, max: 5.0, step: M, info: 'Lip X extent' },
      { key: 'mouthHeight', label: 'Mouth Height', min: -0.1, max: 0.1, step: S, info: 'Move mouth up/down' },
      { key: 'upperLipFullness', label: 'Upper Lip', min: 0.1, max: 5.0, step: 0.1, info: 'Upper lip thickness' },
      { key: 'lowerLipFullness', label: 'Lower Lip', min: 0.1, max: 5.0, step: 0.1, info: 'Lower lip thickness' },
      { key: 'lipProjection', label: 'Lip Projection', min: 0.1, max: 5.0, step: 0.1, info: 'Lip forward protrusion (Z)' },
      { key: 'smileAmount', label: 'Smile', min: -2.0, max: 2.0, step: 0.05, info: 'Positive=smile, negative=frown' },
      { key: 'lipBrightness', label: 'Lip Brightness', min: 0.1, max: 5.0, step: M, info: 'Lip highlight intensity' },
    ]},
    { id: 'ears', title: 'Ears', color: '#a060e0', sliders: [
      { key: 'earSpacing', label: 'Ear Spacing', min: 0.1, max: 5.0, step: M, info: 'Ears closer/further from head' },
      { key: 'earSize', label: 'Ear Size', min: 0.1, max: 5.0, step: M, info: 'Scale ear dimensions' },
      { key: 'earOffsetX', label: 'Ear X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift ears left/right' },
      { key: 'earOffsetY', label: 'Ear Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift ears up/down' },
      { key: 'earOffsetZ', label: 'Ear Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift ears forward/back' },
      { key: 'earDensity', label: 'Ear Density', min: 0, max: 5.0, step: 0.1, info: 'Ear particle visibility' },
    ]},
    { id: 'neckShoulders', title: 'Neck & Shoulders', color: '#e0a040', sliders: [
      { key: 'neckLength', label: 'Neck Length', min: 0.1, max: 5.0, step: M, info: 'Vertical neck distance' },
      { key: 'neckThickness', label: 'Neck Thickness', min: 0.1, max: 5.0, step: M, info: 'Neck cross-section' },
      { key: 'shoulderSlope', label: 'Shoulder Slope', min: 0, max: 5.0, step: M, info: 'Shoulder drop steepness' },
      { key: 'shoulderRoundness', label: 'Shoulder Roundness', min: 0, max: 5.0, step: M, info: 'Arm tube shoulder radius' },
      { key: 'neckOffsetX', label: 'Neck X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift neck left/right' },
      { key: 'neckOffsetY', label: 'Neck Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift neck up/down' },
      { key: 'shoulderOffsetX', label: 'Shoulder X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift shoulders left/right' },
      { key: 'shoulderOffsetY', label: 'Shoulder Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift shoulders up/down' },
      { key: 'neckOffsetZ', label: 'Neck Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift neck forward/back' },
      { key: 'shoulderOffsetZ', label: 'Shoulder Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift shoulders forward/back' },
    ]},
    { id: 'torsoShape', title: 'Torso Shape', color: '#e0a040', sliders: [
      { key: 'bustProjection', label: 'Bust Projection', min: 0, max: 5.0, step: 0.1, info: 'How far bust protrudes forward' },
      { key: 'bustWidth', label: 'Bust Width', min: 0.1, max: 5.0, step: M, info: 'Bust X spread' },
      { key: 'bustSpacing', label: 'Bust Spacing', min: 0.1, max: 5.0, step: M, info: 'Distance between bust volumes' },
      { key: 'bustHeight', label: 'Bust Height', min: -0.2, max: 0.2, step: S, info: 'Move bust up/down' },
      { key: 'bustDrop', label: 'Bust Drop', min: -0.1, max: 0.1, step: S, info: 'Gravity sag (positive = lower)' },
      { key: 'bustOffsetX', label: 'Bust X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift bust left/right' },
      { key: 'bustOffsetY', label: 'Bust Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift bust up/down' },
      { key: 'bustOffsetZ', label: 'Bust Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift bust forward/back' },
      { key: 'bustDensity', label: 'Bust Density', min: 0, max: 5.0, step: 0.1, info: 'Bust particle visibility' },
      { key: 'nippleProjection', label: 'Nipple Projection', min: 0.1, max: 5.0, step: 0.1, info: 'How far nipples protrude' },
      { key: 'nippleSize', label: 'Nipple Size', min: 0.1, max: 5.0, step: 0.1, info: 'Nipple area size' },
      { key: 'nippleOffsetX', label: 'Nipple X Offset', min: -0.1, max: 0.1, step: S, info: 'Shift nipples left/right' },
      { key: 'nippleOffsetY', label: 'Nipple Y Offset', min: -0.1, max: 0.1, step: S, info: 'Shift nipples up/down' },
      { key: 'nippleDensity', label: 'Nipple Density', min: 0, max: 5.0, step: 0.1, info: 'Nipple particle visibility' },
      { key: 'ribcageWidth', label: 'Ribcage Width', min: 0.1, max: 5.0, step: M, info: 'Ribcage cross-sections' },
      { key: 'bellyDepth', label: 'Belly Depth', min: 0.1, max: 5.0, step: M, info: 'Front-to-back at navel' },
      { key: 'gluteSize', label: 'Glute Size', min: 0, max: 5.0, step: 0.1, info: 'Glute volume projection' },
      { key: 'torsoLength', label: 'Torso Length', min: 0.1, max: 5.0, step: M, info: 'Shoulder to hip distance' },
      { key: 'upperTorsoOffsetY', label: 'Upper Torso Y', min: -0.5, max: 0.5, step: S, info: 'Shift chest/bust zone up/down' },
      { key: 'upperTorsoHeight', label: 'Upper Torso Height', min: 0.1, max: 5.0, step: M, info: 'Stretch/compress chest zone' },
      { key: 'waistOffsetY', label: 'Waist Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift waist/belly zone up/down' },
      { key: 'waistHeight', label: 'Waist Height', min: 0.1, max: 5.0, step: M, info: 'Stretch/compress waist zone' },
      { key: 'hipOffsetY', label: 'Hip Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift hip zone up/down' },
      { key: 'hipHeight', label: 'Hip Height', min: 0.1, max: 5.0, step: M, info: 'Stretch/compress hip zone' },
      { key: 'torsoOffsetX', label: 'Torso X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift torso left/right' },
      { key: 'torsoOffsetY', label: 'Torso Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift entire torso up/down' },
      { key: 'torsoOffsetZ', label: 'Torso Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift torso forward/back' },
    ]},
    { id: 'legs', title: 'Legs', color: '#e06080', sliders: [
      { key: 'legLength', label: 'Leg Length', min: 0.1, max: 5.0, step: M, info: 'Total leg length' },
      { key: 'upperLegLength', label: 'Upper Leg', min: 0.1, max: 5.0, step: M, info: 'Thigh length' },
      { key: 'lowerLegLength', label: 'Lower Leg', min: 0.1, max: 5.0, step: M, info: 'Calf length' },
      { key: 'legSpacing', label: 'Leg Spacing', min: 0.1, max: 5.0, step: M, info: 'Legs apart/together' },
      { key: 'kneeWidth', label: 'Knee Width', min: 0.1, max: 5.0, step: M, info: 'Knee cross-section' },
      { key: 'ankleWidth', label: 'Ankle Width', min: 0.1, max: 5.0, step: M, info: 'Ankle cross-section' },
      { key: 'footSize', label: 'Foot Size', min: 0.1, max: 5.0, step: M, info: 'All foot dimensions' },
      { key: 'hipHeight', label: 'Hip Height', min: 0.1, max: 5.0, step: M, info: 'Scale hip region height' },
      { key: 'hipDepth', label: 'Hip Depth', min: 0.1, max: 5.0, step: M, info: 'Hip front-to-back depth' },
      { key: 'hipOffsetX', label: 'Hip X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift hips left/right' },
      { key: 'hipOffsetY', label: 'Hip Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift hips up/down' },
      { key: 'legOffsetX', label: 'Thigh X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift thighs left/right' },
      { key: 'legOffsetY', label: 'Thigh Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift thighs up/down' },
      { key: 'legOffsetZ', label: 'Thigh Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift thighs forward/back' },
      { key: 'calfOffsetX', label: 'Calf X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift calves left/right' },
      { key: 'calfOffsetY', label: 'Calf Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift calves up/down' },
      { key: 'calfOffsetZ', label: 'Calf Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift calves forward/back' },
      { key: 'footOffsetX', label: 'Foot X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift feet left/right' },
      { key: 'footOffsetY', label: 'Foot Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift feet up/down' },
      { key: 'footOffsetZ', label: 'Foot Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift feet forward/back' },
    ]},
    { id: 'arms', title: 'Arms & Hands', color: '#4090e0', sliders: [
      { key: 'armLength', label: 'Arm Length', min: 0.1, max: 5.0, step: M, info: 'Total arm curve length' },
      { key: 'upperArmLength', label: 'Upper Arm', min: 0.1, max: 5.0, step: M, info: 'Shoulder to elbow' },
      { key: 'forearmLength', label: 'Forearm', min: 0.1, max: 5.0, step: M, info: 'Elbow to wrist' },
      { key: 'armSpread', label: 'Arm Spread', min: 0.1, max: 5.0, step: M, info: 'Distance from torso' },
      { key: 'elbowWidth', label: 'Elbow Width', min: 0.1, max: 5.0, step: M, info: 'Elbow cross-section' },
      { key: 'wristWidth', label: 'Wrist Width', min: 0.1, max: 5.0, step: M, info: 'Wrist cross-section' },
      { key: 'handSize', label: 'Hand Size', min: 0.1, max: 5.0, step: M, info: 'All hand dimensions' },
      { key: 'fingerLength', label: 'Finger Length', min: 0.1, max: 5.0, step: M, info: 'Finger tube length' },
      { key: 'armOffsetX', label: 'Arm X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift arms left/right' },
      { key: 'armOffsetY', label: 'Arm Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift arms up/down' },
      { key: 'armOffsetZ', label: 'Arm Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift arms forward/back' },
      { key: 'handOffsetX', label: 'Hand X Offset', min: -0.5, max: 0.5, step: S, info: 'Shift hands left/right' },
      { key: 'handOffsetY', label: 'Hand Y Offset', min: -0.5, max: 0.5, step: S, info: 'Shift hands up/down' },
      { key: 'handOffsetZ', label: 'Hand Z Offset', min: -0.5, max: 0.5, step: S, info: 'Shift hands forward/back' },
    ]},
    { id: 'organs', title: 'Organs & Anatomy', color: '#ff69b4', sliders: [
      { key: 'breastDensity', label: 'Breast', min: 0, max: 5.0, step: 0.1, info: 'Breast particle visibility' },
      { key: 'heartDensity', label: 'Heart', min: 0, max: 5.0, step: 0.1, info: 'Heart particle visibility' },
      { key: 'lungDensity', label: 'Lungs', min: 0, max: 5.0, step: 0.1, info: 'Lung particle visibility' },
      { key: 'stomachDensity', label: 'Stomach', min: 0, max: 5.0, step: 0.1, info: 'Stomach particle visibility' },
      { key: 'intestineDensity', label: 'Intestines', min: 0, max: 5.0, step: 0.1, info: 'Intestine particle visibility' },
      { key: 'wombDensity', label: 'Womb', min: 0, max: 5.0, step: 0.1, info: 'Uterus particle visibility' },
      { key: 'ovaryDensity', label: 'Ovaries', min: 0, max: 5.0, step: 0.1, info: 'Ovary particle visibility' },
      { key: 'fallopianDensity', label: 'Fallopian Tubes', min: 0, max: 5.0, step: 0.1, info: 'Fallopian tube visibility' },
      { key: 'cervixDensity', label: 'Cervix', min: 0, max: 5.0, step: 0.1, info: 'Cervix particle visibility' },
      { key: 'vaginaDensity', label: 'Vagina', min: 0, max: 5.0, step: 0.1, info: 'Vaginal canal visibility' },
      { key: 'debugOrgans', label: 'Show Organ Colors', min: 0, max: 1, step: 1, info: 'Color-code organs in debug mode' },
    ]},
    { id: 'density', title: 'Part Densities', color: '#c0c0c0', sliders: [
      { key: 'headDensity', label: 'Head', min: 0, max: 5.0, step: 0.1, info: 'Head particle visibility' },
      { key: 'faceDensity', label: 'Face', min: 0, max: 5.0, step: 0.1, info: 'Cheek/jaw/chin visibility' },
      { key: 'eyeDensity', label: 'Eyes', min: 0, max: 5.0, step: 0.1, info: 'Eye particle visibility' },
      { key: 'browDensity', label: 'Eyebrows', min: 0, max: 5.0, step: 0.1, info: 'Brow particle visibility' },
      { key: 'noseDensity', label: 'Nose', min: 0, max: 5.0, step: 0.1, info: 'Nose particle visibility' },
      { key: 'mouthDensity', label: 'Mouth', min: 0, max: 5.0, step: 0.1, info: 'Lip particle visibility' },
      { key: 'earDensity', label: 'Ears', min: 0, max: 5.0, step: 0.1, info: 'Ear particle visibility' },
      { key: 'neckDensity', label: 'Neck', min: 0, max: 5.0, step: 0.1, info: 'Neck particle visibility' },
      { key: 'shoulderDensity', label: 'Shoulders', min: 0, max: 5.0, step: 0.1, info: 'Shoulder particle visibility' },
      { key: 'torsoDensity', label: 'Torso', min: 0, max: 5.0, step: 0.1, info: 'Torso particle visibility' },
      { key: 'armDensity', label: 'Arms', min: 0, max: 5.0, step: 0.1, info: 'Arm particle visibility' },
      { key: 'handDensity', label: 'Hands', min: 0, max: 5.0, step: 0.1, info: 'Hand particle visibility' },
      { key: 'thighDensity', label: 'Thighs', min: 0, max: 5.0, step: 0.1, info: 'Thigh particle visibility' },
      { key: 'calfDensity', label: 'Calves', min: 0, max: 5.0, step: 0.1, info: 'Calf particle visibility' },
      { key: 'footDensity', label: 'Feet', min: 0, max: 5.0, step: 0.1, info: 'Foot particle visibility' },
    ]},
    { id: 'joints', title: 'Joint Positions', color: '#40c0e0', sliders: [
      { key: 'rootX', label: 'Root X', min: -0.5, max: 0.5, step: S, info: 'Root joint X offset' },
      { key: 'rootY', label: 'Root Y', min: -0.5, max: 0.5, step: S, info: 'Root joint Y offset' },
      { key: 'spineX', label: 'Spine X', min: -0.5, max: 0.5, step: S, info: 'Spine joint X' },
      { key: 'spineY', label: 'Spine Y', min: -0.5, max: 0.5, step: S, info: 'Spine joint Y' },
      { key: 'chestX', label: 'Chest X', min: -0.5, max: 0.5, step: S, info: 'Chest joint X' },
      { key: 'chestY', label: 'Chest Y', min: -0.5, max: 0.5, step: S, info: 'Chest joint Y' },
      { key: 'neckJointX', label: 'Neck X', min: -0.5, max: 0.5, step: S, info: 'Neck joint X' },
      { key: 'neckJointY', label: 'Neck Y', min: -0.5, max: 0.5, step: S, info: 'Neck joint Y' },
      { key: 'headJointX', label: 'Head X', min: -0.5, max: 0.5, step: S, info: 'Head joint X' },
      { key: 'headJointY', label: 'Head Y', min: -0.5, max: 0.5, step: S, info: 'Head joint Y' },
      { key: 'lShoulderX', label: 'L Shoulder X', min: -0.5, max: 0.5, step: S, info: 'Left shoulder X' },
      { key: 'lShoulderY', label: 'L Shoulder Y', min: -0.5, max: 0.5, step: S, info: 'Left shoulder Y' },
      { key: 'rShoulderX', label: 'R Shoulder X', min: -0.5, max: 0.5, step: S, info: 'Right shoulder X' },
      { key: 'rShoulderY', label: 'R Shoulder Y', min: -0.5, max: 0.5, step: S, info: 'Right shoulder Y' },
      { key: 'lElbowX', label: 'L Elbow X', min: -0.5, max: 0.5, step: S, info: 'Left elbow X' },
      { key: 'lElbowY', label: 'L Elbow Y', min: -0.5, max: 0.5, step: S, info: 'Left elbow Y' },
      { key: 'rElbowX', label: 'R Elbow X', min: -0.5, max: 0.5, step: S, info: 'Right elbow X' },
      { key: 'rElbowY', label: 'R Elbow Y', min: -0.5, max: 0.5, step: S, info: 'Right elbow Y' },
      { key: 'lHandX', label: 'L Hand X', min: -0.5, max: 0.5, step: S, info: 'Left hand X' },
      { key: 'lHandY', label: 'L Hand Y', min: -0.5, max: 0.5, step: S, info: 'Left hand Y' },
      { key: 'rHandX', label: 'R Hand X', min: -0.5, max: 0.5, step: S, info: 'Right hand X' },
      { key: 'rHandY', label: 'R Hand Y', min: -0.5, max: 0.5, step: S, info: 'Right hand Y' },
      { key: 'lHipX', label: 'L Hip X', min: -0.5, max: 0.5, step: S, info: 'Left hip X' },
      { key: 'lHipY', label: 'L Hip Y', min: -0.5, max: 0.5, step: S, info: 'Left hip Y' },
      { key: 'rHipX', label: 'R Hip X', min: -0.5, max: 0.5, step: S, info: 'Right hip X' },
      { key: 'rHipY', label: 'R Hip Y', min: -0.5, max: 0.5, step: S, info: 'Right hip Y' },
      { key: 'lKneeX', label: 'L Knee X', min: -0.5, max: 0.5, step: S, info: 'Left knee X' },
      { key: 'lKneeY', label: 'L Knee Y', min: -0.5, max: 0.5, step: S, info: 'Left knee Y' },
      { key: 'rKneeX', label: 'R Knee X', min: -0.5, max: 0.5, step: S, info: 'Right knee X' },
      { key: 'rKneeY', label: 'R Knee Y', min: -0.5, max: 0.5, step: S, info: 'Right knee Y' },
      { key: 'lFootX', label: 'L Foot X', min: -0.5, max: 0.5, step: S, info: 'Left foot X' },
      { key: 'lFootY', label: 'L Foot Y', min: -0.5, max: 0.5, step: S, info: 'Left foot Y' },
      { key: 'rFootX', label: 'R Foot X', min: -0.5, max: 0.5, step: S, info: 'Right foot X' },
      { key: 'rFootY', label: 'R Foot Y', min: -0.5, max: 0.5, step: S, info: 'Right foot Y' },
    ]},
    { id: 'debug', title: 'Debug', color: '#e04040', sliders: [
      { key: 'showSilhouette', label: 'Silhouette', min: 0, max: 1, step: 1, info: 'Show body outline' },
      { key: 'showSkeleton', label: 'Bones', min: 0, max: 1, step: 1, info: 'Show skeleton bone lines' },
      { key: 'showJoints', label: 'Joints', min: 0, max: 1, step: 1, info: 'Show joint connection points' },
      { key: 'showDebugColors', label: 'Debug Colors', min: 0, max: 1, step: 1, info: 'Color-code particles by body part' },
      { key: 'showGrid', label: 'Grid', min: 0, max: 1, step: 1, info: 'Floor grid' },
    ]},
  ];

  const toggleSection = (id: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const frameRef = useRef<number>(0);
  const avatarGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
  const instancedMeshRef = useRef<Map<string, THREE.InstancedMesh>>(new Map());
  const ikChainsRef = useRef<Map<string, FABRIKChain[]>>(new Map());
  const jointMarkersRef = useRef<Map<string, Map<string, THREE.Mesh>>>(new Map());
  const boneGeometriesRef = useRef<Map<string, THREE.BufferGeometry[]>>(new Map());
  const morphStateRef = useRef<Map<string, MorphState>>(new Map());
  const auraUniformsRef = useRef<
    Map<
      string,
      {
        uTime: { value: number };
        uIntensity: { value: number };
        uEmotionColor: { value: number[] };
        uEmotionBlend: { value: number };
      }
    >
  >(new Map());
  const hairSystemsRef = useRef<Map<string, HairParticleSystem>>(new Map());
  const visemeStatesRef = useRef<Map<string, VisemeState>>(new Map());
  const debugModeRef = useRef(false);
  const avatarsRef = useRef<AvatarData[]>(avatars);
  // Merge added particles into avatar data
  const mergedAvatars = useMemo(() => {
    if (addedParticles.length === 0) return avatars;
    return avatars.map((a) => ({
      ...a,
      points: [...a.points, ...addedParticles],
    }));
  }, [avatars, addedParticles]);
  avatarsRef.current = mergedAvatars;

  // Keep viseme states ref in sync with prop
  if (visemeStates) {
    visemeStatesRef.current = visemeStates;
  }

  // Shared instanced sphere geometry for all point rendering
  const sharedSphereGeo = useMemo(() => new THREE.SphereGeometry(0.008, 5, 4), []);

  // Custom shader material for holographic glow with per-particle drift
  const holoUniforms = useMemo(() => ({
    uTime: { value: 0 },
    uBrightness: { value: 1.8 },
    uAlpha: { value: 0.75 },
    uCoreBoost: { value: 0.9 },
    uGradientPower: { value: 0.4 },
    uSizeScale: { value: 1.0 },
  }), []);
  const bodyTimeUniform = holoUniforms; // alias for existing references
  const glowMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: hologramGlowVertexShader,
        fragmentShader: hologramGlowFragmentShader,
        uniforms: holoUniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  );

  // Resolve joint positions AND world rotations from skeleton + pose using recursive FK.
  // Accumulates world-space rotations so that rotating a parent (e.g. chest)
  // correctly propagates through all descendants (neck → head, shoulder → elbow → hand).
  const resolveJointTransforms = useCallback((skeleton: JointDef[], pose: PoseData | null): JointTransforms => {
    const positions = new Map<string, THREE.Vector3>();
    const rotations = new Map<string, THREE.Quaternion>();

    // Build child lookup for recursive traversal
    const childrenOf = new Map<string | null, JointDef[]>();
    for (const joint of skeleton) {
      const siblings = childrenOf.get(joint.parent_id) || [];
      siblings.push(joint);
      childrenOf.set(joint.parent_id, siblings);
    }

    // Recursive FK: traverse from roots, accumulating world rotation
    const traverse = (joint: JointDef, parentWorldPos: THREE.Vector3, parentWorldRot: THREE.Quaternion): void => {
      // Local offset rotated by parent's accumulated world rotation
      const localOffset = new THREE.Vector3(...joint.position).applyQuaternion(parentWorldRot);
      const worldPos = parentWorldPos.clone().add(localOffset);

      // This joint's own local rotation from pose data
      const poseJoint = pose?.joints?.[joint.id];
      const localRot = poseJoint
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(poseJoint.rx, poseJoint.ry, poseJoint.rz))
        : new THREE.Quaternion();

      // World rotation = parent world rotation * local rotation
      const worldRot = parentWorldRot.clone().multiply(localRot);

      positions.set(joint.id, worldPos);
      rotations.set(joint.id, worldRot);

      // Recurse into children
      const children = childrenOf.get(joint.id);
      if (children) {
        for (const child of children) {
          traverse(child, worldPos, worldRot);
        }
      }
    };

    // Start from all root joints (parent_id === null)
    const roots = childrenOf.get(null) || [];
    for (const root of roots) {
      // Root joint: position is absolute, apply its own pose rotation
      const rootPos = new THREE.Vector3(...root.position);
      const poseJoint = pose?.joints?.[root.id];
      const rootRot = poseJoint
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(poseJoint.rx, poseJoint.ry, poseJoint.rz))
        : new THREE.Quaternion();

      positions.set(root.id, rootPos);
      rotations.set(root.id, rootRot);

      const children = childrenOf.get(root.id);
      if (children) {
        for (const child of children) {
          traverse(child, rootPos, rootRot);
        }
      }
    }

    return { positions, rotations };
  }, []);

  // Update bone line + instanced point geometry for an avatar at current morph state
  const updateAvatarGeometry = useCallback(
    (avatar: AvatarData, morphState: MorphState) => {
      const morphTargets = getEffectiveMorphTargets(avatar);
      let effectivePose = blendPoseMulti(avatar.pose, morphTargets, morphState.currentInfluences);
      // Merge manual pose angles from UI (clone to avoid mutation)
      const pa = poseAnglesRef.current;
      if (Object.keys(pa).length > 0) {
        const poseJoints = { ...(effectivePose?.joints || {}) };
        for (const [jid, angles] of Object.entries(pa)) {
          const existing = poseJoints[jid] || { rx: 0, ry: 0, rz: 0 };
          poseJoints[jid] = {
            rx: existing.rx + angles.rx,
            ry: existing.ry + angles.ry,
            rz: existing.rz + angles.rz,
          };
        }
        effectivePose = { ...effectivePose, joints: poseJoints };
      }
      const { positions: jointPositions, rotations: jointRotations } = resolveJointTransforms(
        avatar.skeleton,
        effectivePose,
      );
      jointPositionsRef.current = jointPositions;

      // ── Update bone lines ─────────────────────────────
      const boneGeos = boneGeometriesRef.current.get(avatar.id);
      if (boneGeos) {
        let bIdx = 0;
        for (const joint of avatar.skeleton) {
          if (!joint.parent_id) continue;
          const start = jointPositions.get(joint.parent_id);
          const end = jointPositions.get(joint.id);
          if (!start || !end || bIdx >= boneGeos.length) {
            bIdx++;
            continue;
          }
          const posArr = boneGeos[bIdx].getAttribute('position') as THREE.BufferAttribute;
          posArr.setXYZ(0, start.x, start.y, start.z);
          posArr.setXYZ(1, end.x, end.y, end.z);
          posArr.needsUpdate = true;
          bIdx++;
        }
      }

      // ── Comprehensive proportion scaling ─────────────────────
      const c = bodyProportionsRef.current;

      // Reference positions for relative scaling
      const headCenterY = 0.70;
      const shoulderBaseX = 0.125;
      const hipBaseX = 0.04;
      const eyeBaseY = 0.707;
      const noseBaseY = 0.685;
      const mouthBaseY = 0.652;

      const applyProportion = (pos: THREE.Vector3, jointId: string, point?: { offset: [number, number, number] }): void => {
        const side = jointId.startsWith('l_') ? -1 : (jointId.startsWith('r_') ? 1 : 0);
        const offset = point?.offset || [0, 0, 0];

        if (jointId === 'head') {
          // ─── HEAD / FACE ───
          // Base face scaling
          pos.x *= c.headScale * c.faceWidth;
          pos.z *= c.headScale * c.faceDepth;
          pos.y += c.headY * 0.1;
          pos.z += c.headOffsetZ;

          // Face height: scale Y distance from head center
          const relY = pos.y - headCenterY;
          pos.y = headCenterY + relY * c.faceHeight + c.headY * 0.1;

          // Forehead height: stretch above brow
          if (pos.y > 0.72) {
            const aboveBrow = pos.y - 0.72;
            pos.y = 0.72 + aboveBrow * c.foreheadHeight;
          }

          // Cheekbone width at cheekbone Y
          if (pos.y > 0.68 && pos.y < 0.72) {
            pos.x *= c.cheekboneWidth;
          }

          // Jaw width below cheekbones
          if (pos.y < 0.68 && pos.y > 0.63) {
            pos.x *= c.jawWidth;
          }

          // Chin width and length
          if (pos.y < 0.63) {
            pos.x *= c.chinWidth;
            const belowJaw = 0.63 - pos.y;
            pos.y = 0.63 - belowJaw * c.chinLength;
          }

          // Ear adjustments (particles with high |offset X|)
          if (Math.abs(offset[0]) > 0.06) {
            const earSide = offset[0] > 0 ? 1 : -1;
            pos.x *= c.earSpacing * c.earSize;
            pos.x += c.earOffsetX * earSide;
            pos.y += c.earOffsetY;
            pos.z += c.earOffsetZ;
          }

          // Eye adjustments (particles near eye Y)
          const eyeRelY = Math.abs(pos.y - (eyeBaseY + c.eyeHeight));
          if (eyeRelY < 0.015 && Math.abs(offset[0]) > 0.015) {
            // Eye spacing
            pos.x *= c.eyeSpacing;
            pos.y += c.eyeHeight;
          }

          // Eyebrow adjustments
          if (pos.y > 0.71 && pos.y < 0.73 && Math.abs(offset[2]) > 0.09) {
            pos.y += c.browHeight;
            pos.x *= c.browSpacing;
            // Arch: scale Y offset from baseline
            const browBaseY = 0.719;
            pos.y = browBaseY + (pos.y - browBaseY) * c.browArch + c.browHeight;
          }

          // Nose adjustments (particles near nose Z range)
          if (offset[2] > 0.10 && Math.abs(offset[0]) < 0.015 && pos.y > 0.66 && pos.y < 0.72) {
            pos.y += c.noseHeight;
            pos.x *= c.noseBridgeWidth * c.noseWidth;
            // Projection: scale Z offset beyond face surface
            const noseBaseZ = 0.108;
            pos.z = noseBaseZ + (pos.z - noseBaseZ) * c.noseProjection;
            // Length: scale Y extent
            const noseRelY = pos.y - 0.707;
            pos.y = 0.707 + noseRelY * c.noseLength + c.noseHeight;
          }

          // Mouth adjustments (particles near mouth Y)
          if (pos.y > 0.64 && pos.y < 0.66 && offset[2] > 0.09) {
            pos.y += c.mouthHeight;
            pos.x *= c.mouthWidth;
            // Lip projection
            const lipBaseZ = 0.117;
            pos.z = lipBaseZ + (pos.z - lipBaseZ) * c.lipProjection;
            // Smile: shift corners up/down
            const mouthRelX = Math.abs(pos.x) / 0.022;
            if (mouthRelX > 0.5) {
              pos.y += c.smileAmount * 0.005 * mouthRelX;
            }
          }

        } else if (jointId === 'neck') {
          // ─── NECK ───
          pos.x *= c.neckWidth * c.neckThickness;
          pos.z *= c.neckWidth * c.neckThickness;
          pos.x += c.neckOffsetX;
          pos.y += c.neckOffsetY;
          pos.z += c.neckOffsetZ;
          // Neck length: scale Y between shoulder and head
          const neckBaseY = 0.53;
          const neckTopY = 0.59;
          const neckRelY = (pos.y - neckBaseY) / (neckTopY - neckBaseY);
          pos.y = neckBaseY + neckRelY * (neckTopY - neckBaseY) * c.neckLength;

        } else if (jointId === 'l_shoulder' || jointId === 'r_shoulder' ||
                   jointId === 'l_elbow' || jointId === 'r_elbow' ||
                   jointId === 'l_hand' || jointId === 'r_hand') {
          // ─── ARMS ───
          const armSign = side;
          const shoulderX = armSign * shoulderBaseX * c.shoulderWidth;

          // Arm spread (X offset from torso)
          pos.x = shoulderX + (pos.x - armSign * shoulderBaseX) * c.armThickness * c.armSpread;
          pos.z *= c.armThickness;

          // Shoulder roundness at shoulder peak
          if (jointId.includes('shoulder') && pos.y > 0.44) {
            const shoulderRelR = Math.sqrt((pos.x - shoulderX) ** 2 + pos.z ** 2);
            const scale = c.shoulderRoundness;
            pos.x = shoulderX + (pos.x - shoulderX) * scale;
            pos.z *= scale;
          }

          // Elbow/wrist width
          if (jointId.includes('elbow')) {
            pos.x = shoulderX + (pos.x - shoulderX) * c.elbowWidth;
            pos.z *= c.elbowWidth;
          }
          if (jointId.includes('hand')) {
            pos.x = shoulderX + (pos.x - shoulderX) * c.wristWidth * c.handSize;
            pos.z *= c.wristWidth * c.handSize;
            pos.x += c.handOffsetX * side;
            pos.y += c.handOffsetY;
            pos.z += c.handOffsetZ;
          }
          // Arm offsets
          pos.x += c.armOffsetX * side;
          pos.y += c.armOffsetY;
          pos.z += c.armOffsetZ;
          pos.x += c.shoulderOffsetX * side;
          pos.y += c.shoulderOffsetY;
          pos.z += c.shoulderOffsetZ;

        } else if (jointId === 'chest' || jointId === 'spine' || jointId === 'root') {
          // ─── TORSO ───
          if (pos.y > 0.33) {
            // Upper torso / bust area
            pos.x *= c.torsoWidth * c.ribcageWidth;
            pos.z *= c.bustSize * c.bustProjection;

            // Bust-specific transforms (particles in bust zone: Y=0.34-0.42, Z>0.04)
            const isBustZone = pos.y > 0.34 && pos.y < 0.42 && offset[2] > 0.04;
            if (isBustZone) {
              const bustSide = offset[0] > 0 ? 1 : -1;
              pos.x *= c.bustWidth;
              pos.x += c.bustOffsetX + bustSide * (c.bustSpacing - 1.0) * 0.02;
              pos.y += c.bustOffsetY + c.bustHeight + c.bustDrop * Math.abs(offset[2]) * 2;
              pos.z += c.bustOffsetZ;

              // Nipple detection: particles at the peak of the bust (highest Z offset)
              const isNipple = offset[2] > 0.07 && Math.abs(offset[0]) > 0.02;
              if (isNipple) {
                pos.z *= c.nippleProjection;
                pos.x += c.nippleOffsetX * bustSide;
                pos.y += c.nippleOffsetY;
              }
            }

            // Shoulder slope at top of torso
            if (pos.y > 0.46) {
              const slopeT = (pos.y - 0.46) / (0.53 - 0.46);
              pos.x *= 1.0 + (c.shoulderSlope - 1.0) * slopeT;
            }
            // Upper torso Y offset and height
            const upperCenter = 0.40;
            pos.y = upperCenter + (pos.y - upperCenter) * c.upperTorsoHeight + c.upperTorsoOffsetY;
          } else if (pos.y > 0.10) {
            // Waist / belly
            pos.x *= c.waistWidth;
            pos.z *= c.waistWidth * c.bellyDepth;
            // Waist Y offset and height
            const waistCenter = 0.20;
            pos.y = waistCenter + (pos.y - waistCenter) * c.waistHeight + c.waistOffsetY;
          } else if (pos.y > -0.02) {
            // Hip / lower abdomen (above bifurcation)
            pos.x *= c.hipWidth;
            pos.z *= c.hipWidth * c.gluteSize * c.hipDepth;
            // Hip Y offset and height
            const hipCenter = 0.04;
            pos.y = hipCenter + (pos.y - hipCenter) * c.hipHeight + c.hipOffsetY;
          } else {
            // Bifurcation zone / glutes (below hip, transitions to legs)
            // Apply both hip and leg scaling so they match
            const legSign = pos.x > 0 ? 1 : -1;
            const legCX = legSign * 0.04 * c.legSpacing;
            pos.x = legCX + (pos.x - legSign * 0.04) * c.thighWidth * c.hipWidth;
            pos.z *= c.thighWidth * c.gluteSize;
            pos.y += c.legOffsetY;
          }
          // Torso length: scale Y from center
          const torsoCenter = 0.20;
          pos.y = torsoCenter + (pos.y - torsoCenter) * c.torsoLength;
          pos.x += c.torsoOffsetX;
          pos.y += c.torsoOffsetY;
          pos.z += c.torsoOffsetZ;
          // Hip-specific offsets for lower torso
          if (pos.y < 0.10) {
            pos.x += c.hipOffsetX;
            pos.y += c.hipOffsetY;
            pos.z *= c.hipDepth;
          }

        } else if (jointId === 'l_hip' || jointId === 'r_hip') {
          // ─── THIGHS ───
          const legSign = side;
          const legCX = legSign * hipBaseX * c.legSpacing;
          pos.x = legCX + (pos.x - legSign * hipBaseX) * c.thighWidth;
          pos.z *= c.thighWidth;
          // Leg length
          const hipY = -0.10;
          pos.y = hipY + (pos.y - hipY) * c.legLength * c.upperLegLength;
          pos.x += c.legOffsetX * side;
          pos.y += c.legOffsetY;
          pos.z += c.legOffsetZ;

        } else if (jointId === 'l_knee' || jointId === 'r_knee') {
          // ─── CALVES ───
          const legSign = side;
          const legCX = legSign * 0.055 * c.legSpacing;
          pos.x = legCX + (pos.x - legSign * 0.055) * c.calfWidth * c.kneeWidth;
          pos.z *= c.calfWidth;
          // Ankle taper
          if (pos.y < -0.70) {
            const ankleT = (-0.70 - pos.y) / 0.16;
            const ankleMul = 1.0 + (c.ankleWidth - 1.0) * ankleT;
            pos.x = legCX + (pos.x - legCX) * ankleMul;
            pos.z *= ankleMul;
          }
          // Lower leg length
          const kneeY = -0.48;
          pos.y = kneeY + (pos.y - kneeY) * c.legLength * c.lowerLegLength;
          pos.x += c.legOffsetX * side + c.calfOffsetX * side;
          pos.y += c.legOffsetY + c.calfOffsetY;
          pos.z += c.legOffsetZ + c.calfOffsetZ;

        } else if (jointId === 'l_foot' || jointId === 'r_foot') {
          // ─── FEET ───
          pos.x *= c.footSize;
          pos.z *= c.footSize;
          const legSign = side;
          pos.x += legSign * hipBaseX * (c.legSpacing - 1.0);
          pos.x += c.footOffsetX * side;
          pos.y += c.footOffsetY;
          pos.z += c.footOffsetZ;
          pos.x += c.legOffsetX * side;
          pos.y += c.legOffsetY;
          pos.z += c.legOffsetZ;
        }

        // Per-joint pivot offset — moves particles relative to their joint, not the FK chain
        const jointOffsets: Record<string, [string, string]> = {
          root: ['rootX', 'rootY'], spine: ['spineX', 'spineY'],
          chest: ['chestX', 'chestY'], neck: ['neckJointX', 'neckJointY'],
          head: ['headJointX', 'headJointY'],
          l_shoulder: ['lShoulderX', 'lShoulderY'], r_shoulder: ['rShoulderX', 'rShoulderY'],
          l_elbow: ['lElbowX', 'lElbowY'], r_elbow: ['rElbowX', 'rElbowY'],
          l_hand: ['lHandX', 'lHandY'], r_hand: ['rHandX', 'rHandY'],
          l_hip: ['lHipX', 'lHipY'], r_hip: ['rHipX', 'rHipY'],
          l_knee: ['lKneeX', 'lKneeY'], r_knee: ['rKneeX', 'rKneeY'],
          l_foot: ['lFootX', 'lFootY'], r_foot: ['rFootX', 'rFootY'],
        };
        const jOff = jointOffsets[jointId];
        if (jOff) {
          pos.x += (c as Record<string, number>)[jOff[0]] || 0;
          pos.y += (c as Record<string, number>)[jOff[1]] || 0;
        }
      };

      // ── Update instanced point mesh ───────────────────
      const instMesh = instancedMeshRef.current.get(avatar.id);
      if (instMesh && avatar.points.length > 0) {
        const dummy = new THREE.Matrix4();
        const scaleAttr = instMesh.geometry.getAttribute('instanceScale') as THREE.InstancedBufferAttribute;

        for (let i = 0; i < avatar.points.length; i++) {
          const point = avatar.points[i];
          const jointPos = jointPositions.get(point.joint_id);
          const jointRot = jointRotations.get(point.joint_id);
          if (!jointPos || !jointRot) continue;

          let offset = new THREE.Vector3(...point.offset);
          let sizeScale = 1.0;

          // Multi-emotion point morph blending
          for (let ei = 0; ei < EMOTIONS.length; ei++) {
            const w = morphState.currentInfluences[ei];
            if (w <= 0) continue;
            const morph = morphTargets[EMOTIONS[ei]]?.[0];
            if (!morph?.point_morphs) continue;
            const pm = morph.point_morphs.find((m) => m.joint_id === point.joint_id);
            if (pm) {
              offset.add(new THREE.Vector3(...pm.offset_delta).multiplyScalar(w));
              sizeScale += (pm.size_scale - 1) * w;
            }
          }

          // Viseme lip sync: apply Y-offset to lip particles in local space
          if (point.joint_id === 'head') {
            const vs = visemeStatesRef.current.get(avatar.label);
            if (vs && vs.weight > 0) {
              const lipOffset = VISEME_LIP_OFFSETS[vs.viseme] || VISEME_LIP_OFFSETS.rest;
              if (isUpperLip(point.offset)) {
                offset.y += lipOffset.upperY * vs.weight;
              } else if (isLowerLip(point.offset)) {
                offset.y += lipOffset.lowerY * vs.weight;
              }
            }
          }

          // Apply joint world rotation to point offset (fixes arm/leg rotation)
          offset.applyQuaternion(jointRot);
          const worldPos = jointPos.clone().add(offset);
          applyProportion(worldPos, point.joint_id, point);

          // Per-part density: multiply particle size (bigger = denser looking)
          let densityMul = 1.0;
          const jid = point.joint_id;
          if (jid === 'head') {
            const off = point.offset;
            // Detect sub-features by offset position
            if (Math.abs(off[0]) > 0.02 && Math.abs(off[1] - 0.087) < 0.015 && off[2] > 0.08) {
              densityMul = c.eyeDensity; // eyes
            } else if (off[1] > 0.09 && off[2] > 0.08) {
              densityMul = c.browDensity; // brows
            } else if (Math.abs(off[0]) < 0.01 && off[2] > 0.10) {
              densityMul = c.noseDensity; // nose
            } else if (off[1] < 0.04 && off[1] > 0.02 && off[2] > 0.08) {
              densityMul = c.mouthDensity; // mouth
            } else if (Math.abs(off[0]) > 0.06) {
              densityMul = c.earDensity; // ears
            } else if (off[1] < 0.06) {
              densityMul = c.faceDensity; // lower face
            } else {
              densityMul = c.headDensity; // skull
            }
          } else if (jid === 'neck') {
            densityMul = c.neckDensity;
          } else if (jid.includes('shoulder')) {
            densityMul = c.shoulderDensity;
          } else if (jid.includes('elbow')) {
            densityMul = c.armDensity;
          } else if (jid.includes('hand')) {
            densityMul = c.handDensity;
          } else if (jid === 'chest' || jid === 'spine' || jid === 'root') {
            // Bust/nipple density
            const off = point.offset;
            if (jid === 'chest' && off[1] > -0.06 && off[1] < 0.02 && off[2] > 0.04) {
              if (off[2] > 0.07 && Math.abs(off[0]) > 0.02) {
                densityMul = c.nippleDensity; // nipple
              } else {
                densityMul = c.bustDensity; // bust
              }
            } else {
              densityMul = c.torsoDensity;
            }
          } else if (jid.includes('hip')) {
            densityMul = c.thighDensity;
          } else if (jid.includes('knee')) {
            densityMul = c.calfDensity;
          } else if (jid.includes('foot')) {
            densityMul = c.footDensity;
          }

          // Organ detection by color tag
          const organKey = ORGAN_COLORS[point.color];
          if (organKey) {
            const organDensity = (cfgRef.current as Record<string, number>)[organKey] ?? 1.0;
            if (organDensity === 0) {
              // Skip this particle entirely
              dummy.makeTranslation(0, -100, 0);
              instMesh.setMatrixAt(i * 2, dummy);
              instMesh.setMatrixAt(i * 2 + 1, dummy);
              scaleAttr.setX(i * 2, 0);
              scaleAttr.setX(i * 2 + 1, 0);
              continue;
            }
          }

          // Hide deleted particles
          if (deletedRef.current.has(i)) {
            dummy.makeTranslation(0, -100, 0); // move off-screen
            instMesh.setMatrixAt(i * 2, dummy);
            instMesh.setMatrixAt(i * 2 + 1, dummy);
            scaleAttr.setX(i * 2, 0);
            scaleAttr.setX(i * 2 + 1, 0);
            continue;
          }
          const pointSize = point.size * 0.008 * sizeScale * densityMul;

          // Core point
          dummy.makeTranslation(worldPos.x, worldPos.y, worldPos.z);
          instMesh.setMatrixAt(i * 2, dummy);
          scaleAttr.setX(i * 2, pointSize / 0.008);

          // Glow sphere
          instMesh.setMatrixAt(i * 2 + 1, dummy);
          scaleAttr.setX(i * 2 + 1, (pointSize * 1.0) / 0.008);
        }

        // Highlight selected part purple in edit mode
        const colorAttr = instMesh.geometry.getAttribute('instanceColor') as THREE.InstancedBufferAttribute;
        if (colorAttr && editModeRef.current) {
          const purple = new THREE.Color(0x9933ff);
          const bodyCol = new THREE.Color(0x4dd8d0);
          for (let i = 0; i < avatar.points.length; i++) {
            if (deletedRef.current.has(i)) continue;
            const isSelected = avatar.points[i].joint_id === editPartRef.current;
            const col = isSelected ? purple : bodyCol;
            colorAttr.setXYZ(i * 2, col.r, col.g, col.b);
            colorAttr.setXYZ(i * 2 + 1, col.r, col.g, col.b);
          }
          colorAttr.needsUpdate = true;
        }

        scaleAttr.needsUpdate = true;
        instMesh.count = Math.min(avatar.points.length * 2, MAX_POINT_INSTANCES);
        instMesh.instanceMatrix.needsUpdate = true;
      }

      // ── Update joint markers ──────────────────────────
      const markers = jointMarkersRef.current.get(avatar.id);
      if (markers) {
        for (const [jointId, pos] of jointPositions) {
          const marker = markers.get(jointId);
          if (marker) marker.position.copy(pos);
        }
      }
    },
    [resolveJointTransforms],
  );

  // Build avatar group (structural: bones, points, markers — morph state applied via animation loop)
  const buildAvatarGroup = useCallback(
    (avatar: AvatarData): THREE.Group => {
      const group = new THREE.Group();
      group.name = avatar.id;

      // Get current morph state for initial geometry
      const mState = morphStateRef.current.get(avatar.id);
      const morphTargets = getEffectiveMorphTargets(avatar);
      const influences = mState?.currentInfluences ?? new Float32Array(EMOTIONS.length);
      const effectivePose = blendPoseMulti(avatar.pose, morphTargets, influences);
      const { positions: jointPositions, rotations: jointRotations } = resolveJointTransforms(
        avatar.skeleton,
        effectivePose,
      );

      // ── Bones (Lines) — toggled via debug settings ──
      const boneMaterial = new THREE.LineBasicMaterial({
        color: 0x2a7a76, linewidth: 1, transparent: true, opacity: 0.5,
      });
      const boneGroup = new THREE.Group();
      boneGroup.name = 'bones';
      boneGroup.visible = false; // hidden by default
      const boneGeos: THREE.BufferGeometry[] = [];
      for (const joint of avatar.skeleton) {
        if (!joint.parent_id) continue;
        const start = jointPositions.get(joint.parent_id);
        const end = jointPositions.get(joint.id);
        if (!start || !end) continue;
        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        boneGroup.add(new THREE.Line(geometry, boneMaterial));
        boneGeos.push(geometry);
      }
      group.add(boneGroup);
      boneGeometriesRef.current.set(avatar.id, boneGeos);

      // ── Joint markers — toggled via debug settings ──
      const jointGroup = new THREE.Group();
      jointGroup.name = 'jointMarkers';
      jointGroup.visible = false;
      const jointMarkerMat = new THREE.MeshBasicMaterial({
        color: 0xff8800, transparent: true, opacity: 0.7,
      });
      for (const [jointId, pos] of jointPositions) {
        const jGeo = new THREE.SphereGeometry(0.008, 6, 4);
        const jMesh = new THREE.Mesh(jGeo, jointMarkerMat);
        jMesh.position.copy(pos);
        jointGroup.add(jMesh);
      }
      group.add(jointGroup);

      // ── Points (Instanced Mesh with GPU glow shader) ─
      const pointCount = avatar.points.length;
      if (pointCount > 0) {
        // Allocate extra capacity for dynamically added particles
        const instanceCount = Math.min(Math.max(pointCount * 2, pointCount * 2 + 2000), MAX_POINT_INSTANCES);
        const instancedMesh = new THREE.InstancedMesh(sharedSphereGeo, glowMaterial, instanceCount);
        instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        const scaleAttr = new Float32Array(instanceCount);
        const colorAttr = new Float32Array(instanceCount * 3);
        const glowAttr = new Float32Array(instanceCount);
        const opacityAttr = new Float32Array(instanceCount);

        const dummy = new THREE.Matrix4();
        const tempColor = new THREE.Color();

        for (let i = 0; i < pointCount; i++) {
          const point = avatar.points[i];
          const jointPos = jointPositions.get(point.joint_id);
          const jointRot = jointRotations.get(point.joint_id);
          if (!jointPos || !jointRot) continue;

          let offset = new THREE.Vector3(...point.offset);
          let sizeScale = 1.0;

          // Apply current morph influences
          for (let ei = 0; ei < EMOTIONS.length; ei++) {
            const w = influences[ei];
            if (w <= 0) continue;
            const morph = morphTargets[EMOTIONS[ei]]?.[0];
            if (!morph?.point_morphs) continue;
            const pm = morph.point_morphs.find((m) => m.joint_id === point.joint_id);
            if (pm) {
              offset.add(new THREE.Vector3(...pm.offset_delta).multiplyScalar(w));
              sizeScale += (pm.size_scale - 1) * w;
            }
          }

          // Apply joint world rotation to point offset (fixes arm/leg rotation)
          offset.applyQuaternion(jointRot);
          const worldPos = jointPos.clone().add(offset);
          const pointSize = point.size * 0.008 * sizeScale;

          // Core point — tiny, bright
          dummy.makeTranslation(worldPos.x, worldPos.y, worldPos.z);
          instancedMesh.setMatrixAt(i * 2, dummy);
          scaleAttr[i * 2] = pointSize / 0.008;
          // Use organ debug colors if enabled, otherwise body color for organs
          const isOrgan = ORGAN_COLORS[point.color];
          const showDebugOrgan = cfgRef.current.debugOrgans > 0.5;
          const displayColor = (isOrgan && !showDebugOrgan)
            ? `#${HOLOGRAM_COLOR.toString(16)}`
            : (point.color || `#${HOLOGRAM_COLOR.toString(16)}`);
          tempColor.set(displayColor);
          colorAttr[i * 2 * 3] = tempColor.r;
          colorAttr[i * 2 * 3 + 1] = tempColor.g;
          colorAttr[i * 2 * 3 + 2] = tempColor.b;
          glowAttr[i * 2] = 0.5;
          // Per-particle opacity: random 0.4-1.0
          const particleOpacity = 0.4 + Math.random() * 0.6;
          opacityAttr[i * 2] = particleOpacity;

          // Glow sphere — larger, soft, translucent
          const glowIdx = i * 2 + 1;
          dummy.makeTranslation(worldPos.x, worldPos.y, worldPos.z);
          instancedMesh.setMatrixAt(glowIdx, dummy);
          scaleAttr[glowIdx] = (pointSize * 1.0) / 0.008;
          colorAttr[glowIdx * 3] = tempColor.r;
          colorAttr[glowIdx * 3 + 1] = tempColor.g;
          colorAttr[glowIdx * 3 + 2] = tempColor.b;
          glowAttr[glowIdx] = 1.0;
          opacityAttr[glowIdx] = particleOpacity;
        }

        instancedMesh.geometry.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(scaleAttr, 1));
        instancedMesh.geometry.setAttribute('instanceColor', new THREE.InstancedBufferAttribute(colorAttr, 3));
        instancedMesh.geometry.setAttribute('instanceGlow', new THREE.InstancedBufferAttribute(glowAttr, 1));
        instancedMesh.geometry.setAttribute('instanceOpacity', new THREE.InstancedBufferAttribute(opacityAttr, 1));

        instancedMesh.count = Math.min(pointCount * 2, instanceCount);
        instancedMesh.instanceMatrix.needsUpdate = true;
        group.add(instancedMesh);

        instancedMeshRef.current.set(avatar.id, instancedMesh);
      }

      // ── Joint markers (hidden — no visible spheres at joints) ──
      const pointJointIds = new Set(avatar.points.map((p) => p.joint_id));
      const markerMap = new Map<string, THREE.Mesh>();
      for (const [jointId, pos] of jointPositions) {
        if (pointJointIds.has(jointId)) continue;
        const geo = new THREE.SphereGeometry(0.015, 6, 4);
        const marker = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
        marker.position.copy(pos);
        markerMap.set(jointId, marker);
      }
      jointMarkersRef.current.set(avatar.id, markerMap);

      // ── Debug silhouette outline (toggle with 'o' key) ──────────
      // Smoothed convex hull per Y-slice. One closed outer contour.
      {
        const worldPts: { x: number; y: number }[] = [];
        for (const pt of avatar.points) {
          const jPos = jointPositions.get(pt.joint_id);
          if (!jPos) continue;
          worldPts.push({ x: jPos.x + pt.offset[0], y: jPos.y + pt.offset[1] });
        }

        const step = 0.005;
        const yMin = Math.min(...worldPts.map((p) => p.y));
        const yMax = Math.max(...worldPts.map((p) => p.y));

        // Collect raw left/right edges
        const rawLeft: number[] = [];
        const rawRight: number[] = [];
        const yLevels: number[] = [];

        for (let y = yMin; y <= yMax; y += step) {
          const band = worldPts.filter((p) => Math.abs(p.y - y) < step);
          if (band.length < 2) {
            rawLeft.push(0);
            rawRight.push(0);
            yLevels.push(y);
            continue;
          }
          let minX = Infinity, maxX = -Infinity;
          for (const p of band) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
          }
          rawLeft.push(minX);
          rawRight.push(maxX);
          yLevels.push(y);
        }

        // Smooth with moving average (window 5)
        const smooth = (arr: number[]) => {
          const out = [...arr];
          for (let i = 2; i < arr.length - 2; i++) {
            out[i] = (arr[i - 2] + arr[i - 1] + arr[i] + arr[i + 1] + arr[i + 2]) / 5;
          }
          return out;
        };

        const sLeft = smooth(rawLeft);
        const sRight = smooth(rawRight);

        // Build closed loop: right edge top→bottom, left edge bottom→top
        const contour: THREE.Vector3[] = [];

        // Right edge: top to bottom
        for (let i = yLevels.length - 1; i >= 0; i--) {
          if (sRight[i] !== 0 || rawRight[i] !== 0) {
            contour.push(new THREE.Vector3(sRight[i], yLevels[i], 0));
          }
        }

        // Left edge: bottom to top
        for (let i = 0; i < yLevels.length; i++) {
          if (sLeft[i] !== 0 || rawLeft[i] !== 0) {
            contour.push(new THREE.Vector3(sLeft[i], yLevels[i], 0));
          }
        }

        // Close
        if (contour.length > 3) contour.push(contour[0].clone());

        const silhouetteGroup = new THREE.Group();
        silhouetteGroup.name = 'silhouette';
        silhouetteGroup.visible = false;

        const magentaMat = new THREE.LineBasicMaterial({ color: 0xff00ff, linewidth: 2 });
        if (contour.length > 4) {
          silhouetteGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(contour), magentaMat));
        }

        group.add(silhouetteGroup);
      }

      // ── Aura glow plane (emotion-modulated) ────────────
      const emotionIdx = avatar.activeMorph ? (EMOTION_INDEX[avatar.activeMorph] ?? 3) : 3;
      const emotionKey = EMOTIONS[emotionIdx] || 'neutral';
      const auraColor = AURA_COLORS[emotionKey as keyof typeof AURA_COLORS] || AURA_COLORS.neutral;
      const auraUniforms = {
        uTime: { value: 0 },
        uIntensity: { value: 0.6 },
        uEmotionColor: { value: [...auraColor] },
        uEmotionBlend: { value: emotionIdx === 3 ? 0 : 1 },
      };
      auraUniformsRef.current.set(avatar.id, auraUniforms);

      const auraMaterial = new THREE.ShaderMaterial({
        vertexShader: auraVertexShader,
        fragmentShader: auraFragmentShader,
        uniforms: auraUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const auraGeo = new THREE.PlaneGeometry(1.5, 2.0);
      const auraMesh = new THREE.Mesh(auraGeo, auraMaterial);
      auraMesh.position.set(0, 0.0, -0.3); // behind avatar center
      auraMesh.name = 'aura';
      // Aura disabled — was creating visible glow behind avatar
      // group.add(auraMesh);

      // ── Particle Hair System (DISABLED — causes visible internal glow) ──
      const headJointExists = false;
      if (headJointExists) {
        const hairData = buildHairParticles();
        const hairGeo = new THREE.BufferGeometry();
        hairGeo.setAttribute('position', new THREE.BufferAttribute(hairData.positions, 3));
        hairGeo.setAttribute('color', new THREE.BufferAttribute(hairData.colors, 3));
        hairGeo.setAttribute('hairT', new THREE.BufferAttribute(hairData.hairT, 1));
        hairGeo.setAttribute('size', new THREE.BufferAttribute(hairData.sizes, 1));

        const hairUniforms = { uTime: { value: 0 } };
        const hairMat = new THREE.ShaderMaterial({
          vertexShader: hairVertexShader,
          fragmentShader: hairFragmentShader,
          uniforms: hairUniforms,
          transparent: true,
          depthWrite: false,
          depthTest: true,
          blending: THREE.AdditiveBlending,
          vertexColors: true,
        });

        const hairMesh = new THREE.Points(hairGeo, hairMat);
        hairMesh.name = 'hair';
        // Position relative to head joint
        const headPos = jointPositions.get('head');
        if (headPos) {
          hairMesh.position.copy(headPos);
        }
        group.add(hairMesh);

        hairSystemsRef.current.set(avatar.id, {
          geometry: hairGeo,
          mesh: hairMesh,
          uniforms: hairUniforms,
        });
      }

      return group;
    },
    [sharedSphereGeo, glowMaterial, resolveJointTransforms],
  );

  // Initialize Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 100);
    camera.position.set(0, -0.05, 2.5);
    camera.lookAt(0, -0.1, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Ground grid (hologram aesthetic) — at foot level Y=-1.0
    const gridHelper = new THREE.GridHelper(4, 20, GRID_COLOR, GRID_COLOR);
    gridHelper.position.y = -1.0;
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.3;
    scene.add(gridHelper);
    gridRef.current = gridHelper;

    // Edit mode selection sphere
    const editSphereGeo = new THREE.SphereGeometry(1, 16, 12);
    const editSphereMat = new THREE.MeshBasicMaterial({
      color: 0xff4444, transparent: true, opacity: 0.15, wireframe: true,
    });
    const editSphere = new THREE.Mesh(editSphereGeo, editSphereMat);
    editSphere.visible = false;
    scene.add(editSphere);
    editSphereRef.current = editSphere;

    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);

    // ── Free-roam camera controls (WASD + mouse look) ──────────────
    const keysDown = new Set<string>();
    let moveSpeed = 1.0;
    let yaw = 0;
    let pitch = 0;
    let isPointerLocked = false;

    // Extract initial yaw/pitch from camera direction
    const initDir = new THREE.Vector3(0, -0.1, 0).sub(camera.position).normalize();
    yaw = Math.atan2(-initDir.x, -initDir.z);
    pitch = Math.asin(initDir.y);

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't capture keys when typing in inputs
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      keysDown.add(e.key.toLowerCase());

      // Toggle silhouette outline with 'O' key
      if (e.key.toLowerCase() === 'o') {
        scene.traverse((obj) => {
          if (obj.name === 'silhouette') {
            obj.visible = !obj.visible;
          }
        });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.delete(e.key.toLowerCase());
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.target !== renderer.domElement) return;

      // Edit mode: right-click places selection sphere
      if (e.button === 2 && editSphereRef.current?.visible) {
        e.preventDefault();
        const rect = renderer.domElement.getBoundingClientRect();
        const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);
        // Intersect with Z=0 plane
        const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
        const hit = new THREE.Vector3();
        raycaster.ray.intersectPlane(plane, hit);
        if (hit) {
          setEditPos([hit.x, hit.y, hit.z]);
          editSphereRef.current.position.set(hit.x, hit.y, hit.z);
        }
        return;
      }

      if (e.button === 0) {
        renderer.domElement.requestPointerLock();
      }
    };
    // Prevent context menu in edit mode
    renderer.domElement.addEventListener('contextmenu', (e: Event) => {
      if (editSphereRef.current?.visible) e.preventDefault();
    });
    const onPointerLockChange = () => {
      isPointerLocked = document.pointerLockElement === renderer.domElement;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isPointerLocked) return;
      const sensitivity = 0.002;
      yaw -= e.movementX * sensitivity;
      pitch -= e.movementY * sensitivity;
      pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    };
    const onWheel = (e: WheelEvent) => {
      if (e.target !== renderer.domElement) return;
      moveSpeed = Math.max(0.1, Math.min(10, moveSpeed * (e.deltaY > 0 ? 0.9 : 1.1)));
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('mousedown', onMouseDown);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: true });

    const updateFlyCamera = (delta: number) => {
      // Apply yaw/pitch to camera rotation
      const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
      camera.quaternion.setFromEuler(euler);

      // Movement relative to camera direction
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const speed = moveSpeed * delta;

      if (keysDown.has('w')) camera.position.addScaledVector(forward, speed);
      if (keysDown.has('s')) camera.position.addScaledVector(forward, -speed);
      if (keysDown.has('a')) camera.position.addScaledVector(right, -speed);
      if (keysDown.has('d')) camera.position.addScaledVector(right, speed);
      if (keysDown.has(' ')) camera.position.y += speed;
      if (keysDown.has('shift')) camera.position.y -= speed;
    };

    // Animation loop
    const clock = new THREE.Clock();
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      const delta = clock.getDelta();

      // Free-roam camera
      updateFlyCamera(delta);

      // ── Smooth morph interpolation ────────────────────
      for (const [avatarId, mState] of morphStateRef.current) {
        let needsUpdate = false;

        // Lerp each influence channel toward target
        for (let i = 0; i < EMOTIONS.length; i++) {
          const current = mState.currentInfluences[i];
          const target = mState.targetInfluences[i];
          if (Math.abs(current - target) > 0.001) {
            const step = MORPH_LERP_SPEED * delta;
            mState.currentInfluences[i] =
              current + Math.sign(target - current) * Math.min(step, Math.abs(target - current));
            needsUpdate = true;
          }
        }

        // Lerp overall weight
        if (Math.abs(mState.currentWeight - mState.targetWeight) > 0.001) {
          const step = MORPH_LERP_SPEED * delta;
          mState.currentWeight +=
            Math.sign(mState.targetWeight - mState.currentWeight) *
            Math.min(step, Math.abs(mState.targetWeight - mState.currentWeight));
          needsUpdate = true;
        }

        // Also update if any viseme is active for this avatar
        const avatar = avatarsRef.current.find((a) => a.id === avatarId);
        const hasActiveViseme = avatar && visemeStatesRef.current.get(avatar.label)?.weight;

        if (needsUpdate || mState.dirty || hasActiveViseme) {
          mState.dirty = false;
          if (avatar) {
            updateAvatarGeometry(avatar, mState);
          }
        }
      }

      // ── Update body particle drift ──────────────────────────────
      const elapsed = clock.elapsedTime;
      bodyTimeUniform.uTime.value = elapsed;

      // ── Update hair particle system ────────────────────────────
      for (const [avatarId, hairSystem] of hairSystemsRef.current) {
        const avatar = avatarsRef.current.find((a) => a.id === avatarId);
        if (!avatar) continue;

        // Update time uniform for shader-based sway animation
        hairSystem.uniforms.uTime.value = elapsed;

        // Sync hair mesh position with head joint
        const mState = morphStateRef.current.get(avatarId);
        const morphTargets = getEffectiveMorphTargets(avatar);
        const influences = mState?.currentInfluences ?? new Float32Array(EMOTIONS.length);
        const effectivePose = blendPoseMulti(avatar.pose, morphTargets, influences);
        const { positions: jp } = resolveJointTransforms(avatar.skeleton, effectivePose);

        const headPos = jp.get('head');
        if (headPos) {
          hairSystem.mesh.position.set(headPos.x, headPos.y, headPos.z);
        }
      }

      // ── Tick aura shader uniforms ────────────────────────
      for (const [, uniforms] of auraUniformsRef.current) {
        uniforms.uTime.value = elapsed;
      }

      // Face forward (no rotation)

      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    // Apply debug colors to all instanced meshes
    const applyDebugColors = (enabled: boolean, highlightGroup?: string) => {
      const tempColor = new THREE.Color();
      const highlightJoints = highlightGroup ? (HIGHLIGHT_GROUPS[highlightGroup] || []) : [];
      for (const [avatarId, instMesh] of instancedMeshRef.current) {
        const avatar = avatarsRef.current.find((a) => a.id === avatarId);
        if (!avatar) continue;
        const colorAttr = instMesh.geometry.getAttribute('instanceColor') as THREE.InstancedBufferAttribute;
        if (!colorAttr) continue;
        for (let i = 0; i < avatar.points.length; i++) {
          const point = avatar.points[i];
          let hex: string;
          if (!enabled) {
            hex = point.color || `#${HOLOGRAM_COLOR.toString(16)}`;
          } else if (highlightJoints.length > 0) {
            // Highlight mode: bright color for highlighted joints, dim for others
            hex = highlightJoints.includes(point.joint_id)
              ? (DEBUG_COLORS[point.joint_id] || '#44cc66')
              : '#1a3a38';
          } else {
            hex = DEBUG_COLORS[point.joint_id] || '#44cc66';
          }
          tempColor.set(hex);
          colorAttr.setXYZ(i * 2, tempColor.r, tempColor.g, tempColor.b);
          colorAttr.setXYZ(i * 2 + 1, tempColor.r, tempColor.g, tempColor.b);
        }
        colorAttr.needsUpdate = true;
      }
    };

    // Poll window.__hologramDebug for programmatic control
    let lastDebugEnabled: boolean | undefined;
    let lastHighlight: string | undefined;
    applyDebugColorsRef.current = applyDebugColors;
    const debugPollInterval = setInterval(() => {
      const cfg = window.__hologramDebug;
      if (!cfg) return;
      if (cfg.enabled !== lastDebugEnabled || cfg.highlight !== lastHighlight) {
        lastDebugEnabled = cfg.enabled;
        lastHighlight = cfg.highlight;
        debugModeRef.current = cfg.enabled;
        applyDebugColors(cfg.enabled, cfg.highlight);
      }
    }, 200);

    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
      clearInterval(debugPollInterval);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      renderer.domElement.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      scene.clear();
      ikChainsRef.current.clear();
      instancedMeshRef.current.clear();
      jointMarkersRef.current.clear();
      auraUniformsRef.current.clear();
      boneGeometriesRef.current.clear();
      morphStateRef.current.clear();
      hairSystemsRef.current.clear();
    };
  }, [updateAvatarGeometry]);

  // Sync avatar groups when avatars prop changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const currentIds = new Set(avatars.map((a) => a.id));
    const groups = avatarGroupsRef.current;

    // Remove avatars no longer present
    for (const [id, group] of groups) {
      if (!currentIds.has(id)) {
        scene.remove(group);
        groups.delete(id);
        instancedMeshRef.current.delete(id);
        jointMarkersRef.current.delete(id);
        boneGeometriesRef.current.delete(id);
        morphStateRef.current.delete(id);
        auraUniformsRef.current.delete(id);
        ikChainsRef.current.delete(id);
        hairSystemsRef.current.delete(id);
      }
    }

    // Add/update avatars
    for (const avatar of avatars) {
      // Initialize or update morph state
      let mState = morphStateRef.current.get(avatar.id);
      const targetEmotion = avatar.activeMorph || 'neutral';
      const targetWeight = avatar.morphWeight ?? 0;

      if (!mState) {
        // New avatar — set morph state, influences start at zero (will lerp)
        const targetInfluences = new Float32Array(EMOTIONS.length);
        const idx = EMOTION_INDEX[targetEmotion];
        if (idx !== undefined && targetEmotion !== 'neutral') {
          targetInfluences[idx] = targetWeight;
        }
        mState = {
          targetEmotion,
          targetWeight,
          currentWeight: 0,
          currentInfluences: new Float32Array(EMOTIONS.length),
          targetInfluences,
          dirty: true,
        };
        morphStateRef.current.set(avatar.id, mState);
      } else {
        // Existing avatar — update target (animation loop will lerp)
        mState.targetEmotion = targetEmotion;
        mState.targetWeight = targetWeight;
        // Reset target influences
        mState.targetInfluences.fill(0);
        const idx = EMOTION_INDEX[targetEmotion];
        if (idx !== undefined && targetEmotion !== 'neutral') {
          mState.targetInfluences[idx] = targetWeight;
        }
      }

      // Update aura uniforms to match current emotion
      const auraUniforms = auraUniformsRef.current.get(avatar.id);
      if (auraUniforms) {
        const eIdx = EMOTION_INDEX[targetEmotion] ?? 3;
        const eKey = EMOTIONS[eIdx] || 'neutral';
        const rgb = AURA_COLORS[eKey as keyof typeof AURA_COLORS] || AURA_COLORS.neutral;
        auraUniforms.uEmotionColor.value = [...rgb];
        auraUniforms.uEmotionBlend.value = eIdx === 3 ? 0 : targetWeight;
      }

      // Only rebuild group if avatar is new or structural data changed
      const existing = groups.get(avatar.id);
      const needsRebuild = !existing;

      if (needsRebuild) {
        if (existing) scene.remove(existing);
        const group = buildAvatarGroup(avatar);
        scene.add(group);
        groups.set(avatar.id, group);

        // Build FABRIK IK chains for physics-enabled avatars
        if (avatar.physics) {
          const { positions: jointPositions } = resolveJointTransforms(avatar.skeleton, avatar.pose);
          const chains: FABRIKChain[] = [];

          const leftArmIds = ['chest', 'l_shoulder', 'l_elbow', 'l_hand'].filter((id) =>
            avatar.skeleton.some((j) => j.id === id),
          );
          if (leftArmIds.length >= 2) {
            const chain = buildFABRIKChain(jointPositions, leftArmIds);
            if (chain) chains.push(chain);
          }

          const rightArmIds = ['chest', 'r_shoulder', 'r_elbow', 'r_hand'].filter((id) =>
            avatar.skeleton.some((j) => j.id === id),
          );
          if (rightArmIds.length >= 2) {
            const chain = buildFABRIKChain(jointPositions, rightArmIds);
            if (chain) chains.push(chain);
          }

          const leftLegIds = ['root', 'l_hip', 'l_knee', 'l_foot'].filter((id) =>
            avatar.skeleton.some((j) => j.id === id),
          );
          if (leftLegIds.length >= 2) {
            const chain = buildFABRIKChain(jointPositions, leftLegIds);
            if (chain) chains.push(chain);
          }

          const rightLegIds = ['root', 'r_hip', 'r_knee', 'r_foot'].filter((id) =>
            avatar.skeleton.some((j) => j.id === id),
          );
          if (rightLegIds.length >= 2) {
            const chain = buildFABRIKChain(jointPositions, rightLegIds);
            if (chain) chains.push(chain);
          }

          ikChainsRef.current.set(avatar.id, chains);
        }
      } else {
        // Morph-only change — mark dirty, animation loop handles geometry update
        mState.dirty = true;
      }
    }
  }, [avatars, buildAvatarGroup, resolveJointTransforms]);

  // Sync edit sphere visibility/size
  useEffect(() => {
    if (editSphereRef.current) {
      editSphereRef.current.visible = editMode;
      editSphereRef.current.scale.setScalar(editRadius);
      editSphereRef.current.position.set(editPos[0], editPos[1], editPos[2]);
    }
  }, [editMode, editRadius, editPos]);

  // Sync settings to shader uniforms in real-time
  useEffect(() => {
    holoUniforms.uBrightness.value = holoSettings.brightness;
    holoUniforms.uAlpha.value = holoSettings.alpha;
    holoUniforms.uCoreBoost.value = holoSettings.coreBoost;
    holoUniforms.uGradientPower.value = holoSettings.gradientPower;
    holoUniforms.uSizeScale.value = holoSettings.sizeScale;
    if (gridRef.current) {
      (gridRef.current.material as THREE.Material).opacity = holoSettings.gridOpacity;
      gridRef.current.visible = holoSettings.showGrid > 0.5;
    }
    // Toggle debug elements
    if (sceneRef.current) {
      sceneRef.current.traverse((obj) => {
        if (obj.name === 'silhouette') obj.visible = holoSettings.showSilhouette > 0.5;
        if (obj.name === 'bones') obj.visible = holoSettings.showSkeleton > 0.5;
        if (obj.name === 'jointMarkers') obj.visible = holoSettings.showJoints > 0.5;
      });
    }
    // Debug colors
    const wantDebug = holoSettings.showDebugColors > 0.5;
    if (wantDebug !== debugModeRef.current) {
      debugModeRef.current = wantDebug;
      if (applyDebugColorsRef.current) {
        applyDebugColorsRef.current(wantDebug);
      }
    }
    // Mark dirty to refresh colors (debug/organ)
    for (const [, ms] of morphStateRef.current) ms.dirty = true;
  }, [holoSettings, holoUniforms]);

  // settingsDef removed — now in sections array above

  return (
    <div className={classes.container} ref={containerRef} style={{ position: 'relative' }}>
      {/* Settings gear icon */}
      <div
        onClick={() => setSettingsOpen(!settingsOpen)}
        style={{
          position: 'absolute', top: 8, left: 8, zIndex: 10, cursor: 'pointer',
          width: 28, height: 28, borderRadius: 4,
          background: settingsOpen ? 'rgba(77,216,208,0.3)' : 'rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, color: '#4dd8d0', border: '1px solid rgba(77,216,208,0.3)',
        }}
        title="Hologram Settings"
      >&#9881;</div>

      {/* Animation maker button */}
      <div
        onClick={() => setAnimOpen(!animOpen)}
        style={{
          position: 'absolute', top: 8, left: 110, zIndex: 10, cursor: 'pointer',
          width: 28, height: 28, borderRadius: 4,
          background: animOpen ? 'rgba(224,160,64,0.3)' : 'rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: animOpen ? '#e0a040' : '#888',
          border: `1px solid ${animOpen ? 'rgba(224,160,64,0.5)' : 'rgba(255,255,255,0.2)'}`,
        }}
        title="Animation Maker"
      >&#9835;</div>

      {/* Animation panel */}
      {animOpen && (
        <AnimationPanel
          poseAngles={poseAngles}
          onPoseChange={setPoseAngles}
          onPlayingChange={setAnimPlaying}
          poseAnglesRef={poseAnglesRef}
          morphStateRef={morphStateRef as React.MutableRefObject<Map<string, { dirty: boolean }>>}
        />
      )}

      {/* Pose controller button */}
      <div
        onClick={() => { setPoseOpen(!poseOpen); if (!poseOpen) setEditMode(false); }}
        style={{
          position: 'absolute', top: 8, left: 76, zIndex: 10, cursor: 'pointer',
          width: 28, height: 28, borderRadius: 4,
          background: poseOpen ? 'rgba(64,192,224,0.3)' : 'rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: poseOpen ? '#40c0e0' : '#888',
          border: `1px solid ${poseOpen ? 'rgba(64,192,224,0.5)' : 'rgba(255,255,255,0.2)'}`,
        }}
        title="Pose Controller"
      >&#9995;</div>

      {/* Pose controller panel */}
      {poseOpen && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          background: 'rgba(10,20,25,0.94)', border: '1px solid rgba(64,192,224,0.3)',
          borderRadius: 6, padding: '10px 12px', width: 220,
          fontFamily: 'monospace', fontSize: 10, color: '#a0d8e0',
          maxHeight: '85vh', overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 'bold', color: '#40c0e0' }}>Pose Controller</span>
            <button onClick={() => { setPoseAngles({}); }}
              style={{ marginLeft: 'auto', padding: '2px 6px', background: 'rgba(255,100,100,0.1)', border: '1px solid rgba(255,100,100,0.3)', borderRadius: 3, color: '#ff8888', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace' }}>
              Reset</button>
          </div>
          {/* Preset poses */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 8 }}>
            {[
              { name: 'Default', pose: {} },
              { name: 'T-Pose', pose: {
                l_shoulder: { rx: 0, ry: 0, rz: -1.57 },
                r_shoulder: { rx: 0, ry: 0, rz: 1.57 },
              }},
              { name: 'A-Pose', pose: {
                l_shoulder: { rx: 0, ry: 0, rz: 0.5 },
                r_shoulder: { rx: 0, ry: 0, rz: -0.5 },
              }},
              { name: 'Idle', pose: {
                l_shoulder: { rx: 0, ry: 0, rz: 0.3 },
                r_shoulder: { rx: 0, ry: 0, rz: -0.3 },
                l_elbow: { rx: -0.2, ry: 0, rz: 0 },
                r_elbow: { rx: -0.2, ry: 0, rz: 0 },
                l_hip: { rx: 0.05, ry: 0, rz: 0 },
                r_hip: { rx: -0.05, ry: 0, rz: 0 },
                spine: { rx: 0, ry: 0.03, rz: 0 },
              }},
              { name: 'Wave', pose: {
                r_shoulder: { rx: 0, ry: 0, rz: -2.8 },
                r_elbow: { rx: 0, ry: 1.2, rz: 0 },
                l_shoulder: { rx: 0, ry: 0, rz: 0.3 },
                head: { rx: 0, ry: 0.1, rz: 0.05 },
              }},
              { name: 'Hip Pose', pose: {
                l_shoulder: { rx: 0, ry: 0, rz: 0.3 },
                r_shoulder: { rx: 0.3, ry: 0, rz: -0.8 },
                r_elbow: { rx: -1.4, ry: 0, rz: 0 },
                l_hip: { rx: 0, ry: 0, rz: -0.08 },
                r_hip: { rx: 0.15, ry: 0, rz: 0.08 },
                spine: { rx: 0, ry: 0, rz: 0.05 },
                head: { rx: 0, ry: -0.1, rz: -0.05 },
              }},
              { name: 'Sit', pose: {
                l_hip: { rx: -1.5, ry: 0, rz: 0 },
                r_hip: { rx: -1.5, ry: 0, rz: 0 },
                l_knee: { rx: 1.5, ry: 0, rz: 0 },
                r_knee: { rx: 1.5, ry: 0, rz: 0 },
                l_shoulder: { rx: 0, ry: 0, rz: 0.3 },
                r_shoulder: { rx: 0, ry: 0, rz: -0.3 },
                l_elbow: { rx: -0.8, ry: 0, rz: 0 },
                r_elbow: { rx: -0.8, ry: 0, rz: 0 },
              }},
              { name: 'Walk', pose: {
                l_hip: { rx: -0.4, ry: 0, rz: 0 },
                r_hip: { rx: 0.3, ry: 0, rz: 0 },
                l_knee: { rx: 0.2, ry: 0, rz: 0 },
                r_knee: { rx: 0.5, ry: 0, rz: 0 },
                l_shoulder: { rx: 0.3, ry: 0, rz: 0.2 },
                r_shoulder: { rx: -0.3, ry: 0, rz: -0.2 },
                l_elbow: { rx: -0.3, ry: 0, rz: 0 },
                r_elbow: { rx: -0.5, ry: 0, rz: 0 },
              }},
              { name: 'Dance', pose: {
                l_shoulder: { rx: 0, ry: 0, rz: 1.8 },
                r_shoulder: { rx: 0.5, ry: 0, rz: -2.5 },
                l_elbow: { rx: -1.2, ry: 0.5, rz: 0 },
                r_elbow: { rx: -0.8, ry: -0.5, rz: 0 },
                l_hip: { rx: -0.2, ry: 0.1, rz: -0.1 },
                r_hip: { rx: 0.1, ry: -0.1, rz: 0.15 },
                spine: { rx: 0, ry: 0, rz: -0.1 },
                chest: { rx: 0, ry: 0.15, rz: 0 },
                head: { rx: 0, ry: 0.2, rz: 0.1 },
              }},
            ].map(({ name, pose }) => (
              <button key={name} onClick={() => setPoseAngles(pose as Record<string, { rx: number; ry: number; rz: number }>)}
                style={{
                  padding: '3px 6px', background: 'rgba(64,192,224,0.15)',
                  border: '1px solid rgba(64,192,224,0.3)', borderRadius: 3,
                  color: '#40c0e0', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace',
                }}>
                {name}
              </button>
            ))}
          </div>
          <div style={{ marginBottom: 8, fontSize: 9, color: '#666' }}>
            Rotate joints. Values in degrees.
          </div>
          {/* Redraw silhouette button */}
          <button onClick={() => {
            if (sceneRef.current) {
              // Remove old silhouette
              sceneRef.current.traverse((obj) => {
                if (obj.name === 'silhouette') obj.removeFromParent();
              });
              // Mark dirty to regenerate
              for (const [, ms] of morphStateRef.current) ms.dirty = true;
            }
          }}
            style={{ width: '100%', padding: '4px 0', marginBottom: 8, background: 'rgba(255,0,255,0.15)', border: '1px solid rgba(255,0,255,0.3)', borderRadius: 3, color: '#ff66ff', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>
            Redraw Silhouette
          </button>
          {[
            { id: 'l_shoulder', label: 'L Shoulder' },
            { id: 'r_shoulder', label: 'R Shoulder' },
            { id: 'l_elbow', label: 'L Elbow' },
            { id: 'r_elbow', label: 'R Elbow' },
            { id: 'l_hand', label: 'L Wrist' },
            { id: 'r_hand', label: 'R Wrist' },
            { id: 'l_hip', label: 'L Hip' },
            { id: 'r_hip', label: 'R Hip' },
            { id: 'l_knee', label: 'L Knee' },
            { id: 'r_knee', label: 'R Knee' },
            { id: 'l_foot', label: 'L Ankle' },
            { id: 'r_foot', label: 'R Ankle' },
            { id: 'spine', label: 'Spine' },
            { id: 'chest', label: 'Chest' },
            { id: 'neck', label: 'Neck' },
            { id: 'head', label: 'Head' },
          ].map(({ id, label }) => {
            const a = poseAngles[id] || { rx: 0, ry: 0, rz: 0 };
            const setA = (axis: 'rx' | 'ry' | 'rz', val: number) => {
              setPoseAngles((prev) => ({ ...prev, [id]: { ...a, [axis]: val } }));
            };
            return (
              <div key={id} style={{ marginBottom: 6, borderBottom: '1px solid rgba(64,192,224,0.1)', paddingBottom: 4 }}>
                <div style={{ fontSize: 10, color: '#40c0e0', marginBottom: 2 }}>{label}</div>
                {(['rx', 'ry', 'rz'] as const).map((axis) => (
                  <div key={axis} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                    <span style={{ width: 16, fontSize: 9, color: '#888' }}>{axis.toUpperCase()}</span>
                    <input type="range" min={-180} max={180} step={1}
                      value={Math.round((a[axis] || 0) * 180 / Math.PI)}
                      onChange={(e) => setA(axis, parseFloat(e.target.value) * Math.PI / 180)}
                      style={{ flex: 1, accentColor: '#40c0e0', height: 3 }} />
                    <span style={{ width: 28, fontSize: 9, color: '#40c0e0', textAlign: 'right' }}>
                      {Math.round((a[axis] || 0) * 180 / Math.PI)}°
                    </span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit mode button */}
      <div
        onClick={() => { setEditMode(!editMode); if (!editMode) setPoseOpen(false); }}
        style={{
          position: 'absolute', top: 8, left: 42, zIndex: 10, cursor: 'pointer',
          width: 28, height: 28, borderRadius: 4,
          background: editMode ? 'rgba(255,68,68,0.4)' : 'rgba(255,255,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: editMode ? '#ff4444' : '#888',
          border: `1px solid ${editMode ? 'rgba(255,68,68,0.5)' : 'rgba(255,255,255,0.2)'}`,
        }}
        title="Particle Editor (right-click to place, scroll to resize, Enter to delete)"
      >&#9986;</div>

      {/* Edit mode controls */}
      {editMode && (
        <div style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          background: 'rgba(10,20,25,0.94)', border: '1px solid rgba(255,68,68,0.3)',
          borderRadius: 6, padding: '10px 12px', width: 200,
          fontFamily: 'monospace', fontSize: 10, color: '#e0a0a0',
        }}>
          <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 8, color: '#ff4444' }}>
            Particle Editor
          </div>
          <div style={{ marginBottom: 6, fontSize: 9, color: '#999' }}>
            Right-click to place sphere. Scroll to resize. Particles inside will be highlighted.
          </div>
          <div style={{ marginBottom: 6 }}>
            <span>Radius: </span>
            <span style={{ color: '#ff6666' }}>{editRadius.toFixed(3)}</span>
            <input type="range" min={0.005} max={0.3} step={0.005} value={editRadius}
              onChange={(e) => setEditRadius(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: '#ff4444', height: 3 }} />
          </div>
          <div style={{ marginBottom: 6, fontSize: 9 }}>
            Pos: ({editPos[0].toFixed(3)}, {editPos[1].toFixed(3)}, {editPos[2].toFixed(3)})
          </div>
          <div style={{ marginBottom: 6 }}>
            <span>X: </span>
            <input type="range" min={-0.5} max={0.5} step={0.005} value={editPos[0]}
              onChange={(e) => setEditPos([parseFloat(e.target.value), editPos[1], editPos[2]])}
              style={{ width: '80%', accentColor: '#ff4444', height: 3 }} />
          </div>
          <div style={{ marginBottom: 6 }}>
            <span>Y: </span>
            <input type="range" min={-1.0} max={1.0} step={0.005} value={editPos[1]}
              onChange={(e) => setEditPos([editPos[0], parseFloat(e.target.value), editPos[2]])}
              style={{ width: '80%', accentColor: '#ff4444', height: 3 }} />
          </div>
          <div style={{ marginBottom: 6 }}>
            <span>Z: </span>
            <input type="range" min={-0.5} max={0.5} step={0.005} value={editPos[2]}
              onChange={(e) => setEditPos([editPos[0], editPos[1], parseFloat(e.target.value)])}
              style={{ width: '80%', accentColor: '#ff4444', height: 3 }} />
          </div>
          {/* Part selector */}
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 9 }}>Part: </span>
            <select value={editPart} onChange={(e) => setEditPart(e.target.value)}
              style={{ background: '#1a2a2e', color: '#4dd8d0', border: '1px solid #3a5a5e', borderRadius: 3, fontSize: 9, padding: '2px 4px', fontFamily: 'monospace' }}>
              {['head', 'neck', 'chest', 'spine', 'root',
                'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_hand', 'r_hand',
                'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_foot', 'r_foot',
              ].map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 9 }}>Add count: </span>
            <input type="range" min={1} max={100} step={1} value={editAddCount}
              onChange={(e) => setEditAddCount(parseInt(e.target.value))}
              style={{ width: '50%', accentColor: '#44ff44', height: 3 }} />
            <span style={{ color: '#44ff44', fontSize: 9 }}> {editAddCount}</span>
          </div>
          <div style={{ fontSize: 9, marginBottom: 4, color: '#888' }}>
            Deleted: {deletedParticles.size} | Added: {addedParticles.length}
          </div>
          <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
            <button onClick={() => {
              // Delete particles inside sphere
              const avatar = avatarsRef.current[0];
              if (!avatar) return;
              const newDeleted = new Set(deletedParticles);
              const [sx, sy, sz] = editPos;
              const r2 = editRadius * editRadius;
              const jp = jointPositionsRef.current;
              for (let i = 0; i < avatar.points.length; i++) {
                const pt = avatar.points[i];
                const jPos = jp?.get(pt.joint_id);
                if (!jPos) continue;
                const dx = jPos.x + pt.offset[0] - sx;
                const dy = jPos.y + pt.offset[1] - sy;
                const dz = jPos.z + pt.offset[2] - sz;
                if (dx * dx + dy * dy + dz * dz < r2) newDeleted.add(i);
              }
              setDeletedParticles(newDeleted);
              localStorage.setItem('holoDeletedParticles', JSON.stringify([...newDeleted]));
              for (const [, ms] of morphStateRef.current) ms.dirty = true;
            }}
              style={{ flex: 1, padding: '4px 0', background: 'rgba(255,68,68,0.3)', border: '1px solid rgba(255,68,68,0.5)', borderRadius: 3, color: '#ff4444', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace' }}>
              Delete</button>
            <button onClick={() => {
              // Add particles inside sphere
              const jp = jointPositionsRef.current;
              const jPos = jp?.get(editPart);
              if (!jPos) return;
              const [sx, sy, sz] = editPos;
              const newPts = [...addedParticles];
              for (let i = 0; i < editAddCount; i++) {
                // Random position inside sphere
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const r = editRadius * Math.cbrt(Math.random()); // uniform volume
                const px = sx + r * Math.sin(phi) * Math.cos(theta);
                const py = sy + r * Math.sin(phi) * Math.sin(theta); // note: phi for Y in this context
                const pz = sz + r * Math.cos(phi);
                newPts.push({
                  joint_id: editPart,
                  offset: [px - jPos.x, py - jPos.y, pz - jPos.z] as [number, number, number],
                  size: 0.12,
                  color: '#4dd8d0',
                });
              }
              setAddedParticles(newPts);
              localStorage.setItem('holoAddedParticles', JSON.stringify(newPts));
              // Need to rebuild instanced mesh to include new particles
              // For now, mark dirty — added particles need to be merged into avatar data
              for (const [, ms] of morphStateRef.current) ms.dirty = true;
            }}
              style={{ flex: 1, padding: '4px 0', background: 'rgba(68,255,68,0.3)', border: '1px solid rgba(68,255,68,0.5)', borderRadius: 3, color: '#44ff44', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace' }}>
              Add {editAddCount}</button>
          </div>
          <div style={{ display: 'flex', gap: 3 }}>
            <button onClick={() => {
              setDeletedParticles(new Set());
              setAddedParticles([]);
              localStorage.removeItem('holoDeletedParticles');
              localStorage.removeItem('holoAddedParticles');
              for (const [, ms] of morphStateRef.current) ms.dirty = true;
            }}
              style={{ flex: 1, padding: '4px 0', background: 'rgba(255,200,50,0.15)', border: '1px solid rgba(255,200,50,0.3)', borderRadius: 3, color: '#ffcc44', cursor: 'pointer', fontSize: 9, fontFamily: 'monospace' }}>
              Undo All</button>
          </div>
        </div>
      )}

      {/* Settings panel */}
      {settingsOpen && (
        <div style={{
          position: 'absolute', top: 42, left: 8, zIndex: 10,
          background: 'rgba(10,20,25,0.94)', border: '1px solid rgba(77,216,208,0.3)',
          borderRadius: 6, padding: '10px 12px', width: 230,
          fontFamily: 'monospace', fontSize: 10, color: '#b0e0dc',
          maxHeight: '85vh', overflowY: 'auto',
        }}>
          {/* Global buttons */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
            <button onClick={() => { localStorage.setItem('holoCfg', JSON.stringify(cfg)); }}
              style={{ flex: 1, padding: '4px 0', background: 'rgba(77,216,208,0.2)', border: '1px solid rgba(77,216,208,0.4)', borderRadius: 3, color: '#4dd8d0', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>
              Save All</button>
            <button onClick={() => { setCfg({ ...allDefaults }); localStorage.removeItem('holoCfg'); }}
              style={{ flex: 1, padding: '4px 0', background: 'rgba(255,100,100,0.1)', border: '1px solid rgba(255,100,100,0.3)', borderRadius: 3, color: '#ff8888', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace' }}>
              Reset All</button>
          </div>
          {/* ─── All Sections ─── */}
          {sections.map((sec) => (
            <div key={sec.id} style={{ marginBottom: 4 }}>
              <div onClick={() => toggleSection(sec.id)} style={{
                cursor: 'pointer', padding: '4px 6px', borderRadius: 3, marginBottom: 2,
                background: openSections.has(sec.id) ? `${sec.color}18` : 'transparent',
                border: `1px solid ${sec.color}40`, display: 'flex', alignItems: 'center',
              }}>
                <span style={{ color: sec.color, fontWeight: 'bold', fontSize: 11 }}>{sec.title}</span>
                <span style={{ marginLeft: 'auto', color: sec.color, fontSize: 9 }}>
                  {openSections.has(sec.id) ? '▼' : '▶'}
                </span>
              </div>
              {openSections.has(sec.id) && (
                <div style={{ padding: '4px 2px' }}>
                  {sec.sliders.map(({ key, label, min, max, step, info }) => (
                    <div key={key} style={{ marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 1 }}>
                        <span style={{ fontSize: 10 }}>{label}</span>
                        <span title={info} style={{
                          cursor: 'help', fontSize: 8, color: `${sec.color}aa`,
                          border: `1px solid ${sec.color}66`, borderRadius: '50%',
                          width: 11, height: 11, display: 'inline-flex',
                          alignItems: 'center', justifyContent: 'center',
                        }}>?</span>
                        <span style={{ marginLeft: 'auto', color: sec.color, fontSize: 10 }}>
                          {(cfg[key as keyof HoloSettings] as number).toFixed(step < 0.01 ? 3 : 2)}
                        </span>
                      </div>
                      <input type="range" min={min} max={max} step={step}
                        value={cfg[key as keyof HoloSettings] as number}
                        onChange={(e) => setCfg((s: HoloSettings) => ({ ...s, [key]: parseFloat(e.target.value) }))}
                        style={{ width: '100%', accentColor: sec.color, height: 3 }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {/* old settings removed — now using sections above */}

          {/* old body proportions section removed — now in sections above */}
        </div>
      )}
      {avatars.length === 1 && avatars[0].id !== '__default__' && (
        <div className={classes.label}>{avatars[0].label}</div>
      )}
    </div>
  );
};

export default HologramViewer;
