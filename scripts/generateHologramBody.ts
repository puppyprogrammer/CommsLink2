/**
 * Generate a realistic feminine humanoid point cloud for the hologram avatar.
 * Based on detailed proportional spec: 2.0 units total height, natural female
 * athletic-slim build (~5'7" equivalent).
 *
 * Uses stacked elliptical cross-sections with Catmull-Rom interpolation.
 * Includes bust hemisphere volumes, hip-to-leg bifurcation, and facial features.
 *
 * IMPORTANT: Joint world positions MUST match the DB skeleton resolved via FK.
 *
 * Run: npx ts-node scripts/generateHologramBody.ts
 * Output: scripts/hologram_body.json
 */

type Point = {
  joint_id: string;
  offset: [number, number, number];
  size: number;
  color: string;
};

const points: Point[] = [];

const COL = {
  body: '#4dd8d0',
  dim: '#3ab8b0',
  highlight: '#7eeae5',
  contour: '#5cc8c2',
  eye: '#ffffff',
  eyeGlow: '#80ffff',
  bright: '#a0f0ec',
  lip: '#6de0da',
};

// Debug colors per body group
const DEBUG: Record<string, string> = {
  head: '#44cc66',
  neck: '#ffdd44',
  l_shoulder: '#ffdd44',
  r_shoulder: '#ffdd44',
  chest: '#ff9944',
  root: '#aacc44',
  spine: '#aacc44',
  l_elbow: '#4488ff',
  r_elbow: '#4488ff',
  l_hand: '#44ddff',
  r_hand: '#44ddff',
  l_hip: '#ff99cc',
  r_hip: '#ff99cc',
  l_knee: '#ff69b4',
  r_knee: '#ff69b4',
  l_foot: '#cc44cc',
  r_foot: '#cc44cc',
};

function debugColor(jointId: string): string {
  return DEBUG[jointId] || '#aacc44';
}

// ══════════════════════════════════════════════════════════════
// JOINT WORLD POSITIONS — FK-resolved from DB skeleton
//
// Total height: 2.0 units. Root (crotch) at Y=0.
// Feet at ~Y=-0.88 (ankle joint), foot geometry extends to ~-1.0
// Head center at Y=0.84, top of head at ~Y=1.0
//
// DB skeleton (relative offsets from parent):
//   root:       [0, 0, 0]         (absolute)
//   spine:      [0, 0.26, 0]      → [0, 0.26, 0]
//   chest:      [0, 0.32, 0]      → [0, 0.58, 0]
//   neck:       [0, 0.10, 0]      → [0, 0.68, 0]
//   head:       [0, 0.16, 0]      → [0, 0.84, 0]
//   l_shoulder: [-0.22, 0.06, 0]  → [-0.22, 0.64, 0]
//   l_elbow:    [0, -0.24, 0]     → [-0.22, 0.40, 0]
//   l_hand:     [0, -0.22, 0]     → [-0.22, 0.18, 0]
//   l_hip:      [-0.105, 0, 0]    → [-0.105, 0, 0]
//   l_knee:     [0, -0.44, 0]     → [-0.105, -0.44, 0]
//   l_foot:     [0, -0.44, 0]     → [-0.105, -0.88, 0]
// ══════════════════════════════════════════════════════════════

const JOINTS: Record<string, [number, number, number]> = {
  root:       [0, 0, 0],
  spine:      [0, 0.26, 0],
  chest:      [0, 0.58, 0],
  neck:       [0, 0.68, 0],
  head:       [0, 0.84, 0],
  l_shoulder: [-0.22, 0.64, 0],
  r_shoulder: [0.22, 0.64, 0],
  l_elbow:    [-0.22, 0.40, 0],
  r_elbow:    [0.22, 0.40, 0],
  l_hand:     [-0.22, 0.18, 0],
  r_hand:     [0.22, 0.18, 0],
  l_hip:      [-0.105, 0, 0],
  r_hip:      [0.105, 0, 0],
  l_knee:     [-0.105, -0.44, 0],
  r_knee:     [0.105, -0.44, 0],
  l_foot:     [-0.105, -0.88, 0],
  r_foot:     [0.105, -0.88, 0],
};

