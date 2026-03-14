/**
 * Generate a realistic feminine humanoid point cloud for the hologram avatar.
 * Uses Catmull-Rom spline interpolation across cross-sections for a smooth,
 * continuous surface with no seams or gaps.
 *
 * Run: npx ts-node scripts/generateHologramBody.ts
 * Output: scripts/hologram_body.json
 *
 * Skeleton world positions (default pose):
 *   root:       [0, 0.9, 0]       spine:      [0, 1.05, 0]
 *   chest:      [0, 1.2, 0]       neck:       [0, 1.3, 0]
 *   head:       [0, 1.45, 0]
 *   l_shoulder: [-0.18, 1.2, 0]   r_shoulder: [0.18, 1.2, 0]
 *   l_elbow:    [-0.43, 1.2, 0]   r_elbow:    [0.43, 1.2, 0]
 *   l_hand:     [-0.65, 1.2, 0]   r_hand:     [0.65, 1.2, 0]
 *   l_hip:      [-0.1, 0.9, 0]    r_hip:      [0.1, 0.9, 0]
 *   l_knee:     [-0.1, 0.5, 0]    r_knee:     [0.1, 0.5, 0]
 *   l_foot:     [-0.1, 0.1, 0]    r_foot:     [0.1, 0.1, 0]
 */

type Point = {
  joint_id: string;
  offset: [number, number, number];
  size: number;
  color: string;
};

const points: Point[] = [];

// Scale: spec uses h=2.0, our figure is ~1.55 units tall
const H = 1.55;
const S = H / 2.0;

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

