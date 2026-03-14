/**
 * Generate a realistic feminine humanoid point cloud for the hologram avatar.
 * Uses Catmull-Rom spline interpolation across cross-sections for a smooth,
 * continuous surface. Includes hip-to-leg bifurcation zone and small random
 * displacement for organic feel.
 *
 * IMPORTANT: Joint world positions MUST match the DB skeleton resolved via FK.
 * The DB skeleton stores relative offsets from parent joints. The world positions
 * below are computed by resolving that parent chain.
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

// Body width scale factor (controls overall body thickness)
const S = 0.7;

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

// ══════════════════════════════════════════════════════════════
// JOINT WORLD POSITIONS — resolved from DB skeleton via FK
// DB skeleton: root is absolute, all others are relative to parent.
//
// root:       [0, 0, 0]       (absolute)
// spine:      root + [0, 0.3, 0]        = [0, 0.3, 0]
// chest:      spine + [0, 0.25, 0]      = [0, 0.55, 0]
// neck:       chest + [0, 0.15, 0]      = [0, 0.7, 0]
// head:       neck + [0, 0.15, 0]       = [0, 0.85, 0]
// l_shoulder: chest + [-0.15, 0, 0]     = [-0.15, 0.55, 0]
// l_elbow:    l_shoulder + [0, -0.2, 0] = [-0.15, 0.35, 0]
// l_hand:     l_elbow + [0, -0.18, 0]   = [-0.15, 0.17, 0]
// l_hip:      root + [-0.1, 0, 0]       = [-0.1, 0, 0]
// l_knee:     l_hip + [0, -0.35, 0]     = [-0.1, -0.35, 0]
// l_foot:     l_knee + [0, -0.35, 0]    = [-0.1, -0.7, 0]
// ══════════════════════════════════════════════════════════════

const JOINTS: Record<string, [number, number, number]> = {
  root: [0, 0, 0],
  spine: [0, 0.3, 0],
  chest: [0, 0.55, 0],
  neck: [0, 0.7, 0],
  head: [0, 0.85, 0],
  l_shoulder: [-0.15, 0.55, 0],
  r_shoulder: [0.15, 0.55, 0],
  l_elbow: [-0.15, 0.35, 0],
  r_elbow: [0.15, 0.35, 0],
  l_hand: [-0.15, 0.17, 0],
  r_hand: [0.15, 0.17, 0],
  l_hip: [-0.1, 0, 0],
  r_hip: [0.1, 0, 0],
  l_knee: [-0.1, -0.35, 0],
  r_knee: [0.1, -0.35, 0],
  l_foot: [-0.1, -0.7, 0],
  r_foot: [0.1, -0.7, 0],
};

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Catmull-Rom spline interpolation */
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

/** Add a point at world pos, converting to joint-relative offset with small random displacement */
function addPoint(worldX: number, worldY: number, worldZ: number, jointId: string, size: number, color: string): void {
  const j = JOINTS[jointId];
  const disp = 0.004;
  points.push({
    joint_id: jointId,
    offset: [
      worldX - j[0] + rand(-disp, disp),
      worldY - j[1] + rand(-disp, disp),
      worldZ - j[2] + rand(-disp, disp),
    ],
    size: size * rand(0.85, 1.15),
    color,
  });
}

/** Sample surface of ellipsoid */
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
// CROSS-SECTION DEFINITIONS — Torso
// All Y values are absolute world coordinates matching the skeleton.
// Figure spans from Y=-0.7 (feet) to Y=0.93 (top of head).
// Root/hips at Y=0, chest at Y=0.55, neck at Y=0.7, head at Y=0.85.
// ══════════════════════════════════════════════════════════════

type Section = {
  y: number;
  w: number;  // half-width (X radius)
  d: number;  // half-depth (Z radius)
  joint: string;
  bust?: number;
};

