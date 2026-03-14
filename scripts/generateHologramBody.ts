/**
 * Generate a realistic feminine humanoid point cloud for the hologram avatar.
 * Uses cross-section interpolation for anatomically correct proportions.
 *
 * Run: npx ts-node scripts/generateHologramBody.ts
 * Output: scripts/hologram_body.json
 *
 * Skeleton world positions (default pose):
 *   root:       [0, 0.9, 0]
 *   spine:      [0, 1.05, 0]
 *   chest:      [0, 1.2, 0]
 *   neck:       [0, 1.3, 0]
 *   head:       [0, 1.45, 0]
 *   l_shoulder: [-0.18, 1.2, 0]   r_shoulder: [0.18, 1.2, 0]
 *   l_elbow:    [-0.43, 1.2, 0]   r_elbow:    [0.43, 1.2, 0]
 *   l_hand:     [-0.65, 1.2, 0]   r_hand:     [0.65, 1.2, 0]
 *   l_hip:      [-0.1, 0.9, 0]    r_hip:      [0.1, 0.9, 0]
 *   l_knee:     [-0.1, 0.5, 0]    r_knee:     [0.1, 0.5, 0]
 *   l_foot:     [-0.1, 0.1, 0]    r_foot:     [0.1, 0.1, 0]
 *
 * Total figure height ~1.55 units (feet at 0.1, head top at ~1.65).
 * All point offsets are relative to their assigned joint.
 */

type Point = {
  joint_id: string;
  offset: [number, number, number];
  size: number;
  color: string;
};

const points: Point[] = [];

// ── Scale factor ──
// Spec uses h=2.0 for full figure. Our figure is ~1.55 units tall.
const H = 1.55;
const S = H / 2.0; // multiply spec widths by this to match our skeleton scale

// ── Color palette ──
const C = {
  body: '#4dd8d0',
  bodyDim: '#3ab8b0',
  highlight: '#7eeae5',
  contour: '#5cc8c2',
  eye: '#ffffff',
  eyeGlow: '#80ffff',
  bright: '#a0f0ec',
  lip: '#6de0da',
};

// ── Joint world positions (default pose) ──
const JOINTS: Record<string, [number, number, number]> = {
  root: [0, 0.9, 0],
  spine: [0, 1.05, 0],
  chest: [0, 1.2, 0],
  neck: [0, 1.3, 0],
  head: [0, 1.45, 0],
  l_shoulder: [-0.18, 1.2, 0],
  r_shoulder: [0.18, 1.2, 0],
  l_elbow: [-0.43, 1.2, 0],
  r_elbow: [0.43, 1.2, 0],
  l_hand: [-0.65, 1.2, 0],
  r_hand: [0.65, 1.2, 0],
  l_hip: [-0.1, 0.9, 0],
  r_hip: [0.1, 0.9, 0],
  l_knee: [-0.1, 0.5, 0],
  r_knee: [0.1, 0.5, 0],
  l_foot: [-0.1, 0.1, 0],
  r_foot: [0.1, 0.1, 0],
};

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Add a point at world position, converting to joint-relative offset */
function addPoint(worldX: number, worldY: number, worldZ: number, jointId: string, size: number, color: string): void {
  const j = JOINTS[jointId];
  const noise = 0.002;
  points.push({
    joint_id: jointId,
    offset: [worldX - j[0] + rand(-noise, noise), worldY - j[1] + rand(-noise, noise), worldZ - j[2] + rand(-noise, noise)],
    size,
    color,
  });
}

/** Sample points on an ellipsoid surface centered at world coordinates */
function ellipsoid(
  cx: number, cy: number, cz: number,
  rx: number, ry: number, rz: number,
  count: number, jointId: string, size: number, color: string,
  latMin = -Math.PI / 2, latMax = Math.PI / 2,
  lonMin = 0, lonMax = Math.PI * 2,
): void {
  for (let i = 0; i < count; i++) {
    const lat = rand(latMin, latMax);
    const lon = rand(lonMin, lonMax);
    const x = cx + rx * Math.cos(lat) * Math.cos(lon);
    const y = cy + ry * Math.sin(lat);
    const z = cz + rz * Math.cos(lat) * Math.sin(lon);
    addPoint(x, y, z, jointId, size * rand(0.85, 1.15), color);
  }
}

