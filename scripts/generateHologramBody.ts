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
  // Organ/part colors (used in debug mode, rendered as body color normally)
  breast: '#ff69b4',     // pink
  heart: '#ff2020',      // red
  lung: '#ff8888',       // light red
  stomach: '#e8b030',    // yellow-orange
  intestine: '#c89040',  // tan
  womb: '#ff40a0',       // hot pink
  ovary: '#ff80c0',      // light pink
  fallopian: '#ff60b0',  // medium pink
  vagina: '#ff50a0',     // deep pink
  cervix: '#ff3090',     // magenta-pink
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
// Curvier feminine build. Shoulders at ±0.125, hips at ±0.06.
// DB skeleton stores RELATIVE offsets; these are the resolved absolutes.
//
// DB skeleton (relative offsets from parent):
//   root:       [0, 0, 0]          (absolute)
//   spine:      [0, 0.20, 0]       → [0, 0.20, 0]
//   chest:      [0, 0.20, 0]       → [0, 0.40, 0]
//   neck:       [0, 0.13, 0]       → [0, 0.53, 0]
//   head:       [0, 0.09, 0]       → [0, 0.62, 0]
//   l_shoulder: [-0.125, 0.08, 0]  → [-0.125, 0.48, 0]
//   l_elbow:    [-0.035, -0.21, 0] → [-0.160, 0.27, 0]
//   l_hand:     [0, -0.20, 0]      → [-0.160, 0.07, 0]
//   l_hip:      [-0.06, 0, 0]      → [-0.06, 0, 0]
//   l_knee:     [0, -0.44, 0]      → [-0.06, -0.44, 0]
//   l_foot:     [0, -0.44, 0]      → [-0.06, -0.88, 0]
// ══════════════════════════════════════════════════════════════

const JOINTS: Record<string, [number, number, number]> = {
  root:       [0, 0, 0],
  spine:      [0, 0.20, 0],
  chest:      [0, 0.40, 0],
  neck:       [0, 0.53, 0],
  head:       [0, 0.62, 0],
  l_shoulder: [-0.125, 0.48, 0],
  r_shoulder: [0.125, 0.48, 0],
  l_elbow:    [-0.160, 0.27, 0],
  r_elbow:    [0.160, 0.27, 0],
  l_hand:     [-0.160, 0.07, 0],
  r_hand:     [0.160, 0.07, 0],
  l_hip:      [-0.040, -0.10, 0],
  r_hip:      [0.040, -0.10, 0],
  l_knee:     [-0.055, -0.48, 0],
  r_knee:     [0.055, -0.48, 0],
  l_foot:     [-0.055, -0.86, 0],
  r_foot:     [0.055, -0.86, 0],
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
  if (y > 0.49) return 'neck';
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
// TORSO CROSS-SECTIONS — Curvy feminine build (hourglass)
//
// Reference-matched ratios:
//   Hip/Shoulder: 1.04    Hip/Waist: 1.65
//   Bust/Shoulder: 0.89
// Half-widths (radii):
//   Neck:     ~0.034        Shoulder: 0.140
//   Ribcage:  0.108         Bust:     0.125
//   Waist:    0.088         Hip:      0.145
// ══════════════════════════════════════════════════════════════

type Section = {
  y: number;
  w: number;
  d: number;
  joint: string;
  bust?: number;
};

const sections: Section[] = [
  // Lower abdomen
  { y: -0.06, w: 0.118, d: 0.082, joint: 'root' },
  // Hip bone (widest)
  { y: 0.00,  w: 0.130, d: 0.088, joint: 'root' },
  // Above hips
  { y: 0.08,  w: 0.102, d: 0.078, joint: 'spine' },
  // Navel
  { y: 0.16,  w: 0.085, d: 0.070, joint: 'spine' },
  // Natural waist
  { y: 0.22,  w: 0.073, d: 0.062, joint: 'spine' },
  // Above waist
  { y: 0.27,  w: 0.082, d: 0.068, joint: 'spine' },
  // Ribcage
  { y: 0.33,  w: 0.095, d: 0.075, joint: 'chest' },
  // Bust line
  { y: 0.38,  w: 0.106, d: 0.082, joint: 'chest', bust: 0.050 },
  // Above bust
  { y: 0.41,  w: 0.112, d: 0.080, joint: 'chest', bust: 0.015 },
  // Armpit
  { y: 0.43,  w: 0.108, d: 0.070, joint: 'chest' },
  // Upper chest
  { y: 0.46,  w: 0.105, d: 0.065, joint: 'chest' },
  // Shoulder line (widest torso)
  { y: 0.48,  w: 0.125, d: 0.060, joint: 'chest' },
  // Shoulder slope
  { y: 0.49,  w: 0.115, d: 0.058, joint: 'chest' },
  // Mid slope
  { y: 0.50,  w: 0.098, d: 0.056, joint: 'chest' },
  // Trapezius
  { y: 0.51,  w: 0.080, d: 0.052, joint: 'chest' },
  // Neck widens
  { y: 0.52,  w: 0.065, d: 0.048, joint: 'neck' },
  // Neck base — wider, proportional to head
  { y: 0.53,  w: 0.060, d: 0.050, joint: 'neck' },
  // Mid neck — thicker
  { y: 0.56,  w: 0.052, d: 0.050, joint: 'neck' },
  // Upper neck — thicker
  { y: 0.59,  w: 0.050, d: 0.048, joint: 'neck' },
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
    const bustSpacing = 0.045;
    for (const side of [-1, 1]) {
      const bx = side * bustSpacing;
      const distFromCenter = Math.abs(x - bx);
      const bustRadius = 0.058;
      if (distFromCenter < bustRadius) {
        const falloff = 0.5 * (1 + Math.cos(Math.PI * distFromCenter / bustRadius));
        const frontFalloff = Math.cos(angle) > 0 ? Math.pow(Math.cos(angle), 0.6) : 0;
        z += profile.bust * falloff * frontFalloff;
      }
    }
  }

  // Balance density across torso — upper regions are over-dense
  if (y > 0.50 && Math.random() < 0.80) continue;     // neck zone: keep 20%
  if (y > 0.33 && y <= 0.50 && Math.random() < 0.65) continue;  // chest: keep 35%
  if (y > 0.15 && y <= 0.33 && Math.random() < 0.50) continue;  // waist/belly: keep 50%

  addPoint(x, y, z, profile.joint, 0.12, COL.body);
}