const sections: Section[] = [
  // Crotch / leg divide
  { y: -0.02, w: 0.105 * S, d: 0.075 * S, joint: 'root' },
  // Lower hip
  { y: 0.02, w: 0.108 * S, d: 0.078 * S, joint: 'root' },
  // Hip bone (widest)
  { y: 0.06, w: 0.110 * S, d: 0.080 * S, joint: 'root' },
  // Above hips — start narrowing
  { y: 0.12, w: 0.095 * S, d: 0.070 * S, joint: 'root' },
  // Navel
  { y: 0.18, w: 0.085 * S, d: 0.065 * S, joint: 'spine' },
  // Natural waist (narrowest — exaggerated for feminine silhouette)
  { y: 0.25, w: 0.062 * S, d: 0.052 * S, joint: 'spine' },
  // Above waist
  { y: 0.33, w: 0.075 * S, d: 0.058 * S, joint: 'chest' },
  // Under-bust / ribcage
  { y: 0.38, w: 0.085 * S, d: 0.062 * S, joint: 'chest' },
  // Bust line
  { y: 0.45, w: 0.100 * S, d: 0.072 * S, joint: 'chest', bust: 0.025 * S },
  // Above bust
  { y: 0.50, w: 0.095 * S, d: 0.065 * S, joint: 'chest', bust: 0.008 * S },
  // Armpit / upper chest
  { y: 0.52, w: 0.095 * S, d: 0.060 * S, joint: 'chest' },
  // Shoulder line (matches chest joint Y=0.55)
  { y: 0.55, w: 0.110 * S, d: 0.055 * S, joint: 'chest' },
  // Neck base / collarbone
  { y: 0.60, w: 0.060 * S, d: 0.040 * S, joint: 'neck' },
  // Mid neck
  { y: 0.65, w: 0.028 * S, d: 0.028 * S, joint: 'neck' },
  // Upper neck
  { y: 0.68, w: 0.025 * S, d: 0.025 * S, joint: 'neck' },
];

/** Evaluate the torso profile at any Y using Catmull-Rom */
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
// SAMPLE TORSO — uniform random Y, spline-interpolated ellipse
// ══════════════════════════════════════════════════════════════

const torsoYMin = sections[0].y;
const torsoYMax = sections[sections.length - 1].y;

for (let i = 0; i < 10000; i++) {
  const y = rand(torsoYMin, torsoYMax);
  const profile = evalTorsoAt(y);
  if (!profile) continue;

  const angle = rand(0, Math.PI * 2);
  let x = profile.w * Math.cos(angle);
  let z = profile.d * Math.sin(angle);

  // Bust: cosine falloff forward projection
  if (profile.bust > 0 && z > 0) {
    const bustSpacing = 0.035 * S;
    for (const side of [-1, 1]) {
      const bx = side * bustSpacing;
      const distFromCenter = Math.abs(x - bx);
      const bustW = 0.035 * S;
      if (distFromCenter < bustW) {
        const falloff = 0.5 * (1 + Math.cos(Math.PI * distFromCenter / bustW));
        const frontFalloff = Math.cos(angle) > 0 ? Math.pow(Math.cos(angle), 0.5) : 0;
        z += profile.bust * falloff * frontFalloff;
      }
    }
  }

  addPoint(x, y, z, profile.joint, 0.38, COL.body);
}

// Glute volume
for (let i = 0; i < 600; i++) {
  const y = rand(-0.02, 0.05);
  const profile = evalTorsoAt(Math.max(y, sections[0].y));
  if (!profile) continue;
  const angle = rand(Math.PI * 0.6, Math.PI * 1.4);
  addPoint(
    profile.w * Math.cos(angle) * rand(0.95, 1.05), y,
    profile.d * Math.sin(angle) * rand(1.0, 1.15),
    'root', 0.38, COL.body,
  );
}

// ══════════════════════════════════════════════════════════════
// HIP-TO-LEG BIFURCATION ZONE
// ══════════════════════════════════════════════════════════════

const bifurcTop = 0.02;
const bifurcBot = -0.10;
const legCenterX = 0.055;
const legRadiusW = 0.048;
const legRadiusD = 0.042;

