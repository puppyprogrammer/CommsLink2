const { PrismaClient } = require('/app/prisma/client');
const prisma = new PrismaClient();

async function main() {
  const kara = await prisma.llm_agent.findFirst({ where: { name: 'Kara' } });
  if (!kara) { console.log('Kara not found'); return; }

  let mems = kara.memories;
  if (typeof mems === 'string') mems = JSON.parse(mems);
  if (!Array.isArray(mems)) { console.log('memories is not an array:', typeof mems); return; }

  console.log('Total memories:', mems.length);

  const badPatterns = [/PPO/i, /hologram.*evo/i, /GA.*v2\.0/i, /evo.*v4/i, /hologram.*debug.*next/i, /hologram.*bug/i, /hologram.*render.*bug/i, /hologram.*decoherence/i, /VISUAL VERIFICATION/i, /Hologram \{look/i, /HOLOGRAM VISUAL/i, /Memory cleanup 2026/i, /Puppy requested debug/i, /hologram_samples\.json/i];

  const kept = [];
  const removed = [];
  for (const m of mems) {
    const t = m.text || '';
    const isBad = !m.locked && badPatterns.some(p => p.test(t));
    if (isBad) {
      removed.push(t.substring(0, 100));
    } else {
      // Fix outdated premium memory
      if (t.includes('Premium subscriptions via Stripe')) {
        m.text = 'REVENUE MODEL: Credit system. Users buy credit packs (10/20/50 USD), credits consumed by AI features (Grok chat, ElevenLabs TTS, Claude Code sessions). 1 credit = $0.001. All features available to all users, no premium tier.';
      }
      kept.push(m);
    }
  }

  console.log('Removed', removed.length, 'memories:');
  removed.forEach(r => console.log('  -', r));
  console.log('Kept', kept.length, 'memories');

  await prisma.llm_agent.update({
    where: { id: kara.id },
    data: { memories: kept },
  });
  console.log('Done! Updated Kara memories.');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