// Extra bust surface density
for (let i = 0; i < 195; i++) {
  const y = rand(0.34, 0.42);
  const profile = evalTorsoAt(y);
  if (!profile || profile.bust <= 0) continue;
  const bustSpacing = 0.045;
  const side = Math.random() < 0.5 ? -1 : 1;
  const bx = side * bustSpacing;
  const angle = rand(-0.8, 0.8);
  const r = rand(0.015, 0.05);
  const x = bx + r * Math.sin(angle);
  const z = profile.d + profile.bust * rand(0.3, 1.0) * Math.cos(angle);
  addPoint(x, y, z, 'chest', 0.12, COL.body);
}

// Glute volume — fuller rear
for (let i = 0; i < 100; i++) {
  const y = rand(-0.12, 0.02);
  const profile = evalTorsoAt(Math.max(y, sections[0].y));
  if (!profile) continue;
  const angle = rand(Math.PI * 0.55, Math.PI * 1.45);
  addPoint(
    profile.w * Math.cos(angle) * rand(0.95, 1.05), y,
    profile.d * Math.sin(angle) * rand(1.0, 1.10),
    'root', 0.18, COL.body,
  );
}

// ══════════════════════════════════════════════════════════════
// HIP-TO-LEG BIFURCATION ZONE
//
// Thin transition zone. Low particle count to avoid hotspot.
// Outer edges align with hip width for smooth contour.
// ══════════════════════════════════════════════════════════════

const bifurcTop = -0.02;
const bifurcBot = -0.10;
const legTopCenterX = 0.040;
const legTopRadiusW = 0.070;
const legTopRadiusD = 0.055;

// Only ~800 particles in this narrow 0.08-unit zone — matches density of legs
for (let i = 0; i < 250; i++) {
  const y = rand(bifurcBot, bifurcTop);
  const blend = (y - bifurcBot) / (bifurcTop - bifurcBot); // 0=bottom(legs), 1=top(torso)

  const hipProfile = evalTorsoAt(Math.max(y, sections[0].y));
  const hipW = hipProfile ? hipProfile.w : 0.130;
  const hipD = hipProfile ? hipProfile.d : 0.090;

  const side = Math.random() < 0.5 ? -1 : 1;
  const joint = side === -1 ? 'l_hip' : 'r_hip';
  const angle = rand(0, Math.PI * 2);

  // Smoothly blend from torso ellipse (top) to two leg tubes (bottom)
  const cx = side * legTopCenterX;
  const legX = cx + legTopRadiusW * Math.cos(angle);
  const legZ = legTopRadiusD * Math.sin(angle);
  const torsoX = hipW * Math.cos(angle) * side;
  const torsoZ = hipD * Math.sin(angle);

  const x = lerp(legX, torsoX, blend);
  const z = lerp(legZ, torsoZ, blend);

  addPoint(x, y, z, joint, 0.12, COL.body);
}