// ══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ══════════════════════════════════════════════════════════════

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/** Find the closest joint for a world Y position */
function jointForY(y: number): string {
  if (y > 0.76) return 'head';
  if (y > 0.66) return 'neck';
  if (y > 0.42) return 'chest';
  if (y > 0.13) return 'spine';
  return 'root';
}

/** Add a point converting world position to joint-relative offset */
function addPoint(wx: number, wy: number, wz: number, jointId: string, size: number, color: string): void {
  const j = JOINTS[jointId];
  const disp = 0.003;
  points.push({
    joint_id: jointId,
    offset: [
      wx - j[0] + rand(-disp, disp),
      wy - j[1] + rand(-disp, disp),
      wz - j[2] + rand(-disp, disp),
    ],
    size: size * rand(0.85, 1.15),
    color,
  });
}

/** Sample surface of an ellipsoid */
function ellipsoid(
  cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number,
  count: number, jointId: string, size: number, color: string,
  latMin = -Math.PI / 2, latMax = Math.PI / 2,
): void {
  for (let i = 0; i < count; i++) {
    const lat = rand(latMin, latMax);
    const lon = rand(0, Math.PI * 2);
    addPoint(
      cx + rx * Math.cos(lat) * Math.cos(lon),
      cy + ry * Math.sin(lat),
      cz + rz * Math.cos(lat) * Math.sin(lon),
      jointId, size, color,
    );
  }
}

// ══════════════════════════════════════════════════════════════
// TORSO CROSS-SECTIONS
//
// Spec proportions converted to units (h=2.0, root at Y=0).
// Width/depth values are HALF-widths (radii).
//
// Spec widths (full diameter → half):
//   Neck:     0.11 → 0.055       Shoulder: 0.44 → 0.22
//   Ribcage:  0.34 → 0.17        Bust:     0.40 → 0.20
//   Waist:    0.29 → 0.145       Hip:      0.42 → 0.21
// ══════════════════════════════════════════════════════════════

type Section = {
  y: number;
  w: number;   // half-width (X radius)
  d: number;   // half-depth (Z radius)
  joint: string;
  bust?: number; // forward bust projection at this Y
};

const sections: Section[] = [
  // Crotch / leg divide (ratio 0.50)
  { y: 0.00,  w: 0.16,  d: 0.12,  joint: 'root' },
  // Lower pelvis
  { y: 0.06,  w: 0.18,  d: 0.13,  joint: 'root' },
  // Hip bone — widest (ratio 0.58)
  { y: 0.16,  w: 0.21,  d: 0.15,  joint: 'root' },
  // Above hips — start narrowing
  { y: 0.22,  w: 0.19,  d: 0.14,  joint: 'spine' },
  // Navel (ratio 0.63)
  { y: 0.26,  w: 0.17,  d: 0.13,  joint: 'spine' },
  // Natural waist — narrowest (ratio 0.66)
  { y: 0.32,  w: 0.145, d: 0.12,  joint: 'spine' },
  // Above waist
  { y: 0.37,  w: 0.155, d: 0.125, joint: 'spine' },
  // Under-bust / ribcage (ratio 0.71)
  { y: 0.42,  w: 0.17,  d: 0.13,  joint: 'chest' },
  // Bust line (ratio 0.75) — widest upper torso
  { y: 0.50,  w: 0.20,  d: 0.14,  joint: 'chest', bust: 0.045 },
  // Above bust
  { y: 0.54,  w: 0.19,  d: 0.13,  joint: 'chest', bust: 0.015 },
  // Armpit (ratio 0.78)
  { y: 0.56,  w: 0.185, d: 0.12,  joint: 'chest' },
  // Upper chest
  { y: 0.60,  w: 0.20,  d: 0.11,  joint: 'chest' },
  // Shoulder line (ratio 0.82) — wide, shallow
  { y: 0.64,  w: 0.22,  d: 0.10,  joint: 'chest' },
  // Collarbone / neck base (ratio 0.84)
  { y: 0.68,  w: 0.10,  d: 0.07,  joint: 'neck' },
  // Mid neck
  { y: 0.72,  w: 0.055, d: 0.055, joint: 'neck' },
  // Upper neck
  { y: 0.75,  w: 0.050, d: 0.050, joint: 'neck' },
];

