/**
 * Generate a realistic feminine humanoid point cloud for the hologram avatar.
 * Slim/athletic build with proper waist-to-hip ratio and compressed torso.
 *
 * Total height: ~1.7 units visual. Root (crotch) at Y=0.
 * Feet at ~Y=-0.88, head top at ~Y=0.82
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
// Compressed torso, narrower shoulders/hips vs previous version.
// DB skeleton stores RELATIVE offsets; these are the resolved absolutes.
//
// DB skeleton (relative offsets from parent):
//   root:       [0, 0, 0]         (absolute)
//   spine:      [0, 0.20, 0]      → [0, 0.20, 0]
//   chest:      [0, 0.20, 0]      → [0, 0.40, 0]
//   neck:       [0, 0.13, 0]      → [0, 0.53, 0]
//   head:       [0, 0.13, 0]      → [0, 0.66, 0]
//   l_shoulder: [-0.17, 0.10, 0]  → [-0.17, 0.50, 0]
//   l_elbow:    [0, -0.20, 0]     → [-0.17, 0.30, 0]
//   l_hand:     [0, -0.20, 0]     → [-0.17, 0.10, 0]
//   l_hip:      [-0.08, 0, 0]     → [-0.08, 0, 0]
//   l_knee:     [0, -0.44, 0]     → [-0.08, -0.44, 0]
//   l_foot:     [0, -0.44, 0]     → [-0.08, -0.88, 0]
// ══════════════════════════════════════════════════════════════

const JOINTS: Record<string, [number, number, number]> = {
  root:       [0, 0, 0],
  spine:      [0, 0.20, 0],
  chest:      [0, 0.40, 0],
  neck:       [0, 0.53, 0],
  head:       [0, 0.66, 0],
  l_shoulder: [-0.17, 0.50, 0],
  r_shoulder: [0.17, 0.50, 0],
  l_elbow:    [-0.17, 0.30, 0],
  r_elbow:    [0.17, 0.30, 0],
  l_hand:     [-0.17, 0.10, 0],
  r_hand:     [0.17, 0.10, 0],
  l_hip:      [-0.08, 0, 0],
  r_hip:      [0.08, 0, 0],
  l_knee:     [-0.08, -0.44, 0],
  r_knee:     [0.08, -0.44, 0],
  l_foot:     [-0.08, -0.88, 0],
  r_foot:     [0.08, -0.88, 0],
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

function jointForY(y: number): string {
  if (y > 0.60) return 'head';
  if (y > 0.50) return 'neck';
  if (y > 0.30) return 'chest';
  if (y > 0.10) return 'spine';
  return 'root';
}

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
// TORSO CROSS-SECTIONS — Slim feminine build
//
// Much narrower than previous version. Strong waist taper.
// Half-widths (radii):
//   Neck:     ~0.040        Shoulder: 0.17
//   Ribcage:  0.13          Bust:     0.15
//   Waist:    0.095         Hip:      0.155
// ══════════════════════════════════════════════════════════════

type Section = {
  y: number;
  w: number;
  d: number;
  joint: string;
  bust?: number;
};

const sections: Section[] = [
  // Crotch
  { y: 0.00,  w: 0.10,  d: 0.085, joint: 'root' },
  // Lower pelvis
  { y: 0.05,  w: 0.13,  d: 0.095, joint: 'root' },
  // Hip bone — widest lower body
  { y: 0.12,  w: 0.155, d: 0.11,  joint: 'root' },
  // Above hips — start narrowing
  { y: 0.17,  w: 0.135, d: 0.10,  joint: 'spine' },
  // Navel
  { y: 0.20,  w: 0.115, d: 0.09,  joint: 'spine' },
  // Natural waist — narrowest
  { y: 0.25,  w: 0.095, d: 0.08,  joint: 'spine' },
  // Above waist
  { y: 0.29,  w: 0.105, d: 0.085, joint: 'spine' },
  // Under-bust / ribcage
  { y: 0.33,  w: 0.13,  d: 0.09,  joint: 'chest' },
  // Bust line
  { y: 0.38,  w: 0.15,  d: 0.10,  joint: 'chest', bust: 0.04 },
  // Above bust
  { y: 0.41,  w: 0.14,  d: 0.09,  joint: 'chest', bust: 0.012 },
  // Armpit
  { y: 0.43,  w: 0.135, d: 0.08,  joint: 'chest' },
  // Upper chest
  { y: 0.46,  w: 0.15,  d: 0.075, joint: 'chest' },
  // Shoulder line — wide, shallow
  { y: 0.50,  w: 0.17,  d: 0.07,  joint: 'chest' },
  // Neck base
  { y: 0.53,  w: 0.07,  d: 0.05,  joint: 'neck' },
  // Mid neck
  { y: 0.56,  w: 0.040, d: 0.040, joint: 'neck' },
  // Upper neck
  { y: 0.59,  w: 0.036, d: 0.036, joint: 'neck' },
];

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
// SAMPLE TORSO — ~5000 particles
// ══════════════════════════════════════════════════════════════

const torsoYMin = sections[0].y;
const torsoYMax = sections[sections.length - 1].y;

for (let i = 0; i < 5000; i++) {
  const y = rand(torsoYMin, torsoYMax);
  const profile = evalTorsoAt(y);
  if (!profile) continue;

  const angle = rand(0, Math.PI * 2);
  let x = profile.w * Math.cos(angle);
  let z = profile.d * Math.sin(angle);

  // Bust hemispheres
  if (profile.bust > 0 && z > 0) {
    const bustSpacing = 0.04;
    for (const side of [-1, 1]) {
      const bx = side * bustSpacing;
      const distFromCenter = Math.abs(x - bx);
      const bustRadius = 0.05;
      if (distFromCenter < bustRadius) {
        const falloff = 0.5 * (1 + Math.cos(Math.PI * distFromCenter / bustRadius));
        const frontFalloff = Math.cos(angle) > 0 ? Math.pow(Math.cos(angle), 0.6) : 0;
        z += profile.bust * falloff * frontFalloff;
      }
    }
  }

  addPoint(x, y, z, profile.joint, 0.38, COL.body);
}

// Extra bust surface density
for (let i = 0; i < 600; i++) {
  const y = rand(0.35, 0.41);
  const profile = evalTorsoAt(y);
  if (!profile || profile.bust <= 0) continue;
  const bustSpacing = 0.04;
  const side = Math.random() < 0.5 ? -1 : 1;
  const bx = side * bustSpacing;
  const angle = rand(-0.8, 0.8);
  const r = rand(0.015, 0.05);
  const x = bx + r * Math.sin(angle);
  const z = profile.d + profile.bust * rand(0.3, 1.0) * Math.cos(angle);
  addPoint(x, y, z, 'chest', 0.35, COL.body);
}

// Glute volume
for (let i = 0; i < 400; i++) {
  const y = rand(-0.02, 0.10);
  const profile = evalTorsoAt(Math.max(y, sections[0].y));
  if (!profile) continue;
  const angle = rand(Math.PI * 0.6, Math.PI * 1.4);
  addPoint(
    profile.w * Math.cos(angle) * rand(0.95, 1.05), y,
    profile.d * Math.sin(angle) * rand(1.0, 1.10),
    'root', 0.38, COL.body,
  );
}

// ══════════════════════════════════════════════════════════════
// HIP-TO-LEG BIFURCATION ZONE
// ══════════════════════════════════════════════════════════════

const bifurcTop = 0.04;
const bifurcBot = -0.08;
const legCenterX = 0.055;
const legRadiusW = 0.050;
const legRadiusD = 0.045;

for (let i = 0; i < 2000; i++) {
  const y = rand(bifurcBot, bifurcTop);
  const blend = (y - bifurcBot) / (bifurcTop - bifurcBot);

  const hipProfile = evalTorsoAt(Math.max(y, sections[0].y));
  const hipW = hipProfile ? hipProfile.w : 0.10;
  const hipD = hipProfile ? hipProfile.d : 0.085;
  const angle = rand(0, Math.PI * 2);

  if (blend > 0.85) {
    const pinch = 1 - (1 - blend) * 3;
    let x = hipW * Math.cos(angle);
    const z = hipD * Math.sin(angle);
    if (Math.abs(x) < hipW * 0.3) x *= lerp(0.6, 1.0, pinch);
    addPoint(x, y, z, 'root', 0.38, COL.body);
  } else {
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
// LEGS — slimmer proportions
// Upper thigh 0.065 → knee 0.045 → calf 0.042 → ankle 0.028
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
  const kneeX = side * 0.08;
  const ankleX = side * 0.08;
  const kneeY = -0.44;
  const ankleY = -0.88;

  // Thigh
  const thighSections: EllipseSection[] = [
    { y: bifurcBot,                          cx: hipX,                       rw: legRadiusW,  rd: legRadiusD },
    { y: lerp(bifurcBot, kneeY, 0.15), cx: lerp(hipX, kneeX, 0.15), rw: 0.065, rd: 0.055 },
    { y: lerp(bifurcBot, kneeY, 0.35), cx: lerp(hipX, kneeX, 0.35), rw: 0.060, rd: 0.050 },
    { y: lerp(bifurcBot, kneeY, 0.60), cx: lerp(hipX, kneeX, 0.60), rw: 0.050, rd: 0.045 },
    { y: lerp(bifurcBot, kneeY, 0.85), cx: lerp(hipX, kneeX, 0.85), rw: 0.047, rd: 0.042 },
    { y: kneeY,                              cx: kneeX,                      rw: 0.045, rd: 0.042 },
  ];
  sampleEllipticalLimb(thighSections, 2200, hipJoint);

  // Calf
  const calfSections: EllipseSection[] = [
    { y: kneeY,                          cx: kneeX,  rw: 0.045, rd: 0.042 },
    { y: lerp(kneeY, ankleY, 0.20), cx: kneeX,  rw: 0.042, rd: 0.038 },
    { y: lerp(kneeY, ankleY, 0.35), cx: kneeX,  rw: 0.042, rd: 0.040 }, // calf peak
    { y: lerp(kneeY, ankleY, 0.55), cx: kneeX,  rw: 0.035, rd: 0.032 },
    { y: lerp(kneeY, ankleY, 0.80), cx: ankleX, rw: 0.030, rd: 0.027 },
    { y: ankleY + 0.04,                 cx: ankleX, rw: 0.028, rd: 0.025 },
  ];
  sampleEllipticalLimb(calfSections, 1800, kneeJoint);

  // Feet
  const fx = side * 0.08;
  const fy = ankleY;
  ellipsoid(fx, fy, 0, 0.028, 0.020, 0.028, 100, footJoint, 0.35, COL.body);
  ellipsoid(fx, fy - 0.025, 0.035, 0.028, 0.015, 0.055, 160, footJoint, 0.35, COL.body);
  ellipsoid(fx, fy - 0.015, -0.020, 0.020, 0.015, 0.020, 50, footJoint, 0.3, COL.dim);
  for (let t = 0; t < 5; t++) {
    const tx = fx - 0.014 + t * 0.007;
    const toeSize = t === 0 ? 0.008 : 0.006;
    ellipsoid(tx, fy - 0.030, 0.085 - Math.abs(t - 1) * 0.004, toeSize, toeSize, toeSize, 8, footJoint, 0.22, COL.highlight);
  }
}

// ══════════════════════════════════════════════════════════════
// SHOULDER CAPS
// ══════════════════════════════════════════════════════════════
for (const sx of [-1, 1]) {
  const shX = sx * 0.17;
  const shJoint = sx === -1 ? 'l_shoulder' : 'r_shoulder';
  ellipsoid(shX, 0.50, 0, 0.042, 0.028, 0.035, 300, shJoint, 0.38, COL.body);
}

// ══════════════════════════════════════════════════════════════
// ARMS — slimmer
// Shoulder Y=0.50, elbow Y=0.30, wrist Y=0.10
// ══════════════════════════════════════════════════════════════

for (const [side, shJoint, elJoint, haJoint] of [
  [-1, 'l_shoulder', 'l_elbow', 'l_hand'],
  [1, 'r_shoulder', 'r_elbow', 'r_hand'],
] as const) {
  const shoulderX = side * 0.17;
  const shoulderY = 0.50;
  const elbowX = side * 0.17;
  const elbowY = 0.30;
  const wristX = side * 0.17;
  const wristY = 0.10;

  const upperArmSecs: EllipseSection[] = [
    { y: shoulderY, cx: shoulderX, rw: 0.038, rd: 0.034 },
    { y: lerp(shoulderY, elbowY, 0.3), cx: lerp(shoulderX, elbowX, 0.3), rw: 0.034, rd: 0.030 },
    { y: lerp(shoulderY, elbowY, 0.7), cx: lerp(shoulderX, elbowX, 0.7), rw: 0.031, rd: 0.028 },
    { y: elbowY, cx: elbowX, rw: 0.032, rd: 0.028 },
  ];
  sampleEllipticalLimb(upperArmSecs, 1000, shJoint);

  const forearmSecs: EllipseSection[] = [
    { y: elbowY, cx: elbowX, rw: 0.032, rd: 0.028 },
    { y: lerp(elbowY, wristY, 0.3), cx: lerp(elbowX, wristX, 0.3), rw: 0.028, rd: 0.025 },
    { y: lerp(elbowY, wristY, 0.7), cx: lerp(elbowX, wristX, 0.7), rw: 0.025, rd: 0.022 },
    { y: wristY, cx: wristX, rw: 0.024, rd: 0.020 },
  ];
  sampleEllipticalLimb(forearmSecs, 800, elJoint);

  // Hand
  const hx = wristX;
  const hy = wristY;
  ellipsoid(hx, hy - 0.025, 0, 0.022, 0.030, 0.010, 120, haJoint, 0.3, COL.body);
  const fingers = [
    { dx: -0.014, len: 0.035 },
    { dx: -0.006, len: 0.042 },
    { dx: 0.002, len: 0.046 },
    { dx: 0.010, len: 0.040 },
    { dx: 0.018, len: 0.030 },
  ];
  for (const f of fingers) {
    for (let fi = 0; fi < 10; fi++) {
      const ft = rand(0, 1);
      const fr = 0.005 * (1 - ft * 0.4);
      const fa = rand(0, Math.PI * 2);
      addPoint(
        hx + f.dx * side + fr * Math.cos(fa),
        hy - 0.05 - ft * f.len,
        fr * Math.sin(fa),
        haJoint, 0.22, COL.highlight,
      );
    }
    addPoint(hx + f.dx * side, hy - 0.05 - f.len, 0, haJoint, 0.25, COL.bright);
  }
}

// ══════════════════════════════════════════════════════════════
// NECK-TO-HEAD CONNECTOR
// ══════════════════════════════════════════════════════════════
const neckConnectorSecs: EllipseSection[] = [
  { y: 0.59, cx: 0, rw: 0.036, rd: 0.036 },
  { y: 0.62, cx: 0, rw: 0.038, rd: 0.040 },
  { y: 0.65, cx: 0, rw: 0.050, rd: 0.055 },
];
sampleEllipticalLimb(neckConnectorSecs, 400, 'head');

// ══════════════════════════════════════════════════════════════
// HEAD — ~3000 particles
// Head center at Y=0.74 (joint at 0.66 + offset 0.08)
// ══════════════════════════════════════════════════════════════
const headCY = 0.74;
const headW = 0.075;
const headD = 0.085;
const headH = 0.075;

// Skull
ellipsoid(0, headCY, 0, headW, headH, headD, 1500, 'head', 0.38, COL.body, -Math.PI / 2, Math.PI / 5);
// Face surface
ellipsoid(0, headCY - 0.01, headD * 0.55, headW * 0.85, headH * 0.80, headD * 0.3, 1000, 'head', 0.32, COL.highlight, -Math.PI / 3, Math.PI / 4);

// Jawline
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
  ellipsoid(side * headW * 0.70, headCY + headH * 0.05, headD * 0.50, 0.014, 0.009, 0.009, 40, 'head', 0.3, COL.highlight);
}

// Eyes
const eyeY = headCY - headH * 0.15;
const eyeSpacing = headW * 0.45;
const eyeZ = headD * 0.85;
for (const side of [-1, 1]) {
  ellipsoid(side * eyeSpacing, eyeY, eyeZ, 0.016, 0.007, 0.004, 25, 'head', 0.45, COL.eyeGlow);
  ellipsoid(side * eyeSpacing, eyeY, eyeZ + 0.003, 0.006, 0.004, 0.003, 12, 'head', 0.6, COL.eye);
}

// Eyebrows
for (const side of [-1, 1]) {
  for (let i = 0; i < 20; i++) {
    const t = rand(-1, 1);
    addPoint(side * eyeSpacing + t * 0.018, eyeY + 0.013 + (1 - t * t) * 0.004, eyeZ - 0.003, 'head', 0.25, COL.contour);
  }
}

// Nose
const noseTopY = eyeY - 0.005;
const noseTipY = headCY - headH * 0.55;
for (let i = 0; i < 30; i++) {
  const t = rand(0, 1);
  addPoint(
    rand(-0.003 - t * 0.005, 0.003 + t * 0.005),
    lerp(noseTopY, noseTipY, t),
    eyeZ + t * 0.013,
    'head', 0.28, COL.highlight,
  );
}
ellipsoid(0, noseTipY, eyeZ + 0.011, 0.009, 0.005, 0.005, 15, 'head', 0.3, COL.highlight);

// Lips
const mouthY = headCY - headH * 0.65;
const lipW = eyeSpacing * 0.9;
for (let i = 0; i < 50; i++) {
  const t = rand(-1, 1);
  addPoint(t * lipW, mouthY + 0.004 + (1 - t * t) * 0.003, eyeZ - 0.002, 'head', 0.3, COL.lip);
  addPoint(t * lipW * 0.9, mouthY - 0.004 - (1 - t * t) * 0.003, eyeZ - 0.003, 'head', 0.3, COL.lip);
}

// Chin
ellipsoid(0, headCY - headH * 0.85, headD * 0.45, 0.018, 0.014, 0.014, 40, 'head', 0.35, COL.body);

// Ears
for (const side of [-1, 1]) {
  ellipsoid(side * headW * 0.95, headCY, 0, 0.008, 0.018, 0.008, 30, 'head', 0.25, COL.dim);
}

// ══════════════════════════════════════════════════════════════
// HAIR — bob-cut style, adds volume to top/sides/back of head
// ══════════════════════════════════════════════════════════════

// Top of head hair volume
ellipsoid(0, headCY + headH * 0.6, 0, headW * 1.15, headH * 0.45, headD * 1.05, 600, 'head', 0.32, COL.dim);
// Side hair
for (const side of [-1, 1]) {
  ellipsoid(side * headW * 0.85, headCY - headH * 0.1, 0, headW * 0.35, headH * 0.7, headD * 0.6, 200, 'head', 0.30, COL.dim);
}
// Back hair — extends down to neck
ellipsoid(0, headCY - headH * 0.3, -headD * 0.4, headW * 0.9, headH * 0.8, headD * 0.5, 300, 'head', 0.28, COL.dim);

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
