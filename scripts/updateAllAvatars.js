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
  { id: 'l_hip',      position: [-0.040, -0.10, 0], parent_id: 'root' },
  { id: 'r_hip',      position: [0.040, -0.10, 0],  parent_id: 'root' },
  { id: 'l_knee',     position: [0, -0.38, 0],      parent_id: 'l_hip' },
  { id: 'r_knee',     position: [0, -0.38, 0],      parent_id: 'r_hip' },
  { id: 'l_foot',     position: [0, -0.38, 0],      parent_id: 'l_knee' },
  { id: 'r_foot',     position: [0, -0.38, 0],      parent_id: 'r_knee' },
];

async function main() {
  const points = JSON.parse(fs.readFileSync('/tmp/hologram_body.json', 'utf-8'));
  console.log('Points loaded:', points.length);

  const avatars = await prisma.hologram_avatar.findMany();
  console.log('Avatars found:', avatars.length);

  for (const avatar of avatars) {
    await prisma.hologram_avatar.update({
      where: { id: avatar.id },
      data: { skeleton, points },
    });
    console.log('Updated:', avatar.id, avatar.label);
  }

  console.log('All avatars updated!');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