/** Evaluate torso profile at any Y using Catmull-Rom interpolation */
function evalTorsoAt(y: number): { w: number; d: number; joint: string; bust: number } | null {
  if (y < sections[0].y || y > sections[sections.length - 1].y) return null;

  let idx = 0;
  for (let i = 0; i < sections.length - 1; i++) {
    if (y >= sections[i].y && y <= sections[i + 1].y) { idx = i; break; }
  }

  const t = sections[idx + 1].y === sections[idx].y
    ? 0 : (y - sections[idx].y) / (sections[idx + 1].y - sections[idx].y);

  const i0 = Math.max(0, idx - 1);
  const i1 = idx;
  const i2 = idx + 1;
  const i3 = Math.min(sections.length - 1, idx + 2);

  const w = catmullRom(sections[i0].w, sections[i1].w, sections[i2].w, sections[i3].w, t);
  const d = catmullRom(sections[i0].d, sections[i1].d, sections[i2].d, sections[i3].d, t);
  const bust = catmullRom(
    sections[i0].bust ?? 0, sections[i1].bust ?? 0,
    sections[i2].bust ?? 0, sections[i3].bust ?? 0, t,
  );
  const joint = t < 0.5 ? sections[i1].joint : sections[i2].joint;

  return { w: Math.max(w, 0.001), d: Math.max(d, 0.001), joint, bust: Math.max(bust, 0) };
}

// ══════════════════════════════════════════════════════════════
// SAMPLE TORSO — ~6000 particles
// ══════════════════════════════════════════════════════════════

const torsoYMin = sections[0].y;
const torsoYMax = sections[sections.length - 1].y;

for (let i = 0; i < 6000; i++) {
  const y = rand(torsoYMin, torsoYMax);
  const profile = evalTorsoAt(y);
  if (!profile) continue;

  const angle = rand(0, Math.PI * 2);
  let x = profile.w * Math.cos(angle);
  let z = profile.d * Math.sin(angle);

  // Bust: two soft hemispheres added to front of ribcage
  if (profile.bust > 0 && z > 0) {
    const bustSpacing = 0.045; // center-to-center ~0.09 apart
    for (const side of [-1, 1]) {
      const bx = side * bustSpacing;
      const distFromCenter = Math.sqrt((x - bx) ** 2);
      const bustRadius = 0.06;
      if (distFromCenter < bustRadius) {
        // Teardrop: fuller at bottom, tapers at top
        const falloff = 0.5 * (1 + Math.cos(Math.PI * distFromCenter / bustRadius));
        const frontFalloff = Math.cos(angle) > 0 ? Math.pow(Math.cos(angle), 0.6) : 0;
        z += profile.bust * falloff * frontFalloff;
      }
    }
  }

  addPoint(x, y, z, profile.joint, 0.38, COL.body);
}

// Extra bust surface density for contour
for (let i = 0; i < 800; i++) {
  const y = rand(0.46, 0.54);
  const profile = evalTorsoAt(y);
  if (!profile || profile.bust <= 0) continue;
  const bustSpacing = 0.045;
  const side = Math.random() < 0.5 ? -1 : 1;
  const bx = side * bustSpacing;
  const angle = rand(-0.8, 0.8); // front-facing
  const r = rand(0.02, 0.06);
  const x = bx + r * Math.sin(angle);
  const z = profile.d + profile.bust * rand(0.3, 1.0) * Math.cos(angle);
  addPoint(x, y, z, 'chest', 0.35, COL.body);
}

// Glute volume — subtle rear projection
for (let i = 0; i < 500; i++) {
  const y = rand(-0.02, 0.12);
  const profile = evalTorsoAt(Math.max(y, sections[0].y));
  if (!profile) continue;
  const angle = rand(Math.PI * 0.6, Math.PI * 1.4); // rear arc
  addPoint(
    profile.w * Math.cos(angle) * rand(0.95, 1.05), y,
    profile.d * Math.sin(angle) * rand(1.0, 1.12),
    'root', 0.38, COL.body,
  );
}

// ══════════════════════════════════════════════════════════════
// HIP-TO-LEG BIFURCATION ZONE
// Smooth transition from single torso ellipse to two leg tubes
// ══════════════════════════════════════════════════════════════

