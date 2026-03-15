'use client';

// React modules
import { useEffect, useRef, useCallback, useMemo } from 'react';

// Node modules
import * as THREE from 'three';

// GA-evolved morph target samples (fallback when backend doesn't provide them)
import gaSamples from '../../public/hologram_samples.json';

// Aura shader for emotion-modulated glow
import { auraVertexShader, auraFragmentShader, AURA_COLORS } from './auraShader';

// Styles
import classes from './HologramViewer.module.scss';

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

    vec3 scaledPos = position * instanceScale;
    vec4 worldPos = instanceMatrix * vec4(scaledPos, 1.0);
    worldPos.xyz += drift;

    vec4 mvPosition = modelViewMatrix * worldPos;
    vViewPosition = -mvPosition.xyz;
    vDepth = -mvPosition.z;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const hologramGlowFragmentShader = `
  varying vec3 vColor;
  varying float vGlow;
  varying float vOpacity;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  varying float vDepth;

  void main() {
    // Radial gradient: bright core fading to transparent edge
    vec3 viewDir = normalize(vViewPosition);
    float facing = max(dot(viewDir, normalize(vNormal)), 0.0);

    // Glow gradient: center = bright, edge = fades out
    float gradient = pow(facing, 0.4);
    float coreBoost = pow(facing, 2.0); // extra brightness at dead center

    // No depth-based dimming — constant brightness at all distances
    vec3 finalColor = vColor * (0.6 + coreBoost * 0.3);

    // Alpha: gradient from solid center to transparent edge
    float alpha = gradient * 0.25 * vOpacity;

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
const isUpperLip = (offset: [number, number, number]): boolean =>
  offset[1] >= 0.06 && offset[1] <= 0.075 && offset[2] >= 0.025 && offset[2] <= 0.035;

/** Check if a head-joint point is a lower lip particle */
const isLowerLip = (offset: [number, number, number]): boolean =>
  offset[1] >= 0.05 && offset[1] <= 0.065 && offset[2] >= 0.024 && offset[2] <= 0.034;

const HologramViewer: React.FC<HologramViewerProps> = ({ avatars: avatarsProp, visemeStates }) => {
  // Use default test avatar when no avatars provided so the 3D scene always renders
  const avatars = useMemo(
    () => (avatarsProp.length > 0 ? avatarsProp : [getDefaultAvatar()]),
    [avatarsProp],
  );
  const containerRef = useRef<HTMLDivElement>(null);
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
  avatarsRef.current = avatars;

  // Keep viseme states ref in sync with prop
  if (visemeStates) {
    visemeStatesRef.current = visemeStates;
  }

  // Shared instanced sphere geometry for all point rendering
  const sharedSphereGeo = useMemo(() => new THREE.SphereGeometry(0.008, 5, 4), []);

  // Custom shader material for holographic glow with per-particle drift
  const bodyTimeUniform = useMemo(() => ({ uTime: { value: 0 } }), []);
  const glowMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: hologramGlowVertexShader,
        fragmentShader: hologramGlowFragmentShader,
        uniforms: bodyTimeUniform,
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
      const effectivePose = blendPoseMulti(avatar.pose, morphTargets, morphState.currentInfluences);
      const { positions: jointPositions, rotations: jointRotations } = resolveJointTransforms(
        avatar.skeleton,
        effectivePose,
      );

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
          const pointSize = point.size * 0.008 * sizeScale;

          // Core point
          dummy.makeTranslation(worldPos.x, worldPos.y, worldPos.z);
          instMesh.setMatrixAt(i * 2, dummy);
          scaleAttr.setX(i * 2, pointSize / 0.008);

          // Glow sphere
          instMesh.setMatrixAt(i * 2 + 1, dummy);
          scaleAttr.setX(i * 2 + 1, (pointSize * 1.0) / 0.008);
        }

        scaleAttr.needsUpdate = true;
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

      // ── Bones (Lines) — hidden, geometry kept for FK updates ──
      const boneGeos: THREE.BufferGeometry[] = [];
      for (const joint of avatar.skeleton) {
        if (!joint.parent_id) continue;
        const start = jointPositions.get(joint.parent_id);
        const end = jointPositions.get(joint.id);
        if (!start || !end) continue;
        const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
        boneGeos.push(geometry);
      }
      boneGeometriesRef.current.set(avatar.id, boneGeos);

      // ── Points (Instanced Mesh with GPU glow shader) ─
      const pointCount = avatar.points.length;
      if (pointCount > 0) {
        const instanceCount = Math.min(pointCount * 2, MAX_POINT_INSTANCES);
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
          tempColor.set(point.color || `#${HOLOGRAM_COLOR.toString(16)}`);
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
      group.add(auraMesh);

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
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keysDown.delete(e.key.toLowerCase());
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.target === renderer.domElement && e.button === 0) {
        renderer.domElement.requestPointerLock();
      }
    };
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

  return (
    <div className={classes.container} ref={containerRef}>
      {avatars.length === 1 && avatars[0].id !== '__default__' && (
        <div className={classes.label}>{avatars[0].label}</div>
      )}
    </div>
  );
};

export default HologramViewer;