/** Sample points on a tapered cylinder (world coordinates) */
function cylinder(
  cx: number, yBase: number, cz: number,
  rBottom: number, rTop: number, height: number,
  count: number, jointId: string, size: number, color: string,
  depthBottom?: number, depthTop?: number,
): void {
  const dBot = depthBottom ?? rBottom;
  const dTop = depthTop ?? rTop;
  for (let i = 0; i < count; i++) {
    const t = rand(0, 1);
    const angle = rand(0, Math.PI * 2);
    const rW = lerp(rBottom, rTop, t);
    const rD = lerp(dBot, dTop, t);
    const x = cx + rW * Math.cos(angle);
    const y = yBase + height * t;
    const z = cz + rD * Math.sin(angle);
    addPoint(x, y, z, jointId, size * rand(0.85, 1.15), color);
  }
}

// ══════════════════════════════════════════════════════════════
// TORSO — Cross-section interpolation approach
// Define elliptical cross-sections at key Y heights, interpolate between them
// ══════════════════════════════════════════════════════════════

type CrossSection = {
  y: number;       // world Y
  width: number;   // half-width (X radius)
  depth: number;   // half-depth (Z radius)
  jointId: string;
};

// Using spec proportions scaled to our skeleton
// Spec Y positions are ratios of h=2.0, our feet are at ~0.1, head top at ~1.65
// worldY = 0.1 + ratio * H
function specY(ratio: number): number {
  return 0.1 + ratio * H;
}

const torsoSections: CrossSection[] = [
  // Crotch level
  { y: specY(0.50), width: 0.21 * S / 2, depth: 0.15 * S / 2, jointId: 'root' },
  // Hip bone (widest)
  { y: specY(0.58), width: 0.21 * S / 2, depth: 0.15 * S / 2, jointId: 'root' },
  // Navel
  { y: specY(0.63), width: 0.18 * S / 2, depth: 0.13 * S / 2, jointId: 'spine' },
  // Natural waist (narrowest)
  { y: specY(0.66), width: 0.145 * S / 2, depth: 0.12 * S / 2, jointId: 'spine' },
  // Under-bust / ribcage
  { y: specY(0.71), width: 0.17 * S / 2, depth: 0.12 * S / 2, jointId: 'chest' },
  // Bust line
  { y: specY(0.75), width: 0.20 * S / 2, depth: 0.14 * S / 2, jointId: 'chest' },
  // Armpit
  { y: specY(0.78), width: 0.19 * S / 2, depth: 0.13 * S / 2, jointId: 'chest' },
  // Shoulder line
  { y: specY(0.82), width: 0.22 * S / 2, depth: 0.10 * S / 2, jointId: 'chest' },
  // Neck base / collarbone
  { y: specY(0.84), width: 0.12 * S / 2, depth: 0.08 * S / 2, jointId: 'neck' },
];

// Interpolate cross-sections and sample surface points
function sampleTorso(particleCount: number): void {
  for (let i = 0; i < particleCount; i++) {
    // Random Y within torso range
    const y = rand(torsoSections[0].y, torsoSections[torsoSections.length - 1].y);

    // Find surrounding cross-sections
    let lower = torsoSections[0];
    let upper = torsoSections[torsoSections.length - 1];
    for (let s = 0; s < torsoSections.length - 1; s++) {
      if (y >= torsoSections[s].y && y <= torsoSections[s + 1].y) {
        lower = torsoSections[s];
        upper = torsoSections[s + 1];
        break;
      }
    }

    const t = upper.y === lower.y ? 0 : (y - lower.y) / (upper.y - lower.y);
    const hw = lerp(lower.width, upper.width, t);
    const hd = lerp(lower.depth, upper.depth, t);

    // Determine joint from whichever cross-section is closer
    const jointId = t < 0.5 ? lower.jointId : upper.jointId;

    // Sample on ellipse surface
    const angle = rand(0, Math.PI * 2);
    const x = hw * Math.cos(angle);
    const z = hd * Math.sin(angle);

    // Vary particle density — denser at contour edges (sides, front)
    const isContour = Math.abs(Math.sin(angle)) > 0.7 || Math.cos(angle) > 0.5;
    const color = isContour ? C.contour : C.body;
    const size = isContour ? 0.5 : 0.55;

    addPoint(x, y, z, jointId, size, color);
  }
}

sampleTorso(5000);

// ── Bust volumes (separate hemispherical additions) ──
const bustY = specY(0.75);
const bustSpacing = 0.045 * S; // half of center-to-center
const bustForward = 0.14 * S / 2 + 0.035 * S; // ribcage depth + projection
const bustRadius = 0.03 * S;