const bifurcTop = 0.04;
const bifurcBot = -0.10;
const legCenterX = 0.07;
const legRadiusW = 0.065;
const legRadiusD = 0.055;

for (let i = 0; i < 2500; i++) {
  const y = rand(bifurcBot, bifurcTop);
  const blend = (y - bifurcBot) / (bifurcTop - bifurcBot); // 0=legs, 1=torso

  const hipProfile = evalTorsoAt(Math.max(y, sections[0].y));
  const hipW = hipProfile ? hipProfile.w : 0.16;
  const hipD = hipProfile ? hipProfile.d : 0.12;
  const angle = rand(0, Math.PI * 2);

  if (blend > 0.85) {
    // Near torso: single ellipse with inner pinch
    const pinch = 1 - (1 - blend) * 3;
    let x = hipW * Math.cos(angle);
    const z = hipD * Math.sin(angle);
    if (Math.abs(x) < hipW * 0.3) x *= lerp(0.6, 1.0, pinch);
    addPoint(x, y, z, 'root', 0.38, COL.body);
  } else {
    // Transitioning to two legs
    const side = Math.random() < 0.5 ? -1 : 1;
    const cx = side * legCenterX;
    const mergedX = hipW * Math.cos(angle);
    const mergedZ = hipD * Math.sin(angle);
    const sepX = cx + legRadiusW * Math.cos(angle);
    const sepZ = legRadiusD * Math.sin(angle);
    const x = lerp(sepX, mergedX, blend / 0.85);
    const z = lerp(sepZ, mergedZ, blend / 0.85);
    const joint = side === -1 ? 'l_hip' : 'r_hip';
    addPoint(x, y, z, joint, 0.38, COL.body);
  }
}

// ══════════════════════════════════════════════════════════════
// LEGS — ~2500 per leg
// Upper thigh 0.10 radius → knee 0.06 → calf 0.055 → ankle 0.035
// ══════════════════════════════════════════════════════════════

type EllipseSection = { y: number; cx: number; rw: number; rd: number };

function sampleEllipticalLimb(secs: EllipseSection[], count: number, jointId: string): void {
  for (let i = 0; i < count; i++) {
    const yMin = secs[secs.length - 1].y;
    const yMax = secs[0].y;
    const y = rand(yMin, yMax);

    let idx = 0;
    for (let s = 0; s < secs.length - 1; s++) {
      if (y <= secs[s].y && y >= secs[s + 1].y) { idx = s; break; }
    }

    const segLen = secs[idx].y - secs[idx + 1].y;
    const t = segLen === 0 ? 0 : (secs[idx].y - y) / segLen;

    const i0 = Math.max(0, idx - 1);
    const i1 = idx;
    const i2 = Math.min(secs.length - 1, idx + 1);
    const i3 = Math.min(secs.length - 1, idx + 2);

    const cx = catmullRom(secs[i0].cx, secs[i1].cx, secs[i2].cx, secs[i3].cx, t);
    const rw = Math.max(catmullRom(secs[i0].rw, secs[i1].rw, secs[i2].rw, secs[i3].rw, t), 0.005);
    const rd = Math.max(catmullRom(secs[i0].rd, secs[i1].rd, secs[i2].rd, secs[i3].rd, t), 0.005);

    const angle = rand(0, Math.PI * 2);
    addPoint(cx + rw * Math.cos(angle), y, rd * Math.sin(angle), jointId, 0.38, COL.body);
  }
}