// ══════════════════════════════════════════════════════════════
// LEGS — anatomical curvature
//
// Front view: S-curve silhouette (wide thigh → narrow knee → calf → ankle)
// Side view: thighs fuller at front (zShift +), calves at back (zShift -)
// Outer contour flows smoothly from hip with no discontinuity.
// ══════════════════════════════════════════════════════════════

type EllipseSection = {
  y: number;
  cx: number;   // X center
  rw: number;   // half-width (X)
  rd: number;   // half-depth (Z)
  zShift?: number; // front/back asymmetry: + = forward, - = backward
};

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
    const zs = catmullRom(
      secs[i0].zShift ?? 0, secs[i1].zShift ?? 0,
      secs[i2].zShift ?? 0, secs[i3].zShift ?? 0, t,
    );

    const angle = rand(0, Math.PI * 2);
    addPoint(cx + rw * Math.cos(angle), y, zs + rd * Math.sin(angle), jointId, 0.12, COL.body);
  }
}

for (const [side, hipJoint, kneeJoint, footJoint] of [
  [-1, 'l_hip', 'l_knee', 'l_foot'],
  [1, 'r_hip', 'r_knee', 'r_foot'],
] as const) {
  const topCX = side * legTopCenterX;
  const kneeX = side * 0.055;
  const ankleX = side * 0.055;
  const kneeY = -0.48;
  const ankleY = -0.86;

  // Thigh — widest just below hip, tapers to narrow knee
  // Side: fuller at front (positive zShift), neutral at knee
  // Leg center interpolates from ±0.060 (top) to ±0.08 (knee) — subtle outward angle
  const thighSections: EllipseSection[] = [
    { y: bifurcBot,                          cx: topCX,                       rw: 0.070,         rd: 0.055,         zShift: 0.005 },
    { y: lerp(bifurcBot, kneeY, 0.08), cx: lerp(topCX, kneeX, 0.08), rw: 0.075,         rd: 0.060,         zShift: 0.007 },
    { y: lerp(bifurcBot, kneeY, 0.20), cx: lerp(topCX, kneeX, 0.20), rw: 0.068,         rd: 0.055,         zShift: 0.005 },
    { y: lerp(bifurcBot, kneeY, 0.40), cx: lerp(topCX, kneeX, 0.40), rw: 0.058,         rd: 0.048,         zShift: 0.003 },
    { y: lerp(bifurcBot, kneeY, 0.60), cx: lerp(topCX, kneeX, 0.60), rw: 0.048,         rd: 0.040,         zShift: 0.002 },
    { y: lerp(bifurcBot, kneeY, 0.80), cx: lerp(topCX, kneeX, 0.80), rw: 0.038,         rd: 0.032,         zShift: 0.000 },
    { y: lerp(bifurcBot, kneeY, 0.92), cx: lerp(topCX, kneeX, 0.92), rw: 0.033,         rd: 0.028,         zShift: 0.000 },
    { y: kneeY,                              cx: kneeX,                      rw: 0.029,         rd: 0.026,         zShift: 0.000 },
  ];
  sampleEllipticalLimb(thighSections, 1100, hipJoint);

  // Calf — knee (narrow) → calf bulge (~1/3 down) → ankle taper
  // Side: calf muscle pushes backward (negative zShift)
  const calfSections: EllipseSection[] = [
    { y: kneeY,                          cx: kneeX,  rw: 0.029, rd: 0.026, zShift: 0.000 },
    { y: lerp(kneeY, ankleY, 0.12), cx: kneeX,  rw: 0.031, rd: 0.028, zShift: -0.003 },
    { y: lerp(kneeY, ankleY, 0.28), cx: kneeX,  rw: 0.034, rd: 0.031, zShift: -0.006 }, // calf peak
    { y: lerp(kneeY, ankleY, 0.42), cx: kneeX,  rw: 0.032, rd: 0.029, zShift: -0.005 },
    { y: lerp(kneeY, ankleY, 0.58), cx: kneeX,  rw: 0.026, rd: 0.024, zShift: -0.002 },
    { y: lerp(kneeY, ankleY, 0.75), cx: ankleX, rw: 0.021, rd: 0.019, zShift: -0.001 },
    { y: lerp(kneeY, ankleY, 0.90), cx: ankleX, rw: 0.016, rd: 0.014, zShift: 0.000 },
    { y: ankleY + 0.03,                 cx: ankleX, rw: 0.013, rd: 0.012, zShift: 0.000 },
  ];
  sampleEllipticalLimb(calfSections, 900, kneeJoint);

  // Feet
  const fx = side * 0.055;
  const fy = ankleY; // -0.86
  ellipsoid(fx, fy, 0, 0.017, 0.012, 0.017, 50, footJoint, 0.12, COL.body);
  ellipsoid(fx, fy - 0.015, 0.021, 0.017, 0.009, 0.033, 80, footJoint, 0.12, COL.body);
  ellipsoid(fx, fy - 0.009, -0.012, 0.012, 0.009, 0.012, 50, footJoint, 0.12, COL.dim);
  for (let t = 0; t < 5; t++) {
    const tx = fx - 0.008 + t * 0.004;
    const toeSize = t === 0 ? 0.005 : 0.004;
    ellipsoid(tx, fy - 0.018, 0.051 - Math.abs(t - 1) * 0.003, toeSize, toeSize, toeSize, 8, footJoint, 0.10, COL.highlight);
  }
}

