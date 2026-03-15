const { PrismaClient } = require('/app/prisma/client');
const prisma = new PrismaClient();

async function main() {
  const kara = await prisma.llm_agent.findFirst({ where: { name: 'Kara' } });
  if (!kara) { console.log('Kara not found'); return; }

  let mems = kara.memories;
  if (typeof mems === 'string') mems = JSON.parse(mems);
  if (!Array.isArray(mems)) { console.log('Not array:', typeof mems); return; }

  console.log('Before:', mems.length, 'memories');

  const badPatterns = [/PPO/i, /hologram.*evo/i, /GA.*v2\.0/i, /evo.*v4/i, /hologram.*debug.*next/i, /hologram.*bug/i, /hologram.*render/i, /hologram.*decoherence/i, /VISUAL VERIFICATION/i, /Hologram \{look/i, /HOLOGRAM VISUAL/i, /Memory cleanup 2026/i, /Puppy requested debug/i, /hologram_samples/i];

  const kept = mems.filter(m => {
    if (m.locked) {
      if (m.text && m.text.includes('Premium subscriptions')) {
        m.text = 'REVENUE MODEL: Credit system. Users buy credit packs, credits consumed by AI features. All features available to all users, no premium tier.';
      }
      return true;
    }
    return !badPatterns.some(p => p.test(m.text || ''));
  });

  console.log('After:', kept.length, 'memories');
  console.log('Removed:', mems.length - kept.length);

  // Use raw query to avoid Prisma serialization issues
  const jsonStr = JSON.stringify(kept);
  await prisma.$executeRaw`UPDATE llm_agent SET memories = ${jsonStr} WHERE name = 'Kara'`;

  console.log('Done! Updated via raw query.');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