for (const [side, hipJoint, kneeJoint, footJoint] of [
  [-1, 'l_hip', 'l_knee', 'l_foot'],
  [1, 'r_hip', 'r_knee', 'r_foot'],
] as const) {
  const hipX = side * legCenterX;
  const kneeX = side * 0.105;
  const ankleX = side * 0.105;
  const kneeY = -0.44;
  const ankleY = -0.88;

  // Thigh: upper thigh (0.10 radius) tapers to knee (0.06)
  const thighSections: EllipseSection[] = [
    { y: bifurcBot,            cx: hipX,                       rw: legRadiusW,  rd: legRadiusD },
    { y: lerp(bifurcBot, kneeY, 0.15), cx: lerp(hipX, kneeX, 0.15), rw: 0.090, rd: 0.075 },
    { y: lerp(bifurcBot, kneeY, 0.35), cx: lerp(hipX, kneeX, 0.35), rw: 0.085, rd: 0.070 },
    { y: lerp(bifurcBot, kneeY, 0.60), cx: lerp(hipX, kneeX, 0.60), rw: 0.070, rd: 0.060 },
    { y: lerp(bifurcBot, kneeY, 0.85), cx: lerp(hipX, kneeX, 0.85), rw: 0.062, rd: 0.055 },
    { y: kneeY,                cx: kneeX,                      rw: 0.060, rd: 0.055 },
  ];
  sampleEllipticalLimb(thighSections, 2500, hipJoint);

  // Calf: knee → subtle calf bulge → ankle taper
  const calfSections: EllipseSection[] = [
    { y: kneeY,                    cx: kneeX,  rw: 0.060, rd: 0.055 },
    { y: lerp(kneeY, ankleY, 0.20), cx: kneeX,  rw: 0.055, rd: 0.050 },
    { y: lerp(kneeY, ankleY, 0.35), cx: kneeX,  rw: 0.055, rd: 0.053 }, // calf peak
    { y: lerp(kneeY, ankleY, 0.55), cx: kneeX,  rw: 0.045, rd: 0.042 },
    { y: lerp(kneeY, ankleY, 0.80), cx: ankleX, rw: 0.038, rd: 0.035 },
    { y: ankleY + 0.04,            cx: ankleX, rw: 0.035, rd: 0.032 },
  ];
  sampleEllipticalLimb(calfSections, 2000, kneeJoint);

  // Feet
  const fx = side * 0.105;
  const fy = ankleY;
  // Ankle ball
  ellipsoid(fx, fy, 0, 0.035, 0.025, 0.035, 120, footJoint, 0.35, COL.body);
  // Foot body — elongated forward
  ellipsoid(fx, fy - 0.03, 0.04, 0.035, 0.018, 0.065, 200, footJoint, 0.35, COL.body);
  // Heel
  ellipsoid(fx, fy - 0.02, -0.025, 0.025, 0.018, 0.025, 60, footJoint, 0.3, COL.dim);
  // Toes (simplified)
  for (let t = 0; t < 5; t++) {
    const tx = fx - 0.018 + t * 0.009;
    const toeSize = t === 0 ? 0.010 : 0.007;
    ellipsoid(tx, fy - 0.035, 0.10 - Math.abs(t - 1) * 0.005, toeSize, toeSize, toeSize, 8, footJoint, 0.22, COL.highlight);
  }
}

// ══════════════════════════════════════════════════════════════
// SHOULDER CAPS — bridge torso edge to arm tops
// ══════════════════════════════════════════════════════════════
for (const sx of [-1, 1]) {
  const shX = sx * 0.22;
  const shJoint = sx === -1 ? 'l_shoulder' : 'r_shoulder';
  // Rounded shoulder cap
  ellipsoid(shX, 0.64, 0, 0.055, 0.035, 0.045, 400, shJoint, 0.38, COL.body);
}

// ══════════════════════════════════════════════════════════════
// ARMS — ~1200 per arm
// Shoulder Y=0.64, elbow Y=0.40, wrist Y=0.18
// Spec: upper arm 0.05 radius, elbow 0.04, forearm 0.04, wrist 0.03
// ══════════════════════════════════════════════════════════════