// ══════════════════════════════════════════════════════════════
// ARMS — CatmullRom curve tube with varying radius
//
// The arm path starts INSIDE the torso and curves outward through
// the shoulder, creating a smooth rounded transition with no seams.
// Particles are sampled as rings along the curve with tapered radius.
// ══════════════════════════════════════════════════════════════

type Vec3 = [number, number, number];

/** Evaluate a CatmullRom spline of Vec3 control points at parameter t (0–1) */
function evalCurve(pts: Vec3[], t: number): Vec3 {
  const n = pts.length - 1;
  const seg = Math.min(Math.floor(t * n), n - 1);
  const lt = t * n - seg;
  const i0 = Math.max(0, seg - 1);
  const i1 = seg;
  const i2 = Math.min(n, seg + 1);
  const i3 = Math.min(n, seg + 2);
  return [
    catmullRom(pts[i0][0], pts[i1][0], pts[i2][0], pts[i3][0], lt),
    catmullRom(pts[i0][1], pts[i1][1], pts[i2][1], pts[i3][1], lt),
    catmullRom(pts[i0][2], pts[i1][2], pts[i2][2], pts[i3][2], lt),
  ];
}

/** Get tangent of curve at t by finite difference */
function curveTangent(pts: Vec3[], t: number): Vec3 {
  const dt = 0.001;
  const a = evalCurve(pts, Math.max(0, t - dt));
  const b = evalCurve(pts, Math.min(1, t + dt));
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return [dx / len, dy / len, dz / len];
}

