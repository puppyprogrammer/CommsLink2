const { PrismaClient } = require('/app/prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = '41e022a6-e55d-4278-91b3-f39ed6979153'; // puppy
  const now = new Date();
  const records = [];

  for (let daysAgo = 365; daysAgo >= 0; daysAgo--) {
    const date = new Date(now.getTime() - daysAgo * 86400000);

    // Simulate varying daily usage — more on weekdays, spikes on some days
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const baseGrok = isWeekend ? 5 : 12;
    const baseEleven = isWeekend ? 2 : 5;

    // Random spikes
    const spike = Math.random() < 0.1 ? 3 + Math.random() * 5 : 1;

    // Generate 2-15 Grok transactions per day
    const grokCount = Math.floor(baseGrok * spike * (0.5 + Math.random()));
    for (let i = 0; i < grokCount; i++) {
      const hour = Math.floor(Math.random() * 16) + 8; // 8am-midnight
      const minute = Math.floor(Math.random() * 60);
      const txDate = new Date(date);
      txDate.setHours(hour, minute, Math.floor(Math.random() * 60));

      const inputTokens = 200 + Math.floor(Math.random() * 2000);
      const outputTokens = 100 + Math.floor(Math.random() * 1500);
      const cost = (inputTokens * 0.000005 + outputTokens * 0.000015) * 1.5;
      const credits = Math.max(1, Math.round(cost * 1000));

      records.push({
        user_id: userId,
        service: 'grok',
        model: Math.random() < 0.7 ? 'grok-4-1-fast-reasoning' : 'grok-4-1-fast-non-reasoning',
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        characters: null,
        raw_cost_usd: cost,
        credits_charged: credits,
        room_id: null,
        created_at: txDate,
      });
    }

    // Generate 0-8 ElevenLabs transactions per day
    const elevenCount = Math.floor(baseEleven * spike * (0.3 + Math.random() * 0.7));
    for (let i = 0; i < elevenCount; i++) {
      const hour = Math.floor(Math.random() * 16) + 8;
      const minute = Math.floor(Math.random() * 60);
      const txDate = new Date(date);
      txDate.setHours(hour, minute, Math.floor(Math.random() * 60));

      const chars = 50 + Math.floor(Math.random() * 300);
      const cost = chars * 0.00003 * 1.5;
      const credits = Math.max(1, Math.round(cost * 1000));

      records.push({
        user_id: userId,
        service: 'elevenlabs',
        model: 'eleven_multilingual_v2',
        input_tokens: null,
        output_tokens: null,
        characters: chars,
        raw_cost_usd: cost,
        credits_charged: credits,
        room_id: null,
        created_at: txDate,
      });
    }
  }

  console.log('Inserting', records.length, 'simulated usage records...');

  // Batch insert in chunks of 100
  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    await prisma.credit_usage_log.createMany({ data: chunk });
    if ((i / 100) % 10 === 0) console.log(`  ${i}/${records.length}...`);
  }

  console.log('Done! Inserted', records.length, 'records over 365 days.');
  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