for (const [side, shJoint, elJoint, haJoint] of [
  [-1, 'l_shoulder', 'l_elbow', 'l_hand'],
  [1, 'r_shoulder', 'r_elbow', 'r_hand'],
] as const) {
  const shoulderX = side * 0.22;
  const shoulderY = 0.64;
  const elbowX = side * 0.22;
  const elbowY = 0.40;
  const wristX = side * 0.22;
  const wristY = 0.18;

  // Upper arm
  const upperArmSecs: EllipseSection[] = [
    { y: shoulderY, cx: shoulderX, rw: 0.050, rd: 0.045 },
    { y: lerp(shoulderY, elbowY, 0.3), cx: lerp(shoulderX, elbowX, 0.3), rw: 0.044, rd: 0.040 },
    { y: lerp(shoulderY, elbowY, 0.7), cx: lerp(shoulderX, elbowX, 0.7), rw: 0.040, rd: 0.036 },
    { y: elbowY, cx: elbowX, rw: 0.040, rd: 0.035 },
  ];
  sampleEllipticalLimb(upperArmSecs, 1200, shJoint);

  // Forearm
  const forearmSecs: EllipseSection[] = [
    { y: elbowY, cx: elbowX, rw: 0.040, rd: 0.035 },
    { y: lerp(elbowY, wristY, 0.3), cx: lerp(elbowX, wristX, 0.3), rw: 0.036, rd: 0.032 },
    { y: lerp(elbowY, wristY, 0.7), cx: lerp(elbowX, wristX, 0.7), rw: 0.032, rd: 0.028 },
    { y: wristY, cx: wristX, rw: 0.030, rd: 0.025 },
  ];
  sampleEllipticalLimb(forearmSecs, 1000, elJoint);

  // Hand — simplified palm + fingers
  const hx = wristX;
  const hy = wristY;
  // Palm
  ellipsoid(hx, hy - 0.03, 0, 0.028, 0.035, 0.012, 150, haJoint, 0.3, COL.body);
  // Fingers (5 simplified tubes)
  const fingers = [
    { dx: -0.018, len: 0.04 },  // thumb (shorter, offset)
    { dx: -0.008, len: 0.05 },
    { dx: 0.002, len: 0.055 },  // middle (longest)
    { dx: 0.012, len: 0.048 },
    { dx: 0.022, len: 0.035 },  // pinky
  ];
  for (const f of fingers) {
    for (let fi = 0; fi < 12; fi++) {
      const ft = rand(0, 1);
      const fr = 0.006 * (1 - ft * 0.4);
      const fa = rand(0, Math.PI * 2);
      addPoint(
        hx + f.dx * side + fr * Math.cos(fa),
        hy - 0.06 - ft * f.len,
        fr * Math.sin(fa),
        haJoint, 0.22, COL.highlight,
      );
    }
    // Fingertip
    addPoint(hx + f.dx * side, hy - 0.06 - f.len, 0, haJoint, 0.25, COL.bright);
  }
}

// ══════════════════════════════════════════════════════════════
// NECK-TO-HEAD CONNECTOR
// Fills gap from upper neck (Y=0.75) to skull bottom (~Y=0.80)
// ══════════════════════════════════════════════════════════════
const neckConnectorSecs: EllipseSection[] = [
  { y: 0.75, cx: 0, rw: 0.050, rd: 0.050 },
  { y: 0.78, cx: 0, rw: 0.048, rd: 0.050 },
  { y: 0.80, cx: 0, rw: 0.055, rd: 0.055 },
  { y: 0.82, cx: 0, rw: 0.065, rd: 0.070 },
];
sampleEllipticalLimb(neckConnectorSecs, 500, 'head');

// ══════════════════════════════════════════════════════════════
// HEAD — ~3000 particles for facial expression capability
// Head center at Y=0.90 (joint at 0.84 + offset)
// Spec: head width 0.17 (r=0.085), depth 0.19 (r=0.095)
// ══════════════════════════════════════════════════════════════
const headCY = 0.92;  // center of head
const headW = 0.085;  // half-width
const headD = 0.095;  // half-depth (front-to-back)
const headH = 0.08;   // half-height

// Skull (back and top)
ellipsoid(0, headCY, 0, headW, headH, headD, 1500, 'head', 0.38, COL.body, -Math.PI / 2, Math.PI / 5);
// Face surface (front, flatter)
ellipsoid(0, headCY - 0.01, headD * 0.55, headW * 0.85, headH * 0.80, headD * 0.3, 1000, 'head', 0.32, COL.highlight, -Math.PI / 3, Math.PI / 4);

// Jawline contour
for (let i = 0; i < 100; i++) {
  const t = rand(-1, 1);
  const a = t * Math.PI * 0.45;
  addPoint(
    headW * 0.95 * Math.sin(a),
    headCY - headH * 0.70 + Math.abs(t) * headH * 0.2,
    headD * 0.65 * Math.cos(a),
    'head', 0.3, COL.contour,
  );
}