/** Get perpendicular frame (normal + binormal) from tangent */
function perpFrame(tangent: Vec3): { n: Vec3; b: Vec3 } {
  // Pick a reference vector not parallel to tangent
  const ref: Vec3 = Math.abs(tangent[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  // binormal = tangent × ref (normalized)
  let bx = tangent[1] * ref[2] - tangent[2] * ref[1];
  let by = tangent[2] * ref[0] - tangent[0] * ref[2];
  let bz = tangent[0] * ref[1] - tangent[1] * ref[0];
  let bl = Math.sqrt(bx * bx + by * by + bz * bz) || 1;
  bx /= bl; by /= bl; bz /= bl;
  // normal = binormal × tangent
  const nx = by * tangent[2] - bz * tangent[1];
  const ny = bz * tangent[0] - bx * tangent[2];
  const nz = bx * tangent[1] - by * tangent[0];
  return { n: [nx, ny, nz], b: [bx, by, bz] };
}

// Arm radius along the curve (t=0 start inside torso, t=1 wrist)
// Control points: [t, radius]
const armRadiusProfile: [number, number][] = [
  [0.00, 0.025],  // inside torso (small, hidden)
  [0.08, 0.035],  // widening through shoulder
  [0.15, 0.040],  // shoulder peak (slim)
  [0.22, 0.038],  // past shoulder
  [0.30, 0.036],  // narrowing into upper arm
  [0.50, 0.034],  // upper arm
  [0.70, 0.030],  // forearm
  [0.85, 0.027],  // lower forearm
  [1.00, 0.024],  // wrist
];

function armRadiusAt(t: number): number {
  for (let i = 0; i < armRadiusProfile.length - 1; i++) {
    const [t0, r0] = armRadiusProfile[i];
    const [t1, r1] = armRadiusProfile[i + 1];
    if (t >= t0 && t <= t1) {
      const lt = (t - t0) / (t1 - t0);
      return r0 + (r1 - r0) * lt;
    }
  }
  return armRadiusProfile[armRadiusProfile.length - 1][1];
}

// Joint assignment along the curve
function armJointAt(t: number, shJoint: string, elJoint: string, haJoint: string): string {
  if (t < 0.55) return shJoint;   // shoulder to upper arm
  if (t < 0.70) return elJoint;   // elbow region
  return haJoint.replace('hand', 'elbow'); // forearm is elbow joint
  // Actually: shoulder joint owns upper arm, elbow joint owns forearm
}

for (const [side, shJoint, elJoint, haJoint] of [
  [-1, 'l_shoulder', 'l_elbow', 'l_hand'],
  [1, 'r_shoulder', 'r_elbow', 'r_hand'],
] as const) {
  // Arm path: starts inside torso, curves through shoulder, hangs down
  const armPath: Vec3[] = [
    [side * 0.060, 0.50, 0.00],   // inside torso near neck/shoulder
    [side * 0.095, 0.49, 0.00],   // curves outward through shoulder
    [side * 0.130, 0.475, 0.00],  // shoulder tip (barely past torso edge)
    [side * 0.140, 0.45, 0.00],   // drops down faster
    [side * 0.150, 0.40, 0.00],   // upper arm
    [side * 0.155, 0.34, 0.00],   // mid arm
    [side * 0.160, 0.27, 0.00],   // elbow
    [side * 0.160, 0.21, 0.00],   // upper forearm
    [side * 0.160, 0.14, 0.00],   // mid forearm
    [side * 0.160, 0.07, 0.00],   // wrist
  ];

  // Sample rings along the curve
  const numRings = 50;
  const totalParticles = 1050; // shoulder + upper arm + forearm combined
  const particlesPerRing = Math.ceil(totalParticles / numRings);

  for (let ring = 0; ring < numRings; ring++) {
    const t = ring / (numRings - 1);
    const center = evalCurve(armPath, t);
    const tangent = curveTangent(armPath, t);
    const { n, b } = perpFrame(tangent);
    const radius = armRadiusAt(t);

    // Determine joint
    let joint: string;
    if (t < 0.55) joint = shJoint;
    else if (t < 0.75) joint = elJoint;
    else joint = elJoint; // forearm still on elbow joint

    // Reduce density in torso-overlap zone (first 20% of arm curve)
    const ringCount = t < 0.20
      ? Math.ceil(particlesPerRing * 0.5)
      : particlesPerRing;

    for (let j = 0; j < ringCount; j++) {
      const angle = rand(0, Math.PI * 2);
      const r = radius * rand(0.85, 1.15);
      const px = center[0] + n[0] * Math.cos(angle) * r + b[0] * Math.sin(angle) * r;
      const py = center[1] + n[1] * Math.cos(angle) * r + b[1] * Math.sin(angle) * r;
      const pz = center[2] + n[2] * Math.cos(angle) * r + b[2] * Math.sin(angle) * r;

      // Use smaller size in overlap zone for less additive stacking
      const armSz = t < 0.20 ? 0.14 : 0.18;
      addPoint(px, py, pz, joint, armSz, COL.body);
    }
  }

  // Hand
  const hx = side * 0.160;
  const hy = 0.07;
  ellipsoid(hx, hy - 0.025, 0, 0.022, 0.030, 0.010, 60, haJoint, 0.10, COL.body);
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
        haJoint, 0.10, COL.highlight,
      );
    }
    addPoint(hx + f.dx * side, hy - 0.05 - f.len, 0, haJoint, 0.13, COL.bright);
  }
}

// ══════════════════════════════════════════════════════════════
// INTERNAL ORGANS — approximate anatomical placement
// Each organ uses a distinct color tag for debug mode identification.
// In normal rendering, the renderer treats all colors the same.
// ══════════════════════════════════════════════════════════════

// Breasts (distinct from general bust surface — tagged pink)
for (const side of [-1, 1]) {
  const bx = side * 0.045;
  for (let i = 0; i < 20; i++) {
    addPoint(bx + rand(-0.03, 0.03), rand(0.34, 0.42), rand(0.06, 0.10), 'chest', 0.12, COL.breast);
  }
}

// Heart (left-center chest)
for (let i = 0; i < 15; i++) {
  addPoint(rand(-0.03, 0.01), rand(0.36, 0.42), rand(-0.02, 0.03), 'chest', 0.10, COL.heart);
}

// Lungs (bilateral, inside chest)
for (const side of [-1, 1]) {
  for (let i = 0; i < 20; i++) {
    addPoint(side * rand(0.02, 0.06), rand(0.32, 0.44), rand(-0.03, 0.02), 'chest', 0.10, COL.lung);
  }
}

// Stomach (upper abdomen, slightly left)
for (let i = 0; i < 15; i++) {
  addPoint(rand(-0.03, 0.02), rand(0.20, 0.28), rand(-0.02, 0.03), 'spine', 0.10, COL.stomach);
}

// Intestines (mid-lower abdomen)
for (let i = 0; i < 25; i++) {
  addPoint(rand(-0.05, 0.05), rand(0.08, 0.20), rand(-0.03, 0.03), 'spine', 0.08, COL.intestine);
}

// Womb/Uterus (center pelvis)
for (let i = 0; i < 15; i++) {
  addPoint(rand(-0.02, 0.02), rand(0.02, 0.08), rand(-0.02, 0.02), 'root', 0.10, COL.womb);
}