for (const side of [-1, 1]) {
  const cx = side * bustSpacing;
  // Teardrop shape: fuller at bottom, soft hemisphere
  for (let i = 0; i < 400; i++) {
    const phi = rand(0, Math.PI); // only front hemisphere
    const theta = rand(0, Math.PI * 2);
    const r = bustRadius * (1 + 0.3 * Math.sin(phi)); // fuller at bottom

    const bx = cx + r * Math.sin(phi) * Math.cos(theta) * 0.8;
    const by = bustY + r * Math.cos(phi) * 0.9 - 0.005; // slight droop
    const bz = bustForward + r * Math.sin(phi) * Math.sin(theta) * 0.6;

    addPoint(bx, by, bz, 'chest', 0.45, C.body);
  }
}

// ── Glutes ──
const gluteY = specY(0.52);
for (const side of [-1, 1]) {
  ellipsoid(
    side * 0.04, gluteY, -0.15 * S / 2 - 0.01,
    0.05 * S, 0.04 * S, 0.035 * S,
    300, 'root', 0.45, C.bodyDim,
  );
}

// ══════════════════════════════════════════════════════════════
// NECK
// ══════════════════════════════════════════════════════════════
const neckBase = specY(0.84);
const neckTop = specY(0.875); // chin level
const neckW = 0.055 * S / 2;
cylinder(0, neckBase, 0, neckW, neckW * 0.9, neckTop - neckBase, 300, 'neck', 0.45, C.body, neckW, neckW * 0.9);

// ══════════════════════════════════════════════════════════════
// HEAD
// Head joint at [0, 1.45, 0]. Head center ~0.1 above joint.
// ══════════════════════════════════════════════════════════════
const headJY = 1.45;
const headCY = headJY + 0.08; // center of head volume
const headW = 0.085 * S / 2;   // half-width
const headD = 0.095 * S / 2;   // half-depth
const headH = 0.11 * S / 2;    // half-height

// Skull — main ellipsoid (lower part, upper covered by hair)
ellipsoid(0, headCY, 0, headW, headH, headD, 600, 'head', 0.45, C.body,
  -Math.PI / 2, Math.PI / 5); // stop below crown for hair

// Face front — denser points
ellipsoid(0, headCY - 0.01, headD * 0.6, headW * 0.85, headH * 0.8, headD * 0.25,
  500, 'head', 0.35, C.highlight,
  -Math.PI / 3, Math.PI / 4, -Math.PI / 2, Math.PI / 2);

// Jawline — soft contour from ears to chin
for (let i = 0; i < 80; i++) {
  const t = rand(-1, 1); // -1 = left ear, 0 = chin, 1 = right ear
  const angle = t * Math.PI * 0.45;
  const r = headW * 0.95;
  const x = r * Math.sin(angle);
  const y = headCY - headH * 0.65 + Math.abs(t) * headH * 0.2;
  const z = headD * 0.7 * Math.cos(angle);
  addPoint(x, y, z, 'head', 0.35, C.contour);
}

// Cheekbones
for (const side of [-1, 1]) {
  ellipsoid(
    side * headW * 0.7, headCY + headH * 0.1, headD * 0.55,
    0.015, 0.01, 0.01, 40, 'head', 0.35, C.highlight,
  );
}

// Eyes — bright glowing
const eyeY = headCY + headH * 0.15;
const eyeSpacing = headW * 0.45;
const eyeZ = headD * 0.85;
for (const side of [-1, 1]) {
  // Eye socket outline
  ellipsoid(side * eyeSpacing, eyeY, eyeZ, 0.014, 0.007, 0.004, 20, 'head', 0.45, C.eyeGlow);
  // Bright iris/pupil
  ellipsoid(side * eyeSpacing, eyeY, eyeZ + 0.003, 0.006, 0.004, 0.002, 12, 'head', 0.65, C.eye);
}

// Eyebrows
for (const side of [-1, 1]) {
  for (let i = 0; i < 18; i++) {
    const t = rand(-1, 1);
    const x = side * eyeSpacing + t * 0.018;
    const y = eyeY + 0.012 + (1 - t * t) * 0.003; // slight arch
    addPoint(x, y, eyeZ - 0.002, 'head', 0.3, C.contour);
  }
}

