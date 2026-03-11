import Data from "../../data";
import grokAdapter from "../../adapters/grok";
import creditActions from "../credit";

const SUMMARIZATION_MODEL = "grok-3-mini";
const CHUNK_SIZE = 20; // messages per L1
const L1_PER_L2 = 5;
const L2_PER_L3 = 10;

// In-memory lock to prevent concurrent summarization per room
const activeLocks = new Set<string>();

/** Callback to send a system message to the room chat. */
type NotifyFn = (text: string) => void;
const noop: NotifyFn = () => {};

const LEVEL_NAMES: Record<number, string> = {
  1: "chunk",
  2: "episode",
  3: "era",
  4: "master",
};

const generateRefName = (level: number, date: Date, seq: number): string => {
  const d = date.toISOString().slice(0, 10).replace(/-/g, "");
  return `l${level}-${d}-${String(seq).padStart(3, "0")}`;
};

const summarizeMessages = async (
  messages: Array<{ username: string; content: string; created_at: Date }>,
): Promise<string> => {
  const transcript = messages
    .map((m) => `[${m.username}]: ${m.content}`)
    .join("\n");

  const systemPrompt =
    "You are a summarization assistant. Summarize the following chat messages into a concise paragraph. " +
    "Preserve key facts, user names, topics discussed, decisions made, and notable events. " +
    "Be concise but thorough. Do not add commentary.";

  const result = await grokAdapter.chatCompletion(
    systemPrompt,
    [{ role: "user", content: transcript }],
    SUMMARIZATION_MODEL,
  );
  return result.text;
};

const summarizeChildSummaries = async (
  children: Array<{ ref_name: string; content: string }>,
  level: number,
): Promise<string> => {
  const combined = children
    .map((c) => `[ref:${c.ref_name}]\n${c.content}`)
    .join("\n\n");

  const levelName = LEVEL_NAMES[level] || "summary";
  const systemPrompt =
    `You are a summarization assistant. Combine the following summaries into one ${levelName}-level summary. ` +
    "Preserve the [ref:xxx] reference tags so they can be used later to retrieve specific details. " +
    "Be concise but preserve key facts, user names, and important events.";

  const result = await grokAdapter.chatCompletion(
    systemPrompt,
    [{ role: "user", content: combined }],
    SUMMARIZATION_MODEL,
  );
  return result.text;
};

const triggerSummarization = async (
  roomId: string,
  creatorId: string,
  notify: NotifyFn = noop,
  verbose = false,
): Promise<void> => {
  if (activeLocks.has(roomId)) return;
  activeLocks.add(roomId);

  try {
    // L1: chunk 20 unsummarized messages
    const unsummarizedCount = await Data.message.countUnsummarized(roomId);
    if (unsummarizedCount < CHUNK_SIZE) {
      if (verbose) {
        notify(`[Memory] ${unsummarizedCount} unsummarized messages (need ${CHUNK_SIZE} to create a summary)`);
      }
      return;
    }

    const messages = await Data.message.findUnsummarized(roomId, CHUNK_SIZE);
    if (messages.length < CHUNK_SIZE) return;

    // Check credits before proceeding
    const hasCredits = await creditActions.hasCredits(creatorId);
    if (!hasCredits) {
      if (verbose) {
        notify("[Memory] Cannot summarize — room creator has no credits");
      }
      return;
    }

    notify("[Memory] Summarizing last 20 messages...");

    const content = await summarizeMessages(messages);

    // Generate unique ref name
    const existingL1s = await Data.memorySummary.findByRoomAndLevel(roomId, 1);
    const seq = existingL1s.length + 1;
    const refName = generateRefName(1, messages[0].created_at, seq);

    await Data.memorySummary.create({
      room_id: roomId,
      ref_name: refName,
      level: 1,
      content,
      msg_start: messages[0].created_at,
      msg_end: messages[messages.length - 1].created_at,
      messages_covered: messages.length,
    });

    await Data.message.markSummarized(messages.map((m) => m.id));

    // Charge for the summarization call
    creditActions
      .chargeGrokUsage(creatorId, SUMMARIZATION_MODEL, 0, 0, roomId)
      .catch(console.error);

    notify(`[Memory] Chunk summary created: ${refName}`);
    console.log(`[Memory] Created L1 summary ${refName} for room ${roomId}`);

    // Check rollups
    await checkRollup(roomId, creatorId, notify);
  } catch (err) {
    console.error(`[Memory] Summarization error for room ${roomId}:`, err);
  } finally {
    activeLocks.delete(roomId);
  }
};