// Ovaries (bilateral, above womb)
for (const side of [-1, 1]) {
  for (let i = 0; i < 8; i++) {
    addPoint(side * rand(0.03, 0.05), rand(0.06, 0.09), rand(-0.01, 0.01), 'root', 0.08, COL.ovary);
  }
}

// Fallopian tubes (connecting ovaries to uterus)
for (const side of [-1, 1]) {
  for (let i = 0; i < 10; i++) {
    const t = rand(0, 1);
    const fx = side * lerp(0.02, 0.04, t);
    const fy = lerp(0.06, 0.08, t);
    addPoint(fx, fy, rand(-0.01, 0.01), 'root', 0.06, COL.fallopian);
  }
}

// Cervix (below uterus)
for (let i = 0; i < 8; i++) {
  addPoint(rand(-0.01, 0.01), rand(0.00, 0.03), rand(-0.01, 0.01), 'root', 0.08, COL.cervix);
}

// Vagina (below cervix)
for (let i = 0; i < 10; i++) {
  addPoint(rand(-0.008, 0.008), rand(-0.04, 0.01), rand(0.01, 0.04), 'root', 0.06, COL.vagina);
}

// ══════════════════════════════════════════════════════════════
// NECK-TO-HEAD CONNECTOR
// ══════════════════════════════════════════════════════════════
const neckConnectorSecs: EllipseSection[] = [
  { y: 0.560, cx: 0, rw: 0.052, rd: 0.050 },
  { y: 0.575, cx: 0, rw: 0.050, rd: 0.050 },
  { y: 0.590, cx: 0, rw: 0.046, rd: 0.050 },
  { y: 0.597, cx: 0, rw: 0.027, rd: 0.036 },
  { y: 0.617, cx: 0, rw: 0.037, rd: 0.046 },
  { y: 0.650, cx: 0, rw: 0.032, rd: 0.038 },
];
for (let ni = 0; ni < 50; ni++) {
  const nyMin = neckConnectorSecs[neckConnectorSecs.length - 1].y;
  const nyMax = neckConnectorSecs[0].y;
  const ny = rand(nyMin, nyMax);
  let nIdx = 0;
  for (let s = 0; s < neckConnectorSecs.length - 1; s++) {
    if (ny <= neckConnectorSecs[s].y && ny >= neckConnectorSecs[s + 1].y) { nIdx = s; break; }
  }
  const nSeg = neckConnectorSecs[nIdx].y - neckConnectorSecs[nIdx + 1].y;
  const nt = nSeg === 0 ? 0 : (neckConnectorSecs[nIdx].y - ny) / nSeg;
  const nrw = lerp(neckConnectorSecs[nIdx].rw, neckConnectorSecs[nIdx + 1].rw, nt);
  const nrd = lerp(neckConnectorSecs[nIdx].rd, neckConnectorSecs[nIdx + 1].rd, nt);
  const na = rand(0, Math.PI * 2);
  const nx = nrw * Math.cos(na);
  const nz = nrd * Math.sin(na);
  if (ny > 0.615 && nz > 0.01) continue; // above jaw: back only
  addPoint(nx, ny, nz, 'head', 0.12, COL.body);
}

// ══════════════════════════════════════════════════════════════
// HEAD — Zone-based, ratio-measured from reference photos
// Center Y=0.70, halfH=0.095, range Y=0.605–0.795
// Top of skull is 83% of max width (wide dome, not pointy)
// ══════════════════════════════════════════════════════════════
const headCY = 0.70;
const headH = 0.095;

type HeadSection = { y: number; hw: number; hd: number };
const headProfile: HeadSection[] = [
  { y: 0.795, hw: 0.061, hd: 0.070 },  // top (×0.74)
  { y: 0.775, hw: 0.064, hd: 0.074 },  // upper cranium
  { y: 0.755, hw: 0.066, hd: 0.077 },  // forehead
  { y: 0.735, hw: 0.069, hd: 0.080 },  // brow
  { y: 0.715, hw: 0.073, hd: 0.081 },  // eye level (widest)
  { y: 0.695, hw: 0.073, hd: 0.080 },  // upper cheek
  { y: 0.675, hw: 0.071, hd: 0.078 },  // mid cheek
  { y: 0.655, hw: 0.064, hd: 0.071 },  // jaw angle
  { y: 0.640, hw: 0.052, hd: 0.061 },  // lower jaw
  { y: 0.617, hw: 0.037, hd: 0.046 },  // chin
  { y: 0.607, hw: 0.030, hd: 0.038 },  // below chin
  { y: 0.597, hw: 0.027, hd: 0.036 },  // bottom
];

