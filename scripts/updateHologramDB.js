// Update hologram_avatar skeleton + points in DB
// Run inside the API container: node /tmp/updateHologramDB.js

const { PrismaClient } = require('/app/prisma/client');
const fs = require('fs');

const prisma = new PrismaClient();

const skeleton = [
  { id: 'root',       position: [0, 0, 0],          parent_id: null },
  { id: 'spine',      position: [0, 0.20, 0],       parent_id: 'root' },
  { id: 'chest',      position: [0, 0.20, 0],       parent_id: 'spine' },
  { id: 'neck',       position: [0, 0.13, 0],       parent_id: 'chest' },
  { id: 'head',       position: [0, 0.09, 0],       parent_id: 'neck' },
  { id: 'l_shoulder', position: [-0.125, 0.08, 0],  parent_id: 'chest' },
  { id: 'r_shoulder', position: [0.125, 0.08, 0],   parent_id: 'chest' },
  { id: 'l_elbow',    position: [-0.035, -0.21, 0], parent_id: 'l_shoulder' },
  { id: 'r_elbow',    position: [0.035, -0.21, 0],  parent_id: 'r_shoulder' },
  { id: 'l_hand',     position: [0, -0.20, 0],      parent_id: 'l_elbow' },
  { id: 'r_hand',     position: [0, -0.20, 0],      parent_id: 'r_elbow' },
  { id: 'l_hip',      position: [-0.050, 0, 0],     parent_id: 'root' },
  { id: 'r_hip',      position: [0.050, 0, 0],      parent_id: 'root' },
  { id: 'l_knee',     position: [0, -0.44, 0],      parent_id: 'l_hip' },
  { id: 'r_knee',     position: [0, -0.44, 0],      parent_id: 'r_hip' },
  { id: 'l_foot',     position: [0, -0.44, 0],      parent_id: 'l_knee' },
  { id: 'r_foot',     position: [0, -0.44, 0],      parent_id: 'r_knee' },
];

async function main() {
  const pointsJson = fs.readFileSync('/tmp/hologram_body.json', 'utf-8');
  const points = JSON.parse(pointsJson);

  console.log('Points loaded:', points.length);

  // Find the avatar
  const avatars = await prisma.hologram_avatar.findMany();
  if (avatars.length === 0) {
    console.log('No avatars found!');
    return;
  }

  const avatar = avatars[0];
  console.log('Updating avatar:', avatar.id, avatar.label);

  await prisma.hologram_avatar.update({
    where: { id: avatar.id },
    data: {
      skeleton: skeleton,
      points: points,
    },
  });

  console.log('Done! Updated skeleton and points.');
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