const JOINTS: Record<string, [number, number, number]> = {
  root: [0, 0.9, 0], spine: [0, 1.05, 0], chest: [0, 1.2, 0],
  neck: [0, 1.3, 0], head: [0, 1.45, 0],
  l_shoulder: [-0.18, 1.2, 0], r_shoulder: [0.18, 1.2, 0],
  l_elbow: [-0.43, 1.2, 0], r_elbow: [0.43, 1.2, 0],
  l_hand: [-0.65, 1.2, 0], r_hand: [0.65, 1.2, 0],
  l_hip: [-0.1, 0.9, 0], r_hip: [0.1, 0.9, 0],
  l_knee: [-0.1, 0.5, 0], r_knee: [0.1, 0.5, 0],
  l_foot: [-0.1, 0.1, 0], r_foot: [0.1, 0.1, 0],
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

/** Add a point at world position, converting to joint-relative offset with random displacement */
function addPoint(worldX: number, worldY: number, worldZ: number, jointId: string, size: number, color: string): void {
  const j = JOINTS[jointId];
  const disp = 0.005; // random displacement for organic feel
  points.push({
    joint_id: jointId,
    offset: [
      worldX - j[0] + rand(-disp, disp),
      worldY - j[1] + rand(-disp, disp),
      worldZ - j[2] + rand(-disp, disp),
    ],
    size,
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
      jointId, size * rand(0.85, 1.15), color,
    );
  }
}

function specY(ratio: number): number {
  return 0.1 + ratio * H;
}

// ══════════════════════════════════════════════════════════════
// CROSS-SECTION DEFINITIONS
// Each section: { y, width (half), depth (half), jointId, bustAdd }
// ══════════════════════════════════════════════════════════════

type Section = {
  y: number;
  w: number;  // half-width (X radius)
  d: number;  // half-depth (Z radius)
  joint: string;
  bust?: number; // forward bust projection at this height (0 = none)
};

const sections: Section[] = [
  // Crotch / leg divide
  { y: specY(0.50), w: 0.105 * S, d: 0.075 * S, joint: 'root' },
  // Lower hip
  { y: specY(0.54), w: 0.105 * S, d: 0.075 * S, joint: 'root' },
  // Hip bone (widest)
  { y: specY(0.58), w: 0.105 * S, d: 0.075 * S, joint: 'root' },
  // Above hips
  { y: specY(0.61), w: 0.095 * S, d: 0.07 * S, joint: 'spine' },
  // Navel
  { y: specY(0.63), w: 0.09 * S, d: 0.065 * S, joint: 'spine' },
  // Natural waist (narrowest — key feminine proportion)
  { y: specY(0.66), w: 0.073 * S, d: 0.06 * S, joint: 'spine' },
  // Above waist
  { y: specY(0.69), w: 0.08 * S, d: 0.06 * S, joint: 'chest' },
  // Under-bust / ribcage
  { y: specY(0.71), w: 0.085 * S, d: 0.06 * S, joint: 'chest' },
  // Bust line (with forward projection)
  { y: specY(0.75), w: 0.10 * S, d: 0.07 * S, joint: 'chest', bust: 0.025 * S },
  // Above bust
  { y: specY(0.78), w: 0.095 * S, d: 0.065 * S, joint: 'chest', bust: 0.008 * S },
  // Armpit / upper chest
  { y: specY(0.80), w: 0.095 * S, d: 0.06 * S, joint: 'chest' },
  // Shoulder line
  { y: specY(0.82), w: 0.11 * S, d: 0.055 * S, joint: 'chest' },
  // Neck base / collarbone
  { y: specY(0.84), w: 0.06 * S, d: 0.04 * S, joint: 'neck' },
  // Mid neck
  { y: specY(0.86), w: 0.028 * S, d: 0.028 * S, joint: 'neck' },
  // Upper neck / chin
  { y: specY(0.875), w: 0.025 * S, d: 0.025 * S, joint: 'neck' },
];

/** Evaluate the torso profile at any Y using Catmull-Rom through the sections */
function evalTorsoAt(y: number): { w: number; d: number; joint: string; bust: number } | null {
  if (y < sections[0].y || y > sections[sections.length - 1].y) return null;

  // Find the segment
  let idx = 0;
  for (let i = 0; i < sections.length - 1; i++) {
    if (y >= sections[i].y && y <= sections[i + 1].y) {
      idx = i;
      break;
    }
  }

  const t = sections[idx + 1].y === sections[idx].y
    ? 0
    : (y - sections[idx].y) / (sections[idx + 1].y - sections[idx].y);

  // Catmull-Rom needs 4 points: [idx-1, idx, idx+1, idx+2]
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

  // Joint: use whichever section is closer
  const joint = t < 0.5 ? sections[i1].joint : sections[i2].joint;

  return { w: Math.max(w, 0.001), d: Math.max(d, 0.001), joint, bust: Math.max(bust, 0) };
}

// ══════════════════════════════════════════════════════════════
// SAMPLE TORSO — uniform random Y, spline-interpolated profile
// ══════════════════════════════════════════════════════════════

const torsoYMin = sections[0].y;
const torsoYMax = sections[sections.length - 1].y;

for (let i = 0; i < 7000; i++) {
  const y = rand(torsoYMin, torsoYMax);
  const profile = evalTorsoAt(y);
  if (!profile) continue;

  const angle = rand(0, Math.PI * 2);
  let x = profile.w * Math.cos(angle);
  let z = profile.d * Math.sin(angle);

  // Bust: smooth forward projection using cosine falloff
  // Only applies to front half, and only near bust center (X near ±bustSpacing)
  if (profile.bust > 0 && z > 0) {
    const bustSpacing = 0.035 * S;
    for (const side of [-1, 1]) {
      const bx = side * bustSpacing;
      const distFromCenter = Math.abs(x - bx);
      const bustW = 0.035 * S; // radius of influence
      if (distFromCenter < bustW) {
        // Cosine falloff: smooth blend from full projection at center to 0 at edge
        const falloff = 0.5 * (1 + Math.cos(Math.PI * distFromCenter / bustW));
        const frontFalloff = Math.cos(angle) > 0 ? Math.pow(Math.cos(angle), 0.5) : 0;
        z += profile.bust * falloff * frontFalloff;
      }
    }
  }

  addPoint(x, y, z, profile.joint, rand(0.4, 0.55), COL.body);
}

// ── Glute volume — blended into hip surface ──
for (let i = 0; i < 400; i++) {
  const y = rand(specY(0.50), specY(0.57));
  const profile = evalTorsoAt(y);
  if (!profile) continue;
  const angle = rand(Math.PI * 0.6, Math.PI * 1.4); // back half only
  const x = profile.w * Math.cos(angle) * rand(0.95, 1.05);
  const z = profile.d * Math.sin(angle) * rand(1.0, 1.15); // slight extra depth
  addPoint(x, y, z, 'root', rand(0.4, 0.5), COL.body);
}

// ══════════════════════════════════════════════════════════════
// ARMS — Smooth tubular cross-sections connected to shoulders
// Each arm is a spline-interpolated tube from shoulder → elbow → wrist
// ══════════════════════════════════════════════════════════════

type LimbSection = { t: number; cx: number; cy: number; cz: number; rw: number; rd: number };

function sampleLimb(limbSections: LimbSection[], count: number, jointId: string): void {
  for (let i = 0; i < count; i++) {
    const t = rand(0, 1);

    // Find segment
    let idx = 0;
    for (let s = 0; s < limbSections.length - 1; s++) {
      if (t >= limbSections[s].t && t <= limbSections[s + 1].t) {
        idx = s;
        break;
      }
    }

    const segT = limbSections[idx + 1].t === limbSections[idx].t
      ? 0
      : (t - limbSections[idx].t) / (limbSections[idx + 1].t - limbSections[idx].t);

    const i0 = Math.max(0, idx - 1);
    const i1 = idx;
    const i2 = idx + 1;
    const i3 = Math.min(limbSections.length - 1, idx + 2);

    const cx = catmullRom(limbSections[i0].cx, limbSections[i1].cx, limbSections[i2].cx, limbSections[i3].cx, segT);
    const cy = catmullRom(limbSections[i0].cy, limbSections[i1].cy, limbSections[i2].cy, limbSections[i3].cy, segT);
    const cz = catmullRom(limbSections[i0].cz, limbSections[i1].cz, limbSections[i2].cz, limbSections[i3].cz, segT);
    const rw = catmullRom(limbSections[i0].rw, limbSections[i1].rw, limbSections[i2].rw, limbSections[i3].rw, segT);
    const rd = catmullRom(limbSections[i0].rd, limbSections[i1].rd, limbSections[i2].rd, limbSections[i3].rd, segT);

    const angle = rand(0, Math.PI * 2);
    addPoint(
      cx + Math.max(rw, 0.002) * Math.cos(angle),
      cy,
      cz + Math.max(rd, 0.002) * Math.sin(angle),
      jointId, rand(0.35, 0.5), COL.body,
    );
  }
}

// Arms hang at sides: shoulder → elbow → wrist, going downward
for (const [side, shJoint, elJoint, haJoint] of [
  [-1, 'l_shoulder', 'l_elbow', 'l_hand'],
  [1, 'r_shoulder', 'r_elbow', 'r_hand'],
] as const) {
  const shoulderX = side * 0.11 * S; // where arm emerges from torso
  const shoulderY = specY(0.82);
  const elbowX = side * 0.18;
  const elbowY = specY(0.58); // elbows at roughly hip level
  const wristX = side * 0.20;
  const wristY = specY(0.42);

  // Upper arm: shoulder to elbow (attached to shoulder joint for animation)
  const upperArmSections: LimbSection[] = [
    // Transition zone — wider at top to blend into shoulder/torso
    { t: 0.0, cx: shoulderX, cy: shoulderY, cz: 0, rw: 0.04, rd: 0.035 },
    { t: 0.15, cx: lerp(shoulderX, elbowX, 0.15), cy: lerp(shoulderY, elbowY, 0.15), cz: 0, rw: 0.032, rd: 0.03 },
    { t: 0.5, cx: lerp(shoulderX, elbowX, 0.5), cy: lerp(shoulderY, elbowY, 0.5), cz: 0, rw: 0.027, rd: 0.025 },
    { t: 1.0, cx: elbowX, cy: elbowY, cz: 0, rw: 0.022, rd: 0.022 },
  ];
  sampleLimb(upperArmSections, 1200, shJoint);

  // Forearm: elbow to wrist (attached to elbow joint)
  const forearmSections: LimbSection[] = [
    { t: 0.0, cx: elbowX, cy: elbowY, cz: 0, rw: 0.022, rd: 0.022 },
    { t: 0.3, cx: lerp(elbowX, wristX, 0.3), cy: lerp(elbowY, wristY, 0.3), cz: 0, rw: 0.020, rd: 0.019 },
    { t: 0.7, cx: lerp(elbowX, wristX, 0.7), cy: lerp(elbowY, wristY, 0.7), cz: 0, rw: 0.016, rd: 0.015 },
    { t: 1.0, cx: wristX, cy: wristY, cz: 0, rw: 0.013, rd: 0.012 },
  ];
  sampleLimb(forearmSections, 900, elJoint);

  // Hand
  const handX = wristX;
  const handY = wristY;
  // Palm
  ellipsoid(handX, handY - 0.02, 0, 0.018, 0.022, 0.008, 80, haJoint, 0.3, COL.body);
  // Fingers (simplified tapered tubes)
  const fingers = [
    { dx: -0.012, len: 0.03 },
    { dx: -0.005, len: 0.035 },
    { dx: 0.002, len: 0.04 },
    { dx: 0.009, len: 0.035 },
    { dx: 0.016, len: 0.022 }, // thumb
  ];
  for (const f of fingers) {
    for (let fi = 0; fi < 10; fi++) {
      const ft = rand(0, 1);
      const fr = 0.004 * (1 - ft * 0.4);
      const fa = rand(0, Math.PI * 2);
      addPoint(handX + f.dx + fr * Math.cos(fa), handY - 0.04 - ft * f.len, fr * Math.sin(fa), haJoint, 0.2, COL.highlight);
    }
    addPoint(handX + f.dx, handY - 0.04 - f.len, 0, haJoint, 0.22, COL.bright);
  }
}

// ══════════════════════════════════════════════════════════════
// LEGS — Smooth tubes from hips down, connected to torso
// ══════════════════════════════════════════════════════════════

for (const [side, hipJoint, kneeJoint, footJoint] of [
  [-1, 'l_hip', 'l_knee', 'l_foot'],
  [1, 'r_hip', 'r_knee', 'r_foot'],
] as const) {
  const hipX = side * 0.07; // inner position — legs emerge from inside hip area
  const hipY = specY(0.50);
  const kneeX = side * 0.1;
  const kneeY = 0.5;
  const ankleX = side * 0.1;
  const ankleY = 0.12;

  // Thigh: hip to knee
  // Starts wide (connects to hip) and tapers to knee
  const thighSections: LimbSection[] = [
    // Wide at top to blend into hip area — NO gap
    { t: 0.0, cx: hipX, cy: hipY, cz: 0, rw: 0.055, rd: 0.048 },
    { t: 0.1, cx: lerp(hipX, kneeX, 0.1), cy: lerp(hipY, kneeY, 0.1), cz: 0, rw: 0.050, rd: 0.044 },
    { t: 0.3, cx: lerp(hipX, kneeX, 0.3), cy: lerp(hipY, kneeY, 0.3), cz: 0, rw: 0.042, rd: 0.038 },
    { t: 0.6, cx: lerp(hipX, kneeX, 0.6), cy: lerp(hipY, kneeY, 0.6), cz: 0, rw: 0.035, rd: 0.032 },
    { t: 1.0, cx: kneeX, cy: kneeY, cz: 0, rw: 0.028, rd: 0.025 },
  ];
  sampleLimb(thighSections, 1800, hipJoint);

  // Calf: knee to ankle
  const calfSections: LimbSection[] = [
    { t: 0.0, cx: kneeX, cy: kneeY, cz: 0, rw: 0.028, rd: 0.025 },
    // Calf muscle bulge (back) — slightly more depth in front third
    { t: 0.25, cx: kneeX, cy: lerp(kneeY, ankleY, 0.25), cz: -0.005, rw: 0.025, rd: 0.026 },
    { t: 0.5, cx: kneeX, cy: lerp(kneeY, ankleY, 0.5), cz: 0, rw: 0.021, rd: 0.020 },
    { t: 0.8, cx: ankleX, cy: lerp(kneeY, ankleY, 0.8), cz: 0, rw: 0.016, rd: 0.015 },
    { t: 1.0, cx: ankleX, cy: ankleY, cz: 0, rw: 0.014, rd: 0.013 },
  ];
  sampleLimb(calfSections, 1200, kneeJoint);

  // Foot
  const fx = side * 0.1;
  const fy = 0.1;
  ellipsoid(fx, fy, 0, 0.018, 0.013, 0.018, 60, footJoint, 0.35, COL.body);
  ellipsoid(fx, fy - 0.015, 0.03, 0.022, 0.01, 0.045, 100, footJoint, 0.35, COL.body);
  ellipsoid(fx, fy - 0.012, -0.015, 0.013, 0.01, 0.013, 30, footJoint, 0.3, COL.dim);
  for (let t = 0; t < 5; t++) {
    const tx = fx - 0.012 + t * 0.006;
    const ts = t === 0 ? 0.006 : 0.004;
    ellipsoid(tx, fy - 0.018, 0.07 - Math.abs(t - 1) * 0.003, ts, ts, ts, 6, footJoint, 0.22, COL.highlight);
  }
}

// ══════════════════════════════════════════════════════════════
// HEAD — face details
// ══════════════════════════════════════════════════════════════
const headJY = 1.45;
const headCY = headJY + 0.08;
const headW = 0.085 * S / 2;
const headD = 0.095 * S / 2;
const headH = 0.11 * S / 2;

// Skull (lower half, upper covered by hair particles)
ellipsoid(0, headCY, 0, headW, headH, headD, 800, 'head', 0.4, COL.body, -Math.PI / 2, Math.PI / 5);

// Face front — denser
ellipsoid(0, headCY - 0.01, headD * 0.6, headW * 0.85, headH * 0.8, headD * 0.25,
  600, 'head', 0.3, COL.highlight, -Math.PI / 3, Math.PI / 4, );

// Jawline
for (let i = 0; i < 80; i++) {
  const t = rand(-1, 1);
  const a = t * Math.PI * 0.45;
  const r = headW * 0.95;
  addPoint(r * Math.sin(a), headCY - headH * 0.65 + Math.abs(t) * headH * 0.2, headD * 0.7 * Math.cos(a), 'head', 0.3, COL.contour);
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
  const y = lerp(noseTopY, noseTipY, t);
  addPoint(rand(-0.003 - t * 0.005, 0.003 + t * 0.005), y, eyeZ + t * 0.012, 'head', 0.28, COL.highlight);
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
cleaned.forEach((p) => {
  byJoint[p.joint_id] = (byJoint[p.joint_id] || 0) + 1;
});

console.log(`Total points: ${cleaned.length}`);
console.log('By joint:');
Object.entries(byJoint)
  .sort((a, b) => b[1] - a[1])
  .forEach(([j, c]) => console.log(`  ${j}: ${c}`));

const fs = require('fs');
fs.writeFileSync('scripts/hologram_body.json', JSON.stringify(cleaned, null, 0));
console.log('\nWritten to scripts/hologram_body.json');
console.log(`JSON size: ${(JSON.stringify(cleaned).length / 1024).toFixed(1)} KB`);