function headProfileAt(y: number): { hw: number; hd: number } {
  if (y >= headProfile[0].y) return headProfile[0];
  if (y <= headProfile[headProfile.length - 1].y) return headProfile[headProfile.length - 1];
  for (let i = 0; i < headProfile.length - 1; i++) {
    if (y <= headProfile[i].y && y >= headProfile[i + 1].y) {
      const t = (headProfile[i].y - y) / (headProfile[i].y - headProfile[i + 1].y);
      return {
        hw: lerp(headProfile[i].hw, headProfile[i + 1].hw, t),
        hd: lerp(headProfile[i].hd, headProfile[i + 1].hd, t),
      };
    }
  }
  return headProfile[0];
}

/** Generate particles on head surface within Y band, filtered by arc */
function headZone(
  yMin: number, yMax: number, count: number, sz: number,
  color: string, arc: 'full' | 'front' | 'backOnly' | 'sidesOnly' | 'frontSides',
): void {
  for (let i = 0; i < count; i++) {
    const hy = rand(yMin, yMax);
    const prof = headProfileAt(hy);
    const ha = rand(0, Math.PI * 2);
    const hx = prof.hw * Math.cos(ha);
    const hz = prof.hd * Math.sin(ha);
    if (arc === 'front' && hz < -0.02) continue;
    if (arc === 'frontSides' && hz < -0.03) continue;
    if (arc === 'backOnly' && hz > 0) continue;
    if (arc === 'sidesOnly' && Math.abs(hx) < prof.hw * 0.4) continue;
    addPoint(hx, hy, hz, 'head', sz, color);
  }
}

// ════════ SKULL ZONES ════════
headZone(0.755, 0.795, 100, 0.18, COL.dim, 'full');        // cranium
headZone(0.735, 0.755, 75, 0.18, COL.dim, 'full');         // upper forehead
headZone(0.715, 0.735, 100, 0.18, COL.body, 'front');      // lower forehead
headZone(0.700, 0.720, 125, 0.18, COL.body, 'sidesOnly');  // temples
headZone(0.625, 0.795, 250, 0.18, COL.dim, 'backOnly');    // back skull

// ════════ CHEEK ZONES ════════
headZone(0.695, 0.715, 175, 0.18, COL.body, 'frontSides');  // upper cheek
headZone(0.675, 0.695, 200, 0.18, COL.body, 'frontSides');  // mid cheek
headZone(0.655, 0.675, 100, 0.18, COL.body, 'frontSides');  // lower cheek

// ════════ EYE ZONES (mirrored) ════════
for (const side of [-1, 1]) {
  const ecx = side * 0.034;
  const ecy = 0.707;
  const ecz = 0.108;

  // Eye socket (sparse hollow)
  for (let i = 0; i < 20; i++) {
    const ea = rand(0, Math.PI * 2);
    addPoint(ecx + 0.028 * Math.cos(ea) * rand(0.7, 1), ecy + 0.016 * Math.sin(ea) * rand(0.7, 1),
      ecz - 0.003, 'head', 0.12, COL.body);
  }
  // Eyeball — subtle
  for (let i = 0; i < 6; i++) {
    addPoint(ecx + rand(-0.008, 0.008), ecy + rand(-0.005, 0.005), ecz + rand(0, 0.004),
      'head', 0.14, '#70d8d0');
  }
  // Iris — subtle
  for (let i = 0; i < 4; i++) {
    addPoint(ecx + rand(-0.004, 0.004), ecy + rand(-0.003, 0.003), ecz + 0.004,
      'head', 0.16, '#80e8e0');
  }
  // Upper eyelid
  for (let i = 0; i < 12; i++) {
    const et = rand(-1, 1);
    addPoint(ecx + et * 0.022, ecy + 0.007 + (1 - et * et) * 0.003, ecz - 0.001,
      'head', 0.12, COL.body);
  }
  // Lower eyelid
  for (let i = 0; i < 10; i++) {
    const et = rand(-1, 1);
    addPoint(ecx + et * 0.020, ecy - 0.006 - (1 - et * et) * 0.002, ecz - 0.001,
      'head', 0.12, COL.body);
  }
}

// ════════ EYEBROW ZONES (mirrored) ════════
for (const side of [-1, 1]) {
  // Inner brow
  for (let i = 0; i < 10; i++) {
    const bt = rand(0, 1);
    addPoint(side * lerp(0.017, 0.028, bt) + rand(-0.003, 0.003),
      lerp(0.717, 0.719, bt) + rand(-0.002, 0.002), 0.106, 'head', 0.12, COL.body);
  }
  // Brow peak
  for (let i = 0; i < 12; i++) {
    const bt = rand(0, 1);
    addPoint(side * lerp(0.028, 0.039, bt) + rand(-0.004, 0.004),
      lerp(0.719, 0.721, bt) + rand(-0.002, 0.002), 0.106, 'head', 0.12, COL.body);
  }
  // Brow tail
  for (let i = 0; i < 8; i++) {
    const bt = rand(0, 1);
    addPoint(side * lerp(0.039, 0.050, bt) + rand(-0.002, 0.002),
      lerp(0.721, 0.715, bt) + rand(-0.002, 0.002), 0.106, 'head', 0.12, COL.body);
  }
}