// Nose
const noseTopY = eyeY - 0.005;
const noseTipY = headCY - headH * 0.15;
for (let i = 0; i < 25; i++) {
  const t = rand(0, 1);
  const y = lerp(noseTopY, noseTipY, t);
  const z = eyeZ + t * 0.012;
  const width = 0.003 + t * 0.005;
  addPoint(rand(-width, width), y, z, 'head', 0.3, C.highlight);
}
// Nose tip / nostrils
ellipsoid(0, noseTipY, eyeZ + 0.01, 0.008, 0.005, 0.005, 15, 'head', 0.35, C.highlight);

// Lips
const mouthY = headCY - headH * 0.35;
const lipWidth = eyeSpacing * 0.9;
for (let i = 0; i < 40; i++) {
  const t = rand(-1, 1);
  // Upper lip — cupid's bow
  const bowOffset = (1 - t * t) * 0.002;
  addPoint(t * lipWidth, mouthY + 0.003 + bowOffset, eyeZ - 0.002, 'head', 0.35, C.lip);
  // Lower lip — fuller
  addPoint(t * lipWidth * 0.9, mouthY - 0.003 - (1 - t * t) * 0.002, eyeZ - 0.003, 'head', 0.35, C.lip);
}

// Chin
const chinY = headCY - headH * 0.7;
ellipsoid(0, chinY, headD * 0.5, 0.02, 0.015, 0.015, 40, 'head', 0.4, C.body);

// Ears
for (const side of [-1, 1]) {
  ellipsoid(side * headW * 0.95, headCY + headH * 0.05, 0, 0.008, 0.018, 0.008, 30, 'head', 0.3, C.bodyDim);
}

// ══════════════════════════════════════════════════════════════
// SHOULDERS & UPPER ARMS
// ══════════════════════════════════════════════════════════════
for (const [side, joint] of [[-1, 'l_shoulder'], [1, 'r_shoulder']] as const) {
  const sx = side * 0.18;
  const sy = 1.2;

  // Shoulder cap — smooth dome
  ellipsoid(sx, sy, 0, 0.04, 0.03, 0.035, 200, joint, 0.45, C.body);

  // Upper arm — tapered cylinder going down
  const armLen = 0.25; // distance to elbow
  const uaTop = 0.05 * S / 2;
  const uaBot = 0.04 * S / 2;
  cylinder(sx + side * armLen / 2, sy - armLen / 2, 0, uaBot, uaTop, armLen, 400, joint, 0.4, C.body);
}

// ══════════════════════════════════════════════════════════════
// FOREARMS
// ══════════════════════════════════════════════════════════════
for (const [side, joint] of [[-1, 'l_elbow'], [1, 'r_elbow']] as const) {
  const ex = side * 0.43;
  const ey = 1.2;

  // Elbow joint
  ellipsoid(ex, ey, 0, 0.025, 0.02, 0.025, 100, joint, 0.4, C.body);

  // Forearm — tapered
  const faLen = 0.22;
  const faTop = 0.04 * S / 2;
  const faBot = 0.03 * S / 2;
  cylinder(ex + side * faLen / 2, ey - faLen / 2, 0, faBot, faTop, faLen, 350, joint, 0.4, C.body);
}

// ══════════════════════════════════════════════════════════════
// HANDS
// ══════════════════════════════════════════════════════════════
function generateHand(jointId: string, cx: number, cy: number): void {
  // Palm
  ellipsoid(cx, cy - 0.02, 0, 0.02, 0.025, 0.008, 80, jointId, 0.3, C.body);

  // Fingers
  const fingers = [
    { dx: -0.015, len: 0.035 },  // pinky
    { dx: -0.007, len: 0.04 },   // ring
    { dx: 0.0, len: 0.045 },     // middle
    { dx: 0.008, len: 0.04 },    // index
    { dx: 0.018, len: 0.025 },   // thumb (shorter, angled)
  ];

  for (const f of fingers) {
    for (let i = 0; i < 12; i++) {
      const t = rand(0, 1);
      const r = 0.004 * (1 - t * 0.4);
      const angle = rand(0, Math.PI * 2);
      addPoint(
        cx + f.dx + r * Math.cos(angle),
        cy - 0.04 - t * f.len,
        r * Math.sin(angle),
        jointId, 0.2, C.highlight,
      );
    }
    // Fingertip
    addPoint(cx + f.dx, cy - 0.04 - f.len, 0, jointId, 0.25, C.bright);
  }
}