// Cheekbones
for (const side of [-1, 1]) {
  ellipsoid(side * headW * 0.70, headCY + headH * 0.05, headD * 0.50, 0.016, 0.010, 0.010, 40, 'head', 0.3, COL.highlight);
}

// Eyes (ratio 0.93 → Y=0.86)
const eyeY = 0.86;
const eyeSpacing = headW * 0.45;
const eyeZ = headD * 0.85;
for (const side of [-1, 1]) {
  // Eye shape (wider than tall)
  ellipsoid(side * eyeSpacing, eyeY, eyeZ, 0.018, 0.008, 0.004, 25, 'head', 0.45, COL.eyeGlow);
  // Pupil/iris highlight
  ellipsoid(side * eyeSpacing, eyeY, eyeZ + 0.003, 0.007, 0.004, 0.003, 12, 'head', 0.6, COL.eye);
}

// Eyebrows
for (const side of [-1, 1]) {
  for (let i = 0; i < 20; i++) {
    const t = rand(-1, 1);
    addPoint(side * eyeSpacing + t * 0.020, eyeY + 0.014 + (1 - t * t) * 0.004, eyeZ - 0.003, 'head', 0.25, COL.contour);
  }
}

// Nose (tip at ratio 0.91 → Y=0.82)
const noseTopY = eyeY - 0.005;
const noseTipY = 0.82;
for (let i = 0; i < 30; i++) {
  const t = rand(0, 1);
  addPoint(
    rand(-0.004 - t * 0.006, 0.004 + t * 0.006),
    lerp(noseTopY, noseTipY, t),
    eyeZ + t * 0.015,
    'head', 0.28, COL.highlight,
  );
}
// Nose tip
ellipsoid(0, noseTipY, eyeZ + 0.013, 0.010, 0.006, 0.006, 15, 'head', 0.3, COL.highlight);

// Lips (ratio 0.895 → Y=0.79)
const mouthY = 0.79;
const lipW = eyeSpacing * 0.9;
for (let i = 0; i < 50; i++) {
  const t = rand(-1, 1);
  // Upper lip
  addPoint(t * lipW, mouthY + 0.004 + (1 - t * t) * 0.003, eyeZ - 0.002, 'head', 0.3, COL.lip);
  // Lower lip (slightly fuller)
  addPoint(t * lipW * 0.9, mouthY - 0.004 - (1 - t * t) * 0.003, eyeZ - 0.003, 'head', 0.3, COL.lip);
}

// Chin (ratio 0.875 → Y=0.75)
ellipsoid(0, 0.76, headD * 0.45, 0.022, 0.016, 0.016, 40, 'head', 0.35, COL.body);

// Ears
for (const side of [-1, 1]) {
  ellipsoid(side * headW * 0.95, headCY, 0, 0.009, 0.020, 0.009, 30, 'head', 0.25, COL.dim);
}

// ══════════════════════════════════════════════════════════════
// OUTPUT
// ══════════════════════════════════════════════════════════════

const useDebugColors = process.argv.includes('--debug-colors');

const cleaned = points.map((p) => ({
  joint_id: p.joint_id,
  offset: [
    Math.round(p.offset[0] * 10000) / 10000,
    Math.round(p.offset[1] * 10000) / 10000,
    Math.round(p.offset[2] * 10000) / 10000,
  ] as [number, number, number],
  size: Math.round(p.size * 100) / 100,
  color: useDebugColors ? debugColor(p.joint_id) : p.color,
}));

const byJoint: Record<string, number> = {};
cleaned.forEach((p) => { byJoint[p.joint_id] = (byJoint[p.joint_id] || 0) + 1; });

console.log(`Total points: ${cleaned.length}`);
console.log('By joint:');
Object.entries(byJoint).sort((a, b) => b[1] - a[1]).forEach(([j, c]) => console.log(`  ${j}: ${c}`));

const fs = require('fs');
fs.writeFileSync('scripts/hologram_body.json', JSON.stringify(cleaned, null, 0));
console.log(`\nWritten to scripts/hologram_body.json`);
console.log(`JSON size: ${(JSON.stringify(cleaned).length / 1024).toFixed(1)} KB`);