for (let i = 0; i < 3500; i++) {
  const y = rand(bifurcBot, bifurcTop);
  const blend = (y - bifurcBot) / (bifurcTop - bifurcBot);

  const hipProfile = evalTorsoAt(Math.max(y, sections[0].y));
  const hipW = hipProfile ? hipProfile.w : 0.105 * S;
  const hipD = hipProfile ? hipProfile.d : 0.075 * S;

  const angle = rand(0, Math.PI * 2);

  if (blend > 0.85) {
    const pinch = 1 - (1 - blend) * 3;
    let x = hipW * Math.cos(angle);
    const z = hipD * Math.sin(angle);
    if (Math.abs(x) < hipW * 0.3) {
      x *= lerp(0.7, 1.0, pinch);
    }
    addPoint(x, y, z, 'root', 0.38, COL.body);
  } else {
    const side = Math.random() < 0.5 ? -1 : 1;
    const sepCx = side * legCenterX;
    const mergedX = hipW * Math.cos(angle);
    const mergedZ = hipD * Math.sin(angle);
    const sepX = sepCx + legRadiusW * Math.cos(angle);
    const sepZ = legRadiusD * Math.sin(angle);
    const x = lerp(sepX, mergedX, blend / 0.85);
    const z = lerp(sepZ, mergedZ, blend / 0.85);

    const joint = side === -1 ? 'l_hip' : 'r_hip';
    addPoint(x, y, z, joint, 0.38, COL.body);
  }
}

// ══════════════════════════════════════════════════════════════
// LEGS — Elliptical tube cross-sections
// Hip Y=0, Knee Y=-0.35, Foot Y=-0.7
// ══════════════════════════════════════════════════════════════

type EllipseSection = { y: number; cx: number; rw: number; rd: number };

function sampleEllipticalLimb(secs: EllipseSection[], count: number, jointId: string, cz: number = 0): void {
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
    const rw = Math.max(catmullRom(secs[i0].rw, secs[i1].rw, secs[i2].rw, secs[i3].rw, t), 0.003);
    const rd = Math.max(catmullRom(secs[i0].rd, secs[i1].rd, secs[i2].rd, secs[i3].rd, t), 0.003);

    const angle = rand(0, Math.PI * 2);
    const x = cx + rw * Math.cos(angle);
    const z = cz + rd * Math.sin(angle);

    addPoint(x, y, z, jointId, 0.38, COL.body);
  }
}

for (const [side, hipJoint, kneeJoint, footJoint] of [
  [-1, 'l_hip', 'l_knee', 'l_foot'],
  [1, 'r_hip', 'r_knee', 'r_foot'],
] as const) {
  const hipX = side * legCenterX;
  const kneeX = side * 0.1;
  const ankleX = side * 0.1;
  const kneeY = -0.35;
  const footY = -0.7;

  const thighSections: EllipseSection[] = [
    { y: bifurcBot, cx: hipX, rw: legRadiusW, rd: legRadiusD },
    { y: bifurcBot - 0.05, cx: lerp(hipX, kneeX, 0.15), rw: 0.044, rd: 0.040 },
    { y: lerp(bifurcBot, kneeY, 0.4), cx: lerp(hipX, kneeX, 0.4), rw: 0.038, rd: 0.034 },
    { y: lerp(bifurcBot, kneeY, 0.7), cx: lerp(hipX, kneeX, 0.7), rw: 0.032, rd: 0.028 },
    { y: kneeY, cx: kneeX, rw: 0.028, rd: 0.024 },
  ];
  sampleEllipticalLimb(thighSections, 3000, hipJoint);

  const calfSections: EllipseSection[] = [
    { y: kneeY, cx: kneeX, rw: 0.028, rd: 0.025 },
    { y: lerp(kneeY, footY, 0.25), cx: kneeX, rw: 0.026, rd: 0.027 },
    { y: lerp(kneeY, footY, 0.5), cx: kneeX, rw: 0.022, rd: 0.021 },
    { y: lerp(kneeY, footY, 0.75), cx: ankleX, rw: 0.017, rd: 0.016 },
    { y: footY + 0.04, cx: ankleX, rw: 0.014, rd: 0.013 },
  ];
  sampleEllipticalLimb(calfSections, 2000, kneeJoint);

  const fx = side * 0.1;
  const fy = footY;
  ellipsoid(fx, fy, 0, 0.018, 0.013, 0.018, 100, footJoint, 0.35, COL.body);
  ellipsoid(fx, fy - 0.015, 0.03, 0.022, 0.01, 0.045, 150, footJoint, 0.35, COL.body);
  ellipsoid(fx, fy - 0.012, -0.015, 0.013, 0.01, 0.013, 50, footJoint, 0.3, COL.dim);
  for (let t = 0; t < 5; t++) {
    const tx = fx - 0.012 + t * 0.006;
    const ts = t === 0 ? 0.006 : 0.004;
    ellipsoid(tx, fy - 0.018, 0.07 - Math.abs(t - 1) * 0.003, ts, ts, ts, 6, footJoint, 0.22, COL.highlight);
  }
}

