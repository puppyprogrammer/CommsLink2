/**
 * Generate a dense feminine humanoid point cloud for the hologram avatar.
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

// Color palette - holographic teal/cyan
const COLORS = {
  body: '#63c5c0',
  accent: '#4db8b3',
  highlight: '#7dd8d3',
  bright: '#a0f0ec',
  eye: '#ffffff',
  eyeGlow: '#80ffff',
  hair: '#4a9e9a',
  hairHighlight: '#5cbfba',
};

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pick<T>(...items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// Sample points on an ellipsoid surface
function ellipsoidSurface(
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
    // Add slight noise for organic feel
    const noise = 0.003;
    points.push({
      joint_id: jointId,
      offset: [
        x + rand(-noise, noise),
        y + rand(-noise, noise),
        z + rand(-noise, noise),
      ],
      size: size * rand(0.8, 1.2),
      color,
    });
  }
}

// Sample points on a cylinder surface
function cylinderSurface(
  cx: number, cyBase: number, cz: number,
  radius: number, height: number,
  count: number, jointId: string, size: number, color: string,
  radiusTop?: number,
): void {
  const rTop = radiusTop ?? radius;
  for (let i = 0; i < count; i++) {
    const t = rand(0, 1); // along height
    const angle = rand(0, Math.PI * 2);
    const r = radius + (rTop - radius) * t;
    const x = cx + r * Math.cos(angle);
    const y = cyBase + height * t;
    const z = cz + r * Math.sin(angle);
    const noise = 0.002;
    points.push({
      joint_id: jointId,
      offset: [x + rand(-noise, noise), y + rand(-noise, noise), z + rand(-noise, noise)],
      size: size * rand(0.8, 1.2),
      color,
    });
  }
}

// Sample points along a line/ring
function ring(
  cx: number, cy: number, cz: number,
  radius: number, count: number,
  jointId: string, size: number, color: string,
): void {
  for (let i = 0; i < count; i++) {
    const angle = rand(0, Math.PI * 2);
    const noise = 0.002;
    points.push({
      joint_id: jointId,
      offset: [
        cx + radius * Math.cos(angle) + rand(-noise, noise),
        cy + rand(-noise, noise),
        cz + radius * Math.sin(angle) + rand(-noise, noise),
      ],
      size: size * rand(0.8, 1.2),
      color,
    });
  }
}

// ══════════════════════════════════════════════
// HEAD (joint: head, offset relative to head joint)
// Head joint is at top of neck. Head extends upward.
// ══════════════════════════════════════════════

// Skull - main sphere
ellipsoidSurface(0, 0.1, 0, 0.09, 0.11, 0.09, 250, 'head', 0.6, COLORS.body);

// Face front - denser points on the front face area
ellipsoidSurface(0, 0.08, 0.05, 0.08, 0.09, 0.03, 120, 'head', 0.4, COLORS.highlight,
  -Math.PI / 3, Math.PI / 4, -Math.PI / 2, Math.PI / 2);

// Eyes - bright glowing points
// Left eye
ellipsoidSurface(-0.03, 0.1, 0.08, 0.015, 0.008, 0.005, 15, 'head', 0.5, COLORS.eyeGlow);
ellipsoidSurface(-0.03, 0.1, 0.085, 0.008, 0.005, 0.003, 8, 'head', 0.7, COLORS.eye);
// Right eye
ellipsoidSurface(0.03, 0.1, 0.08, 0.015, 0.008, 0.005, 15, 'head', 0.5, COLORS.eyeGlow);
ellipsoidSurface(0.03, 0.1, 0.085, 0.008, 0.005, 0.003, 8, 'head', 0.7, COLORS.eye);

// Eyebrows
for (let i = 0; i < 12; i++) {
  const t = rand(-1, 1);
  points.push({ joint_id: 'head', offset: [-0.03 + t * 0.02, 0.12, 0.08], size: 0.35, color: COLORS.accent });
  points.push({ joint_id: 'head', offset: [0.03 + t * 0.02, 0.12, 0.08], size: 0.35, color: COLORS.accent });
}

// Nose
for (let i = 0; i < 12; i++) {
  const t = rand(0, 1);
  points.push({
    joint_id: 'head',
    offset: [rand(-0.005, 0.005), 0.08 - t * 0.03, 0.09 + t * 0.01],
    size: 0.35,
    color: COLORS.highlight,
  });
}
// Nose tip
ellipsoidSurface(0, 0.05, 0.095, 0.008, 0.005, 0.005, 8, 'head', 0.4, COLORS.highlight);

// Lips
for (let i = 0; i < 20; i++) {
  const t = rand(-1, 1);
  const lipWidth = 0.025;
  // Upper lip
  points.push({
    joint_id: 'head',
    offset: [t * lipWidth, 0.035 + Math.abs(t) * 0.003, 0.085],
    size: 0.35, color: COLORS.bright,
  });
  // Lower lip
  points.push({
    joint_id: 'head',
    offset: [t * lipWidth, 0.028 - Math.abs(t) * 0.002, 0.083],
    size: 0.35, color: COLORS.bright,
  });
}

// Chin
ellipsoidSurface(0, 0.0, 0.06, 0.03, 0.02, 0.03, 25, 'head', 0.45, COLORS.body);

// Ears
// Left ear
ellipsoidSurface(-0.09, 0.09, 0.0, 0.015, 0.025, 0.01, 18, 'head', 0.35, COLORS.accent);
// Right ear
ellipsoidSurface(0.09, 0.09, 0.0, 0.015, 0.025, 0.01, 18, 'head', 0.35, COLORS.accent);

// ══════════════════════════════════════════════
// HAIR — flowing strands rendered in HologramViewer.
// Thin scalp coverage dots so head doesn't look bald.
// ══════════════════════════════════════════════

// Scalp coverage — thin layer on top/back of head
ellipsoidSurface(0, 0.18, -0.01, 0.10, 0.04, 0.10, 80, 'head', 0.4, COLORS.hair);
ellipsoidSurface(0, 0.16, -0.01, 0.11, 0.03, 0.11, 50, 'head', 0.45, COLORS.hairHighlight);

// ══════════════════════════════════════════════
// NECK (joint: neck)
// ══════════════════════════════════════════════
cylinderSurface(0, 0, 0, 0.035, 0.12, 60, 'neck', 0.5, COLORS.body);

// ══════════════════════════════════════════════
// CHEST / UPPER TORSO (joint: chest)
// ══════════════════════════════════════════════

// Upper chest - broad
ellipsoidSurface(0, 0, 0, 0.14, 0.1, 0.08, 200, 'chest', 0.65, COLORS.body);

// Collar bones
for (let i = 0; i < 20; i++) {
  const t = rand(-1, 1);
  points.push({
    joint_id: 'chest',
    offset: [t * 0.12, 0.08, 0.06 + rand(-0.01, 0.01)],
    size: 0.4, color: COLORS.highlight,
  });
}

// Bust area - feminine shape
ellipsoidSurface(-0.05, -0.02, 0.06, 0.05, 0.04, 0.04, 50, 'chest', 0.55, COLORS.body);
ellipsoidSurface(0.05, -0.02, 0.06, 0.05, 0.04, 0.04, 50, 'chest', 0.55, COLORS.body);

// ══════════════════════════════════════════════
// SPINE / MID TORSO (joint: spine)
// Narrower waist, feminine
// ══════════════════════════════════════════════

// Waist - narrower
ellipsoidSurface(0, 0.15, 0, 0.10, 0.12, 0.07, 150, 'spine', 0.6, COLORS.body);

// Lower back detail
ellipsoidSurface(0, 0.05, -0.05, 0.09, 0.08, 0.03, 40, 'spine', 0.5, COLORS.accent);

// ══════════════════════════════════════════════
// ROOT / HIPS / PELVIS (joint: root)
// Wider hips, feminine
// ══════════════════════════════════════════════

// Hip area - wider than waist
ellipsoidSurface(0, 0, 0, 0.13, 0.08, 0.09, 150, 'root', 0.6, COLORS.body);

// Glutes
ellipsoidSurface(-0.04, -0.02, -0.07, 0.06, 0.05, 0.04, 40, 'root', 0.55, COLORS.accent);
ellipsoidSurface(0.04, -0.02, -0.07, 0.06, 0.05, 0.04, 40, 'root', 0.55, COLORS.accent);

// ══════════════════════════════════════════════
// SHOULDERS (joints: l_shoulder, r_shoulder)
// ══════════════════════════════════════════════

// Shoulder caps
ellipsoidSurface(0, 0, 0, 0.04, 0.03, 0.04, 35, 'l_shoulder', 0.55, COLORS.body);
ellipsoidSurface(0, 0, 0, 0.04, 0.03, 0.04, 35, 'r_shoulder', 0.55, COLORS.body);

// Upper arms
cylinderSurface(0, 0, 0, 0.035, -0.2, 80, 'l_shoulder', 0.5, COLORS.body, 0.03);
cylinderSurface(0, 0, 0, 0.035, -0.2, 80, 'r_shoulder', 0.5, COLORS.body, 0.03);

// ══════════════════════════════════════════════
// ELBOWS / FOREARMS (joints: l_elbow, r_elbow)
// ══════════════════════════════════════════════

// Elbow joint
ellipsoidSurface(0, 0, 0, 0.03, 0.025, 0.03, 20, 'l_elbow', 0.5, COLORS.body);
ellipsoidSurface(0, 0, 0, 0.03, 0.025, 0.03, 20, 'r_elbow', 0.5, COLORS.body);

// Forearms - tapers to wrist
cylinderSurface(0, 0, 0, 0.03, -0.18, 70, 'l_elbow', 0.45, COLORS.body, 0.02);
cylinderSurface(0, 0, 0, 0.03, -0.18, 70, 'r_elbow', 0.45, COLORS.body, 0.02);

// ══════════════════════════════════════════════
// HANDS (joints: l_hand, r_hand)
// ══════════════════════════════════════════════

function generateHand(jointId: string): void {
  // Palm
  ellipsoidSurface(0, -0.02, 0, 0.025, 0.03, 0.012, 30, jointId, 0.35, COLORS.body);

  // Fingers - 5 per hand
  const fingerOffsets = [
    { x: -0.02, z: 0.005, len: 0.04 },   // pinky
    { x: -0.01, z: 0.005, len: 0.05 },   // ring
    { x: 0.0, z: 0.005, len: 0.055 },     // middle
    { x: 0.01, z: 0.005, len: 0.05 },     // index
    { x: 0.022, z: -0.005, len: 0.03 },   // thumb (angled out)
  ];

  for (const finger of fingerOffsets) {
    for (let i = 0; i < 8; i++) {
      const t = rand(0, 1);
      const r = 0.005 - t * 0.002; // taper
      const angle = rand(0, Math.PI * 2);
      points.push({
        joint_id: jointId,
        offset: [
          finger.x + r * Math.cos(angle),
          -0.04 - t * finger.len,
          finger.z + r * Math.sin(angle),
        ],
        size: 0.25,
        color: COLORS.highlight,
      });
    }
    // Fingertip
    points.push({
      joint_id: jointId,
      offset: [finger.x, -0.04 - finger.len, finger.z],
      size: 0.3,
      color: COLORS.bright,
    });
  }
}

generateHand('l_hand');
generateHand('r_hand');

// ══════════════════════════════════════════════
// UPPER LEGS / THIGHS (joints: l_hip, r_hip)
// ══════════════════════════════════════════════

// Thighs - fuller at top, taper to knee
cylinderSurface(0, 0, 0, 0.065, -0.33, 120, 'l_hip', 0.6, COLORS.body, 0.04);
cylinderSurface(0, 0, 0, 0.065, -0.33, 120, 'r_hip', 0.6, COLORS.body, 0.04);

// Inner thigh shaping
ellipsoidSurface(0.02, -0.1, 0, 0.03, 0.08, 0.04, 25, 'l_hip', 0.5, COLORS.accent);
ellipsoidSurface(-0.02, -0.1, 0, 0.03, 0.08, 0.04, 25, 'r_hip', 0.5, COLORS.accent);

// ══════════════════════════════════════════════
// LOWER LEGS / CALVES (joints: l_knee, r_knee)
// ══════════════════════════════════════════════

// Knee cap
ellipsoidSurface(0, 0, 0.03, 0.03, 0.025, 0.02, 20, 'l_knee', 0.5, COLORS.body);
ellipsoidSurface(0, 0, 0.03, 0.03, 0.025, 0.02, 20, 'r_knee', 0.5, COLORS.body);

// Calves - muscular curve
cylinderSurface(0, 0, 0, 0.04, -0.32, 100, 'l_knee', 0.55, COLORS.body, 0.025);
cylinderSurface(0, 0, 0, 0.04, -0.32, 100, 'r_knee', 0.55, COLORS.body, 0.025);

// Calf muscle bulge (back)
ellipsoidSurface(0, -0.08, -0.02, 0.025, 0.06, 0.025, 25, 'l_knee', 0.5, COLORS.accent);
ellipsoidSurface(0, -0.08, -0.02, 0.025, 0.06, 0.025, 25, 'r_knee', 0.5, COLORS.accent);

// ══════════════════════════════════════════════
// FEET (joints: l_foot, r_foot)
// ══════════════════════════════════════════════

function generateFoot(jointId: string): void {
  // Ankle area
  ellipsoidSurface(0, 0, 0, 0.025, 0.02, 0.025, 20, jointId, 0.45, COLORS.body);

  // Foot body - elongated
  ellipsoidSurface(0, -0.02, 0.04, 0.03, 0.015, 0.06, 50, jointId, 0.45, COLORS.body);

  // Heel
  ellipsoidSurface(0, -0.02, -0.02, 0.02, 0.015, 0.02, 15, jointId, 0.4, COLORS.accent);

  // Toes - 5 small bumps
  for (let t = 0; t < 5; t++) {
    const x = -0.02 + t * 0.01;
    const toeSize = t === 0 ? 0.008 : 0.006;
    ellipsoidSurface(x, -0.025, 0.09 - Math.abs(t - 1) * 0.005, toeSize, toeSize, toeSize, 5, jointId, 0.3, COLORS.highlight);
  }

  // Sole edge
  ring(0, -0.03, 0.03, 0.025, 15, jointId, 0.35, COLORS.accent);
}

generateFoot('l_foot');
generateFoot('r_foot');

// ══════════════════════════════════════════════
// OUTPUT
// ══════════════════════════════════════════════

// Round all offsets to 4 decimal places to reduce JSON size
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

// Count by joint
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
fs.writeFileSync(
  'scripts/hologram_body.json',
  JSON.stringify(cleaned, null, 0),
);
console.log('\nWritten to scripts/hologram_body.json');
console.log(`JSON size: ${(JSON.stringify(cleaned).length / 1024).toFixed(1)} KB`);