generateHand('l_hand', -0.65, 1.2);
generateHand('r_hand', 0.65, 1.2);

// ══════════════════════════════════════════════════════════════
// LEGS — Thighs (l_hip / r_hip joints)
// ══════════════════════════════════════════════════════════════
for (const [side, joint] of [[-1, 'l_hip'], [1, 'r_hip']] as const) {
  const lx = side * 0.1;
  const hipY = 0.9;
  const kneeY = 0.5;
  const thighLen = hipY - kneeY; // 0.4

  // Thigh — tapered, elliptical cross-section (wider side-to-side)
  const thighTopW = 0.10 * S / 2;
  const thighBotW = 0.06 * S / 2;
  const thighTopD = thighTopW * 0.85;
  const thighBotD = thighBotW * 0.85;

  for (let i = 0; i < 800; i++) {
    const t = rand(0, 1);
    const y = hipY - t * thighLen;
    const rW = lerp(thighTopW, thighBotW, t);
    const rD = lerp(thighTopD, thighBotD, t);
    const angle = rand(0, Math.PI * 2);
    const x = lx + rW * Math.cos(angle);
    const z = rD * Math.sin(angle);
    addPoint(x, y, z, joint, 0.5, C.body);
  }
}

// ══════════════════════════════════════════════════════════════
// LOWER LEGS — Calves (l_knee / r_knee joints)
// ══════════════════════════════════════════════════════════════
for (const [side, joint] of [[-1, 'l_knee'], [1, 'r_knee']] as const) {
  const lx = side * 0.1;
  const kneeY = 0.5;
  const ankleY = 0.12;
  const calfLen = kneeY - ankleY;

  // Knee cap
  ellipsoid(lx, kneeY, 0.025, 0.025, 0.02, 0.02, 80, joint, 0.4, C.body);

  // Calf — with muscle bulge at back
  const calfTopW = 0.055 * S / 2;
  const calfBotW = 0.035 * S / 2;

  for (let i = 0; i < 600; i++) {
    const t = rand(0, 1);
    const y = kneeY - t * calfLen;
    const rW = lerp(calfTopW, calfBotW, t);
    // Calf muscle bulge: peaks at t=0.25 at the back
    const bulgeExp = ((t - 0.25) / 0.15);
    const bulgeFactor = Math.exp(-(bulgeExp * bulgeExp)) * 0.01;
    const angle = rand(0, Math.PI * 2);
    const x = lx + rW * Math.cos(angle);
    const zR = rW + (Math.sin(angle) < -0.3 ? bulgeFactor : 0);
    const z = zR * Math.sin(angle);
    addPoint(x, y, z, joint, 0.45, C.body);
  }
}

// ══════════════════════════════════════════════════════════════
// FEET
// ══════════════════════════════════════════════════════════════
function generateFoot(jointId: string, cx: number, cy: number): void {
  // Ankle
  ellipsoid(cx, cy, 0, 0.02, 0.015, 0.02, 60, jointId, 0.35, C.body);

  // Foot body — elongated ellipsoid
  ellipsoid(cx, cy - 0.018, 0.035, 0.025, 0.012, 0.05, 120, jointId, 0.35, C.body);

  // Heel
  ellipsoid(cx, cy - 0.015, -0.02, 0.015, 0.012, 0.015, 40, jointId, 0.3, C.bodyDim);

  // Toes
  for (let t = 0; t < 5; t++) {
    const tx = cx - 0.015 + t * 0.008;
    const toeLen = t === 0 ? 0.007 : 0.005;
    ellipsoid(tx, cy - 0.02, 0.08 - Math.abs(t - 1) * 0.004, toeLen, toeLen, toeLen, 8, jointId, 0.25, C.highlight);
  }
}

generateFoot('l_foot', -0.1, 0.1);
generateFoot('r_foot', 0.1, 0.1);

// ══════════════════════════════════════════════════════════════
// Collarbone detail — horizontal structural line
// ══════════════════════════════════════════════════════════════
const collarY = specY(0.84);
for (let i = 0; i < 60; i++) {
  const t = rand(-1, 1);
  const x = t * 0.22 * S / 2;
  const y = collarY + rand(-0.005, 0.005);
  const z = 0.08 * S / 2 * (1 - Math.abs(t) * 0.3);
  addPoint(x, y, z, 'chest', 0.35, C.highlight);
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