// ══════════════════════════════════════════════════════════════
// SHOULDER CAPS — bridge torso edge to arm tops
// ══════════════════════════════════════════════════════════════
for (const sx of [-1, 1]) {
  const shX = sx * 0.15;
  const shJoint = sx === -1 ? 'l_shoulder' : 'r_shoulder';
  ellipsoid(shX, 0.55, 0, 0.042, 0.025, 0.035, 300, shJoint, 0.38, COL.body);
}

// ══════════════════════════════════════════════════════════════
// ARMS — Elliptical tubes
// Shoulders at Y=0.55, elbows at Y=0.35, hands at Y=0.17
// All at X=±0.15
// ══════════════════════════════════════════════════════════════

for (const [side, shJoint, elJoint, haJoint] of [
  [-1, 'l_shoulder', 'l_elbow', 'l_hand'],
  [1, 'r_shoulder', 'r_elbow', 'r_hand'],
] as const) {
  const shoulderX = side * 0.15;
  const shoulderY = 0.55;
  const elbowX = side * 0.15;
  const elbowY = 0.35;
  const wristX = side * 0.15;
  const wristY = 0.17;

  const upperArmSections: EllipseSection[] = [
    { y: shoulderY, cx: shoulderX, rw: 0.038, rd: 0.033 },
    { y: lerp(shoulderY, elbowY, 0.2), cx: lerp(shoulderX, elbowX, 0.2), rw: 0.030, rd: 0.028 },
    { y: lerp(shoulderY, elbowY, 0.5), cx: lerp(shoulderX, elbowX, 0.5), rw: 0.026, rd: 0.024 },
    { y: elbowY, cx: elbowX, rw: 0.022, rd: 0.021 },
  ];
  sampleEllipticalLimb(upperArmSections, 1800, shJoint);

  const forearmSections: EllipseSection[] = [
    { y: elbowY, cx: elbowX, rw: 0.022, rd: 0.021 },
    { y: lerp(elbowY, wristY, 0.3), cx: lerp(elbowX, wristX, 0.3), rw: 0.019, rd: 0.018 },
    { y: lerp(elbowY, wristY, 0.7), cx: lerp(elbowX, wristX, 0.7), rw: 0.015, rd: 0.014 },
    { y: wristY, cx: wristX, rw: 0.012, rd: 0.011 },
  ];
  sampleEllipticalLimb(forearmSections, 1400, elJoint);

  const hx = wristX;
  const hy = wristY;
  ellipsoid(hx, hy - 0.02, 0, 0.018, 0.022, 0.008, 120, haJoint, 0.3, COL.body);
  const fingers = [
    { dx: -0.012, len: 0.03 }, { dx: -0.005, len: 0.035 },
    { dx: 0.002, len: 0.04 }, { dx: 0.009, len: 0.035 },
    { dx: 0.016, len: 0.022 },
  ];
  for (const f of fingers) {
    for (let fi = 0; fi < 10; fi++) {
      const ft = rand(0, 1);
      const fr = 0.004 * (1 - ft * 0.4);
      const fa = rand(0, Math.PI * 2);
      addPoint(hx + f.dx + fr * Math.cos(fa), hy - 0.04 - ft * f.len, fr * Math.sin(fa), haJoint, 0.2, COL.highlight);
    }
    addPoint(hx + f.dx, hy - 0.04 - f.len, 0, haJoint, 0.22, COL.bright);
  }
}

// ══════════════════════════════════════════════════════════════
// NECK-TO-HEAD CONNECTOR — fills the gap between upper neck
// (Y=0.68) and the bottom of the skull (~Y=0.82)
// ══════════════════════════════════════════════════════════════
const neckConnectorSecs: EllipseSection[] = [
  { y: 0.68, cx: 0, rw: 0.025 * S, rd: 0.025 * S },
  { y: 0.73, cx: 0, rw: 0.024 * S, rd: 0.024 * S },
  { y: 0.78, cx: 0, rw: 0.026 * S, rd: 0.027 * S },
  { y: 0.82, cx: 0, rw: 0.030 * S, rd: 0.030 * S },
];
sampleEllipticalLimb(neckConnectorSecs, 600, 'head');