// ════════ NOSE ZONES ════════
// Nose bridge — defined
for (let i = 0; i < 18; i++) {
  const nt = rand(0, 1);
  addPoint(rand(-0.002, 0.002), lerp(0.707, 0.685, nt), 0.112 + nt * 0.004, 'head', 0.12, COL.body);
}
// Nose body — defined
for (let i = 0; i < 20; i++) {
  const nt = rand(0, 1);
  const nw = lerp(0.003, 0.005, nt);
  addPoint(rand(-nw, nw), lerp(0.685, 0.672, nt), lerp(0.116, 0.120, nt), 'head', 0.12, COL.body);
}
// Nose tip — prominent
for (let i = 0; i < 12; i++) {
  const na = rand(0, Math.PI * 2);
  addPoint(0.006 * Math.cos(na), 0.670 + 0.006 * Math.sin(na), 0.128 + rand(-0.002, 0.002),
    'head', 0.12, COL.body);
}
// Nostrils — defined
for (const side of [-1, 1]) {
  for (let i = 0; i < 10; i++) {
    addPoint(side * 0.007 + rand(-0.003, 0.003), 0.672 + rand(-0.003, 0.003),
      0.112 + rand(-0.002, 0.002), 'head', 0.12, COL.body);
  }
}
// Philtrum
for (let i = 0; i < 8; i++) {
  const pt = rand(0, 1);
  addPoint(rand(-0.003, 0.003), lerp(0.670, 0.654, pt), 0.112, 'head', 0.12, COL.body);
}

// ════════ MOUTH ZONES ════════
// Upper lip (cupid's bow) — prominent, pushed forward
for (let i = 0; i < 40; i++) {
  const lt = rand(-1, 1);
  const bowDip = (1 - lt * lt) * 0.002;
  addPoint(lt * 0.022, 0.652 + 0.002 - bowDip + rand(-0.002, 0.002), 0.118 + rand(-0.001, 0.001),
    'head', 0.12, COL.highlight);
}
// Lower lip — prominent, pushed forward
for (let i = 0; i < 40; i++) {
  const lt = rand(-1, 1);
  const fullness = (1 - lt * lt) * 0.003;
  addPoint(lt * 0.021, 0.645 - fullness + rand(-0.002, 0.002), 0.117 + rand(-0.001, 0.001),
    'head', 0.12, COL.highlight);
}
// Mouth corners
for (const side of [-1, 1]) {
  for (let i = 0; i < 6; i++) {
    addPoint(side * 0.022 + rand(-0.003, 0.003), 0.650 + rand(-0.003, 0.003),
      0.102 + rand(-0.002, 0.002), 'head', 0.12, COL.body);
  }
}

// ════════ JAW ZONES ════════
headZone(0.640, 0.655, 60, 0.18, COL.body, 'frontSides');  // upper jaw
// Jawline (per side)
for (const side of [-1, 1]) {
  for (let i = 0; i < 12; i++) {
    const jt = rand(0, 1);
    const jx = side * lerp(0.081, 0.037, jt);
    const jy = lerp(0.675, 0.617, jt);
    const jp = headProfileAt(jy);
    addPoint(jx + rand(-0.005, 0.005), jy, jp.hd * 0.55 * (1 - jt * 0.3),
      'head', 0.12, COL.body);
  }
}
// Jaw underside
headZone(0.617, 0.640, 40, 0.18, COL.body, 'front');

// ════════ CHIN ZONES ════════
// Chin front
for (let i = 0; i < 50; i++) {
  addPoint(rand(-0.022, 0.022), 0.617 + rand(-0.006, 0.006), rand(0.055, 0.075),
    'head', 0.12, COL.body);
}
// Chin bottom
headZone(0.602, 0.617, 30, 0.18, COL.body, 'front');
// Chin to neck
headZone(0.597, 0.607, 40, 0.18, COL.body, 'front');

// ════════ EAR ZONES (mirrored) ════════
for (const side of [-1, 1]) {
  // Upper ear
  for (let i = 0; i < 8; i++) {
    addPoint(side * 0.083 + rand(-0.005, 0.005), 0.715 + rand(-0.012, 0.012),
      rand(-0.004, 0.004), 'head', 0.12, COL.body);
  }
  // Ear lobe
  for (let i = 0; i < 6; i++) {
    addPoint(side * 0.081 + rand(-0.004, 0.004), 0.697 + rand(-0.008, 0.008),
      rand(-0.003, 0.003), 'head', 0.12, COL.body);
  }
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