const checkRollup = async (
  roomId: string,
  creatorId: string,
  notify: NotifyFn,
): Promise<void> => {
  // L1 → L2: every 5 orphan L1s
  const orphanL1s = await Data.memorySummary.findOrphansByLevel(roomId, 1);
  if (orphanL1s.length >= L1_PER_L2) {
    const batch = orphanL1s.slice(0, L1_PER_L2);

    const hasCredits = await creditActions.hasCredits(creatorId);
    if (!hasCredits) return;

    notify("[Memory] Building episode summary...");

    const content = await summarizeChildSummaries(batch, 2);
    const existingL2s = await Data.memorySummary.findByRoomAndLevel(roomId, 2);
    const refName = generateRefName(
      2,
      batch[0].msg_start,
      existingL2s.length + 1,
    );

    const l2 = await Data.memorySummary.create({
      room_id: roomId,
      ref_name: refName,
      level: 2,
      content,
      msg_start: batch[0].msg_start,
      msg_end: batch[batch.length - 1].msg_end,
      messages_covered: batch.reduce((sum, s) => sum + s.messages_covered, 0),
    });

    await Data.memorySummary.setParent(
      batch.map((s) => s.id),
      l2.id,
    );
    creditActions
      .chargeGrokUsage(creatorId, SUMMARIZATION_MODEL, 0, 0, roomId)
      .catch(console.error);

    notify(`[Memory] Episode summary created: ${refName}`);
    console.log(`[Memory] Created L2 summary ${refName} for room ${roomId}`);
  }

  // L2 → L3: every 10 orphan L2s
  const orphanL2s = await Data.memorySummary.findOrphansByLevel(roomId, 2);
  if (orphanL2s.length >= L2_PER_L3) {
    const batch = orphanL2s.slice(0, L2_PER_L3);

    const hasCredits = await creditActions.hasCredits(creatorId);
    if (!hasCredits) return;

    notify("[Memory] Building era summary...");

    const content = await summarizeChildSummaries(batch, 3);
    const existingL3s = await Data.memorySummary.findByRoomAndLevel(roomId, 3);
    const refName = generateRefName(
      3,
      batch[0].msg_start,
      existingL3s.length + 1,
    );

    const l3 = await Data.memorySummary.create({
      room_id: roomId,
      ref_name: refName,
      level: 3,
      content,
      msg_start: batch[0].msg_start,
      msg_end: batch[batch.length - 1].msg_end,
      messages_covered: batch.reduce((sum, s) => sum + s.messages_covered, 0),
    });

    await Data.memorySummary.setParent(
      batch.map((s) => s.id),
      l3.id,
    );
    creditActions
      .chargeGrokUsage(creatorId, SUMMARIZATION_MODEL, 0, 0, roomId)
      .catch(console.error);

    notify(`[Memory] Era summary created: ${refName}`);
    console.log(`[Memory] Created L3 summary ${refName} for room ${roomId}`);

    // Regenerate master (L4) whenever a new L3 appears
    await regenerateMaster(roomId, creatorId, notify);
  }
};

const regenerateMaster = async (
  roomId: string,
  creatorId: string,
  notify: NotifyFn,
): Promise<void> => {
  const hasCredits = await creditActions.hasCredits(creatorId);
  if (!hasCredits) return;

  const allL3s = await Data.memorySummary.findByRoomAndLevel(roomId, 3);
  if (allL3s.length === 0) return;

  notify("[Memory] Rebuilding master summary...");

  const content = await summarizeChildSummaries(allL3s, 4);

  // Replace existing master
  await Data.memorySummary.deleteMasterByRoom(roomId);
  await Data.memorySummary.create({
    room_id: roomId,
    ref_name: "master",
    level: 4,
    content,
    msg_start: allL3s[0].msg_start,
    msg_end: allL3s[allL3s.length - 1].msg_end,
    messages_covered: allL3s.reduce((sum, s) => sum + s.messages_covered, 0),
  });

  creditActions
    .chargeGrokUsage(creatorId, SUMMARIZATION_MODEL, 0, 0, roomId)
    .catch(console.error);

  notify("[Memory] Master summary updated");
  console.log(`[Memory] Regenerated master summary for room ${roomId}`);
};

export default { triggerSummarization };