// ══════════════════════════════════════════════════════════════
// HEAD — centered at Y=0.93 (head joint at 0.85 + 0.08 offset)
// ══════════════════════════════════════════════════════════════
const headJY = 0.85;
const headCY = headJY + 0.08;
const headW = 0.085 * S / 2;
const headD = 0.095 * S / 2;
const headH = 0.11 * S / 2;

// Skull
ellipsoid(0, headCY, 0, headW, headH, headD, 1200, 'head', 0.4, COL.body, -Math.PI / 2, Math.PI / 5);
// Face
ellipsoid(0, headCY - 0.01, headD * 0.6, headW * 0.85, headH * 0.8, headD * 0.25, 900, 'head', 0.3, COL.highlight, -Math.PI / 3, Math.PI / 4);
// Jawline
for (let i = 0; i < 80; i++) {
  const t = rand(-1, 1);
  const a = t * Math.PI * 0.45;
  addPoint(headW * 0.95 * Math.sin(a), headCY - headH * 0.65 + Math.abs(t) * headH * 0.2, headD * 0.7 * Math.cos(a), 'head', 0.3, COL.contour);
}
// Cheekbones
for (const side of [-1, 1]) {
  ellipsoid(side * headW * 0.7, headCY + headH * 0.1, headD * 0.55, 0.012, 0.008, 0.008, 35, 'head', 0.3, COL.highlight);
}
// Eyes
const eyeY = headCY + headH * 0.15;
const eyeSpacing = headW * 0.45;
const eyeZ = headD * 0.85;
for (const side of [-1, 1]) {
  ellipsoid(side * eyeSpacing, eyeY, eyeZ, 0.012, 0.006, 0.003, 18, 'head', 0.45, COL.eyeGlow);
  ellipsoid(side * eyeSpacing, eyeY, eyeZ + 0.002, 0.005, 0.003, 0.002, 10, 'head', 0.6, COL.eye);
}
// Eyebrows
for (const side of [-1, 1]) {
  for (let i = 0; i < 16; i++) {
    const t = rand(-1, 1);
    addPoint(side * eyeSpacing + t * 0.016, eyeY + 0.011 + (1 - t * t) * 0.003, eyeZ - 0.002, 'head', 0.25, COL.contour);
  }
}
// Nose
const noseTopY = eyeY - 0.005;
const noseTipY = headCY - headH * 0.15;
for (let i = 0; i < 25; i++) {
  const t = rand(0, 1);
  addPoint(rand(-0.003 - t * 0.005, 0.003 + t * 0.005), lerp(noseTopY, noseTipY, t), eyeZ + t * 0.012, 'head', 0.28, COL.highlight);
}
ellipsoid(0, noseTipY, eyeZ + 0.01, 0.007, 0.004, 0.004, 12, 'head', 0.3, COL.highlight);
// Lips
const mouthY = headCY - headH * 0.35;
const lipW = eyeSpacing * 0.9;
for (let i = 0; i < 40; i++) {
  const t = rand(-1, 1);
  addPoint(t * lipW, mouthY + 0.003 + (1 - t * t) * 0.002, eyeZ - 0.002, 'head', 0.3, COL.lip);
  addPoint(t * lipW * 0.9, mouthY - 0.003 - (1 - t * t) * 0.002, eyeZ - 0.003, 'head', 0.3, COL.lip);
}
// Chin
ellipsoid(0, headCY - headH * 0.7, headD * 0.5, 0.018, 0.013, 0.013, 35, 'head', 0.35, COL.body);
// Ears
for (const side of [-1, 1]) {
  ellipsoid(side * headW * 0.95, headCY + headH * 0.05, 0, 0.007, 0.016, 0.007, 25, 'head', 0.25, COL.dim);
}

// ══════════════════════════════════════════════════════════════
// OUTPUT
// ══════════════════════════════════════════════════════════════

const cleaned = points.map((p) => ({
  joint_id: p.joint_id,
  offset: [
    Math.round(p.offset[0] * 10000) / 10000,
    Math.round(p.offset[1] * 10000) / 10000,
    Math.round(p.offset[2] * 10000) / 10000,
  ] as [number, number, number],
  size: Math.round(p.size * 100) / 100,
  color: p.color,
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
