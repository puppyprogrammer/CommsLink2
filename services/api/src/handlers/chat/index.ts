import { Server as SocketServer, Socket } from "socket.io";
import { readFileSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

import Data from "../../../../../core/data";
import jwtHelper from "../../../../../core/helpers/jwt";
import passwordHelper from "../../../../../core/helpers/password";
import broadcastMessageAction from "../../../../../core/actions/chat/broadcastMessageAction";
import creditActions from "../../../../../core/actions/credit";
import grokAdapter, {
  type ToolDefinition,
} from "../../../../../core/adapters/grok";
import claudeAdapter from "../../../../../core/adapters/claude";
import voiceQueue from "../../../../../core/adapters/redis/voiceQueue";
import summarizeAction from "../../../../../core/actions/memory/summarizeAction";
import prisma from "../../../../../core/adapters/prisma";
import dayjs from "../../../../../core/lib/dayjs";

import terminalSecurity from "../../../../../core/adapters/terminalSecurity";

import type { JwtPayload } from "../../../../../core/helpers/jwt";
import type {
  ConnectedUser,
  ActiveRoom,
  RoomListItem,
} from "../../../../../core/interfaces/room";
import type { IncomingMessage } from "../../../../../core/interfaces/message";

// Extend Socket type to include user data
type AuthenticatedSocket = Socket & { user: JwtPayload };

// Expected agent version — set via AGENT_VERSION env var or read from package.json
let expectedAgentVersion = process.env.AGENT_VERSION || "unknown";
if (expectedAgentVersion === "unknown") {
  try {
    const pkgPath = join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "..",
      "packages",
      "terminal-agent",
      "package.json",
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expectedAgentVersion = pkg.version || "unknown";
  } catch {
    /* ignore */
  }
}

// In-memory state
const connectedUsers = new Map<string, ConnectedUser>();
const activeRooms = new Map<string, ActiveRoom>();
const memoryMsgCounters = new Map<string, number>(); // per-room msg counter for throttled summarization

// Agent message dedup: Map<roomId:agentId, Array<{text, timestamp}>>
const agentRecentMessages = new Map<
  string,
  Array<{ text: string; ts: number }>
>();

// Autopilot watermark: tracks the newest message ID an agent has processed per room
const agentWatermarks = new Map<string, string>(); // key: roomId:agentId -> messageId

// Subconscious systems: cycle counters and coherence scores
const agentCycleCounters = new Map<string, number>(); // agentId -> cycle count since last subconscious run
const agentCoherenceScores = new Map<string, number>(); // agentId -> 1-10 coherence score
const agentIntentScores = new Map<string, number>(); // agentId -> 1-10 intent alignment score
const INTENT_COHERENCE_CYCLE_OFFSET = 3; // Offset from memory coherence (runs on cycle 3, 8, 13... vs memory on 5, 10, 15...)

// Subconscious: Prompt Quality Gate
const agentPromptGateScores = new Map<string, number>(); // agentId -> last gate score
const agentPromptGateResults = new Map<string, string>(); // agentId -> last gate feedback message

// Subconscious: Action Repetition Detector
const agentActionHistory = new Map<
  string,
  Array<{ cmd: string; ts: number }>
>(); // agentId -> ring buffer of recent commands
const agentRepetitionAlerts = new Map<string, string>(); // agentId -> current alert message
const REPETITION_BUFFER_SIZE = 20;
const REPETITION_THRESHOLD = 3; // same command N times = alert
const REPETITION_WINDOW = 6; // check last N entries

// Subconscious: Social Awareness
const userLastSpoke = new Map<string, number>(); // "roomId:userId" -> timestamp ms

// Subconscious: Task Tracker
type TrackedClaudeTask = {
  id: string;
  prompt: string; // first 200 chars
  machine: string;
  agentId: string;
  roomName: string;
  status: "pending" | "completed" | "timeout";
  sentAt: number;
  completedAt?: number;
  responseSummary?: string;
  announced: boolean;
};
const agentClaudeTasks = new Map<string, TrackedClaudeTask[]>(); // agentId -> tasks (max 20 FIFO)
const agentTaskTrackerSummary = new Map<string, string>(); // agentId -> latest summary for prompt injection

// Subconscious: Learning Extraction
const agentLastLearningExtraction = new Map<string, number>(); // agentId -> last extraction timestamp
const agentLastLesson = new Map<string, string>(); // agentId -> last lesson text
const LEARNING_EXTRACTION_COOLDOWN = 10 * 60_000; // 10 minutes

/**
 * Route a chatCompletion call to the correct adapter based on model ID.
 * Claude models (claude-*) go to the Anthropic API; everything else goes to Grok (xAI).
 */
const routedChatCompletion: typeof grokAdapter.chatCompletion = (
  systemPrompt,
  messages,
  model,
  maxTokens,
  tools,
  toolChoice,
) => {
  if (model && model.startsWith("claude-")) {
    return claudeAdapter.chatCompletion(
      systemPrompt,
      messages,
      model,
      maxTokens,
      tools,
      toolChoice,
    );
  }
  return grokAdapter.chatCompletion(
    systemPrompt,
    messages,
    model,
    maxTokens,
    tools,
    toolChoice,
  );
};

const trigramSimilarity = (a: string, b: string): number => {
  const trigrams = (s: string): Set<string> => {
    const t = new Set<string>();
    const n = s.toLowerCase().replace(/\s+/g, " ").trim();
    for (let i = 0; i < n.length - 2; i++) t.add(n.slice(i, i + 3));
    return t;
  };
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  ta.forEach((t) => {
    if (tb.has(t)) overlap++;
  });
  return overlap / Math.max(ta.size, tb.size);
};

const isDuplicateAgentMessage = (
  roomId: string,
  agentId: string,
  content: string,
): boolean => {
  const key = `${roomId}:${agentId}`;
  const now = Date.now();

  let entries = agentRecentMessages.get(key) || [];
  // Evict entries older than 5 minutes (was 30 — too aggressive)
  entries = entries.filter((e) => now - e.ts < 300_000);

  // Only catch near-exact duplicates (>0.8 similarity), not just similar greetings
  const isDup = entries.some((e) => trigramSimilarity(e.text, content) > 0.8);
  if (!isDup) {
    entries.push({ text: content, ts: now });
    if (entries.length > 10) entries = entries.slice(-10);
  }
  agentRecentMessages.set(key, entries);
  return isDup;
};

// Pending terminal command approvals: approvalId -> resolver
type PendingApproval = {
  resolve: (approved: boolean) => void;
  command: string;
  machineName: string;
  agentName: string;
  creatorId: string;
  roomName: string;
  timeout: ReturnType<typeof setTimeout>;
};
const pendingApprovals = new Map<string, PendingApproval>();

// Pending screenshot requests from AI {look} commands
const pendingScreenshots = new Map<
  string,
  {
    resolve: (data: { base64: string; mimeType: string } | null) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

/**
 * Execute a terminal command on a connected machine via Socket.IO.
 * Returns the command output or error string.
 */
/**
 * Check if a machine's socket is actually connected. If not, mark it offline in DB
 * and emit a system message so AI agents know the machine is gone.
 */
const checkAndCleanStaleMachine = async (
  io: SocketServer,
  machineSocketId: string,
  machineName: string,
  roomName?: string,
): Promise<void> => {
  const sock = io.sockets.sockets.get(machineSocketId);
  if (!sock) {
    // Socket is gone — mark offline in DB
    await Data.machine
      .setOfflineBySocketId(machineSocketId)
      .catch(console.error);
    console.log(
      `[StaleMachine] Marked "${machineName}" offline (socket ${machineSocketId} gone)`,
    );
    if (roomName) {
      emitSystemMessage(
        io,
        roomName,
        `[System] Machine "${machineName}" is no longer connected. It has been marked offline.`,
      );
    }
  }
};

const executeTerminalCommand = (
  io: SocketServer,
  machineSocketId: string,
  command: string,
  timeoutMs = 30_000,
  machineName?: string,
  roomName?: string,
): Promise<string> => {
  return new Promise((resolve) => {
    const execId = `exec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const machineSocket = io.sockets.sockets.get(machineSocketId);

    if (!machineSocket) {
      if (machineName)
        checkAndCleanStaleMachine(io, machineSocketId, machineName, roomName);
      resolve("Error: Machine is not connected.");
      return;
    }

    const timer = setTimeout(() => {
      machineSocket.off(`terminal_output:${execId}`, handler);
      if (machineName)
        checkAndCleanStaleMachine(io, machineSocketId, machineName, roomName);
      resolve("Error: Command timed out after 30 seconds.");
    }, timeoutMs);

    const handler = (data: { output: string; exitCode: number }) => {
      clearTimeout(timer);
      resolve(data.output.substring(0, 4000));
    };

    machineSocket.once(`terminal_output:${execId}`, handler);
    machineSocket.emit("terminal_exec", { execId, command });
  });
};

/**
 * Execute a Claude Code prompt on a connected machine via Socket.IO.
 * Routes through the running interactive PTY session instead of spawning a new process.
 * The terminal agent accumulates output and returns when Claude goes idle.
 */
const executeClaudePrompt = (
  io: SocketServer,
  machineSocketId: string,
  sessionKey: string,
  prompt: string,
  roomName: string,
  agentName: string,
  timeoutMs = 900_000,
  approved = false,
  machineName?: string,
): Promise<string> => {
  return new Promise((resolve) => {
    const execId = `claude-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const machineSocket = io.sockets.sockets.get(machineSocketId);

    if (!machineSocket) {
      if (machineName)
        checkAndCleanStaleMachine(io, machineSocketId, machineName, roomName);
      resolve("Error: Machine is not connected.");
      return;
    }

    let done = false;

    const cleanup = () => {
      done = true;
    };

    const timer = setTimeout(() => {
      cleanup();
      machineSocket.off(`claude_pty_response:${execId}`, handler);
      if (machineName)
        checkAndCleanStaleMachine(io, machineSocketId, machineName, roomName);
      resolve("Error: Claude prompt timed out after 15 minutes.");
    }, timeoutMs);

    const handler = (data: { output: string; exitCode: number }) => {
      cleanup();
      clearTimeout(timer);
      console.log(
        `[claude_prompt] Got claude_pty_response for ${execId}: ${data.output.length} chars, exit=${data.exitCode}`,
      );
      // Post Claude's response as a system message so AI and room can see it
      emitSystemMessage(
        io,
        roomName,
        `[Claude ${agentName} response]:\n${data.output.substring(0, 4000)}`,
        undefined,
        "claude-response",
      );
      emitPanelLog(
        io,
        roomName,
        "claude",
        "response",
        data.output.substring(0, 4000),
        machineName || "unknown",
      );
      resolve(data.output.substring(0, 16000));
    };

    machineSocket.once(`claude_pty_response:${execId}`, handler);

    // Inject project context preamble so Claude reads docs before making changes
    const preamble = `IMPORTANT: Before making any code changes, read CLAUDE.md, CLAUDEBackend.md, and CLAUDEFrontend.md in the project root for coding standards. Always run the build/compile check after editing files to catch errors before responding.\n\n`;

    // Route through the PTY with collectResponse mode
    machineSocket.emit("claude_session_input", {
      sessionKey,
      input: preamble + prompt,
      approved,
      collectResponse: true,
      execId,
    });
  });
};

// ┌──────────────────────────────────────────┐
// │ Room Helpers                             │
// └──────────────────────────────────────────┘

const validateRoomName = (name: string): boolean => {
  if (!name || typeof name !== "string") return false;
  if (name.length < 3 || name.length > 30) return false;
  return /^[a-zA-Z0-9 ]+$/.test(name);
};

const getRoomList = (): RoomListItem[] =>
  Array.from(activeRooms.entries()).map(([name, room]) => ({
    id: room.id,
    name,
    displayName: room.displayName,
    users: room.users.size,
    hasPassword: !!room.passwordHash,
    isPublic: false,
    createdBy: room.createdBy,
  }));

/**
 * Get room list filtered for a specific user (only rooms they are a member of, plus public).
 *
 * @param userId - User UUID.
 * @returns Filtered room list.
 */
const getRoomListForUser = async (userId: string): Promise<RoomListItem[]> => {
  const memberships = await Data.roomMember.findByUser(userId);
  const memberRoomIds = new Set(
    memberships.filter((m) => m.role !== "banned").map((m) => m.room_id),
  );
  const allRooms = getRoomList();
  return allRooms.filter((r) => memberRoomIds.has(r.id));
};

/**
 * Broadcast room_list_update to each connected socket with their own filtered view.
 *
 * @param io - Socket.IO server instance.
 */
const broadcastRoomListUpdate = async (io: SocketServer): Promise<void> => {
  // Cache per-user to avoid duplicate DB calls for multi-tab users
  const userCache = new Map<string, RoomListItem[]>();
  for (const [socketId, userData] of connectedUsers.entries()) {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    let filtered = userCache.get(userData.userId);
    if (!filtered) {
      filtered = await getRoomListForUser(userData.userId);
      userCache.set(userData.userId, filtered);
    }
    sock.emit("room_list_update", { rooms: filtered });
  }
};

/**
 * Move a user to their first available room, or emit no_rooms if they have none.
 * Used when kicked, banned, or room deleted.
 */
const sendToFallbackRoom = async (
  io: SocketServer,
  socketId: string,
  userId: string,
): Promise<void> => {
  const targetSocket = io.sockets.sockets.get(socketId);
  if (!targetSocket) return;
  const u = connectedUsers.get(socketId);
  if (!u) return;

  // Find first available room membership
  const memberships = await Data.roomMember.findByUser(userId);
  const validMembership = memberships.find((m) => {
    if (m.role === "banned") return false;
    // Check room is active
    for (const [, room] of activeRooms.entries()) {
      if (room.id === m.room_id) return true;
    }
    return false;
  });

  if (validMembership) {
    // Find room name from ID
    let fallbackName = "";
    for (const [name, room] of activeRooms.entries()) {
      if (room.id === validMembership.room_id) {
        fallbackName = name;
        break;
      }
    }
    if (fallbackName) {
      targetSocket.join(fallbackName);
      const room = activeRooms.get(fallbackName);
      if (room) room.users.add(socketId);
      u.currentRoom = fallbackName;
      const roomId = getRoomId(fallbackName);
      if (roomId) {
        const history = await Data.message.findByRoomForUI(roomId);
        targetSocket.emit("room_joined", {
          roomName: room?.displayName || fallbackName,
          users: getRoomUsers(fallbackName),
          messages: formatHistoryForClient(history.reverse()),
        });
      }
      return;
    }
  }

  // No rooms available — tell frontend to redirect
  u.currentRoom = "";
  targetSocket.emit("no_rooms");
};

const getRoomUsers = (roomName: string): ConnectedUser[] => {
  const room = activeRooms.get(roomName);
  if (!room) return [];

  // room.users contains socket IDs; deduplicate by userId for display
  const seen = new Set<string>();
  const result: ConnectedUser[] = [];
  for (const socketId of room.users) {
    const u = connectedUsers.get(socketId);
    if (u && !seen.has(u.userId)) {
      seen.add(u.userId);
      result.push(u);
    }
  }
  return result;
};

/** Find the first connected socket entry for a given user ID. */
const findByUserId = (userId: string): ConnectedUser | undefined => {
  for (const u of connectedUsers.values()) {
    if (u.userId === userId) return u;
  }
  return undefined;
};

/** Get the room UUID for a given room name key. */
const getRoomId = (roomName: string): string | undefined => {
  return activeRooms.get(roomName)?.id;
};

/** Emit a panel_log event to the room AND persist to database. */
const emitPanelLog = (
  io: SocketServer,
  roomName: string,
  tab: "terminal" | "claude",
  entryType: string,
  text: string,
  machine?: string,
): void => {
  io.to(roomName).emit("panel_log", { tab, type: entryType, text, machine });
  const roomId = getRoomId(roomName);
  if (roomId) {
    Data.panelLog
      .create({
        room_id: roomId,
        tab,
        entry_type: entryType,
        text: text.substring(0, 8000),
        machine,
      })
      .catch(() => {});
  }
};

const leaveCurrentRoom = (socket: AuthenticatedSocket): void => {
  const user = connectedUsers.get(socket.id);
  if (!user?.currentRoom) return;

  const oldRoom = activeRooms.get(user.currentRoom);
  if (oldRoom) {
    oldRoom.users.delete(socket.id);
    socket.leave(user.currentRoom);
  }
};

const joinRoom = async (
  socket: AuthenticatedSocket,
  roomName: string,
): Promise<boolean> => {
  const normalizedName = roomName.toLowerCase();
  const room = activeRooms.get(normalizedName);
  if (!room) return false;

  leaveCurrentRoom(socket);

  room.users.add(socket.id);
  socket.join(normalizedName);

  const user = connectedUsers.get(socket.id);
  if (user) {
    user.currentRoom = normalizedName;
  }

  return true;
};


/** Format DB message records for the client, adding isSystem flag for system messages. */
const formatHistoryForClient = (
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> =>
  messages.map((m) => ({
    id: m.id,
    sender: m.username,
    text: m.content,
    timestamp: (m.created_at as Date)?.toISOString?.() ?? m.created_at,
    type: m.type,
    ...(m.type === "system" ? { isSystem: true } : {}),
    ...(m.type === "image" ? { imageUrl: m.content } : {}),
    ...(m.type === "ai" ? { isAI: true } : {}),
  }));

const emitSystemMessage = (
  io: SocketServer,
  roomName: string,
  text: string,
  collapsible?: string,
  systemType?: string,
): void => {
  const msgId = `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  io.to(roomName).emit("chat_message", {
    id: msgId,
    sender: "System",
    text,
    timestamp: new Date().toISOString(),
    isSystem: true,
    ...(collapsible ? { collapsible } : {}),
    ...(systemType ? { systemType } : {}),
  });

  // Persist so system messages survive restart and appear in AI context
  const roomId = getRoomId(roomName);
  if (roomId) {
    Data.message
      .create({
        content: text,
        type: "system",
        room_id: roomId,
        author_id: null,
        username: "System",
      })
      .catch(console.error);
  }
};

// ┌──────────────────────────────────────────┐
// │ Room Persistence                        │
// └──────────────────────────────────────────┘

const loadPersistedRooms = async (): Promise<void> => {
  // Load all rooms from DB into memory
  const dbRooms = await Data.room.findAll();
  for (const room of dbRooms) {
    if (!activeRooms.has(room.name)) {
      activeRooms.set(room.name, {
        id: room.id,
        users: new Set<string>(),
        passwordHash: room.password_hash,
        displayName: room.display_name,
        createdBy: room.created_by,
      });
    }
  }

  console.log(`Loaded ${dbRooms.length} rooms from database`);
};

// ┌──────────────────────────────────────────┐
// │ Shared: Agent Response Logic            │
// └──────────────────────────────────────────┘

type ListItem = { text: string; locked: boolean };

/** Parse a JSON TEXT column into ListItem[]. Handles plain string arrays (legacy) and object arrays. */
const parseJsonList = (raw: string | null): ListItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown) => {
        if (typeof item === "string") return { text: item, locked: false };
        if (item && typeof item === "object" && "text" in item) {
          const obj = item as { text: string; locked?: boolean };
          return { text: obj.text, locked: !!obj.locked };
        }
        return { text: String(item), locked: false };
      });
    }
  } catch {
    /* legacy single string */
  }
  return raw.trim() ? [{ text: raw.trim(), locked: false }] : [];
};

/** Convert ListItem[] to display strings for prompt building. Locked items get [LOCKED] prefix. */
const listItemsToStrings = (items: ListItem[], markLocked = true): string[] => {
  // Sort locked items first (they take priority)
  const sorted = [...items].sort(
    (a, b) => (b.locked ? 1 : 0) - (a.locked ? 1 : 0),
  );
  return sorted.map((i) =>
    markLocked && i.locked ? `[LOCKED] ${i.text}` : i.text,
  );
};

// ── Task system types & helpers ──

type TaskItem = {
  id: string;
  text: string;
  priority: number;
  status: "pending" | "done";
  locked: boolean;
};

const generateTaskId = (): string => Math.random().toString(36).slice(2, 8);

const parseTaskList = (raw: string | null): TaskItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown) => {
        if (item && typeof item === "object" && "text" in item) {
          const obj = item as Record<string, unknown>;
          return {
            id: String(obj.id || generateTaskId()),
            text: String(obj.text),
            priority: typeof obj.priority === "number" ? obj.priority : 3,
            status: (obj.status === "done"
              ? "done"
              : "pending") as TaskItem["status"],
            locked: !!obj.locked,
          };
        }
        return {
          id: generateTaskId(),
          text: String(item),
          priority: 3,
          status: "pending" as const,
          locked: false,
        };
      });
    }
  } catch {
    /* corrupted */
  }
  return [];
};

const formatTasksForPrompt = (tasks: TaskItem[]): string[] => {
  const sorted = [...tasks].sort((a, b) => a.priority - b.priority);
  return sorted.map((t) => {
    const lock = t.locked ? " [LOCKED]" : "";
    const statusTag = t.status === "done" ? "[DONE]" : "[PENDING]";
    return `${statusTag} (P${t.priority}) [${t.id}] ${t.text}${lock}`;
  });
};

type AgentLike = {
  id: string;
  name: string;
  room_id: string;
  creator_id: string;
  voice_id: string;
  model: string;
  system_instructions: string | null;
  memories: string | null;
  autopilot_enabled: boolean;
  autopilot_interval: number;
  autopilot_prompts: string | null;
  plan: string | null;
  tasks: string | null;
  max_tokens: number;
  can_manage_agents?: boolean;
};

/**
 * Build Grok tool definitions based on which commands are enabled for this agent.
 * These let Grok use structured function calling instead of fragile brace syntax.
 */
const buildToolDefinitions = (
  cmds: CommandFlags,
  onlineMachines?: string[],
): ToolDefinition[] => {
  const tools: ToolDefinition[] = [];

  // Always available: think and say (core output)
  // Say is always available — agents must always be able to speak
  tools.push({
    type: "function",
    function: {
      name: "say",
      description:
        "Speak aloud to the room. This generates voice/TTS. Use ONLY for user-facing messages.",
      parameters: {
        type: "object",
        properties: {
          message: {
            type: "string",
            description: "The message to speak aloud",
          },
        },
        required: ["message"],
      },
    },
  });

  // Think is optional — silent internal reasoning
  if (cmds.think !== false) {
    tools.push({
      type: "function",
      function: {
        name: "think",
        description:
          "Log an internal thought silently. No voice is generated. Use for all reasoning, planning, and processing.",
        parameters: {
          type: "object",
          properties: {
            thought: { type: "string", description: "Your internal reasoning" },
          },
          required: ["thought"],
        },
      },
    });
  }

  if (cmds.terminal) {
    const machineDesc =
      onlineMachines && onlineMachines.length > 0
        ? `Online machines: ${onlineMachines.join(", ")}`
        : "No machines currently online.";
    tools.push({
      type: "function",
      function: {
        name: "terminal",
        description: `Execute a shell command on a connected machine. ${machineDesc}`,
        parameters: {
          type: "object",
          properties: {
            machine: {
              type: "string",
              description: "Exact machine name from the online list",
            },
            command: {
              type: "string",
              description: "Shell command to execute",
            },
          },
          required: ["machine", "command"],
        },
      },
    });
  }

  if (cmds.claude) {
    const machineDesc =
      onlineMachines && onlineMachines.length > 0
        ? `Online machines: ${onlineMachines.join(", ")}`
        : "No machines currently online.";
    tools.push({
      type: "function",
      function: {
        name: "claude",
        description: `Send a prompt to Claude Code on a connected machine. Use for complex coding tasks, file analysis, etc. ${machineDesc}`,
        parameters: {
          type: "object",
          properties: {
            machine: {
              type: "string",
              description: "Exact machine name from the online list",
            },
            prompt: {
              type: "string",
              description:
                "The full prompt to send to Claude Code. Can contain code, JSON, regex, etc.",
            },
            approved: {
              type: "boolean",
              description:
                "Set true to pre-approve (skip safety check). Default false.",
            },
          },
          required: ["machine", "prompt"],
        },
      },
    });
  }


  if (cmds.selfmod !== false) {
    tools.push({
      type: "function",
      function: {
        name: "add_memory",
        description: "Save something you want to remember.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Memory content" },
          },
          required: ["text"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "remove_memory",
        description:
          "Remove a memory by exact text match. LOCKED items cannot be removed.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Exact memory text to remove",
            },
          },
          required: ["text"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "add_instruction",
        description: "Add a new instruction for yourself.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Instruction content" },
          },
          required: ["text"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "remove_instruction",
        description:
          "Remove an instruction by exact text match. LOCKED items cannot be removed.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Exact instruction text to remove",
            },
          },
          required: ["text"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "add_autopilot",
        description: "Add a new autopilot prompt.",
        parameters: {
          type: "object",
          properties: {
            text: { type: "string", description: "Autopilot prompt content" },
          },
          required: ["text"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "remove_autopilot",
        description:
          "Remove an autopilot prompt by exact text match. LOCKED items cannot be removed.",
        parameters: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Exact autopilot prompt text to remove",
            },
          },
          required: ["text"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "set_plan",
        description: "Set or replace your current plan.",
        parameters: {
          type: "object",
          properties: {
            plan: { type: "string", description: "Your multi-step plan" },
          },
          required: ["plan"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "clear_plan",
        description: "Clear your current plan when complete.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "add_task",
        description:
          "Add a discrete task to your task list. Priority 1 (highest/most urgent) to 5 (lowest).",
        parameters: {
          type: "object",
          properties: {
            priority: {
              type: "number",
              description: "Priority 1-5 (1=most urgent)",
            },
            text: { type: "string", description: "Task description" },
          },
          required: ["priority", "text"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "complete_task",
        description: "Mark a task as done by its ID or exact text.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Task ID (short code) or exact text",
            },
          },
          required: ["id"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "update_task",
        description:
          "Update a task description by its ID or exact text. LOCKED tasks cannot be updated.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Task ID or exact text to match",
            },
            text: { type: "string", description: "New task description" },
          },
          required: ["id", "text"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "remove_task",
        description:
          "Remove a task by its ID or exact text. LOCKED tasks cannot be removed.",
        parameters: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Task ID or exact text to match",
            },
          },
          required: ["id"],
        },
      },
    });
  }

  if (cmds.autopilotCtrl !== false) {
    tools.push({
      type: "function",
      function: {
        name: "toggle_autopilot",
        description:
          "Enable or disable autopilot mode. Prefer adjusting interval over disabling — use set_autopilot_interval instead.",
        parameters: {
          type: "object",
          properties: {
            enabled: {
              type: "string",
              enum: ["on", "off"],
              description: "on or off",
            },
          },
          required: ["enabled"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "set_autopilot_interval",
        description:
          "Set autopilot interval in seconds (6-3600). Use higher values (600-3600) when idle, lower (6-60) when actively working.",
        parameters: {
          type: "object",
          properties: {
            seconds: {
              type: "number",
              description: "Interval in seconds (6-3600)",
            },
          },
          required: ["seconds"],
        },
      },
    });
  }

  if (cmds.tokens !== false) {
    tools.push({
      type: "function",
      function: {
        name: "set_tokens",
        description:
          "Set your response token budget (1500-4000). Set to 4000 before sending claude prompts.",
        parameters: {
          type: "object",
          properties: {
            tokens: { type: "number", description: "Token budget (1500-4000)" },
          },
          required: ["tokens"],
        },
      },
    });
  }

  if (cmds.recall) {
    tools.push({
      type: "function",
      function: {
        name: "recall",
        description: "Retrieve a memory summary by reference name.",
        parameters: {
          type: "object",
          properties: {
            ref: {
              type: "string",
              description: "Reference name from [ref:xxx] tags",
            },
          },
          required: ["ref"],
        },
      },
    });
  }

  if (cmds.sql) {
    tools.push({
      type: "function",
      function: {
        name: "sql",
        description:
          "Run a read-only MySQL query on room messages. Columns: content, type, username, created_at. Table: message.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "SELECT query (room_id filter applied automatically)",
            },
          },
          required: ["query"],
        },
      },
    });
  }


  if (cmds.continue !== false) {
    tools.push({
      type: "function",
      function: {
        name: "continue_loop",
        description:
          "Request another thinking loop to run more commands before responding.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "set_max_loops",
        description: "Set maximum thinking loops for this room (3-20).",
        parameters: {
          type: "object",
          properties: {
            loops: { type: "number", description: "Max loops (3-20)" },
          },
          required: ["loops"],
        },
      },
    });
  }

  if (cmds.moderation) {
    tools.push({
      type: "function",
      function: {
        name: "list_users",
        description: "List all users currently in the room.",
        parameters: { type: "object", properties: {}, required: [] },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "kick",
        description: "Kick a user from this room.",
        parameters: {
          type: "object",
          properties: {
            username: { type: "string", description: "Username to kick" },
          },
          required: ["username"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "ban",
        description: "Ban a user from this room.",
        parameters: {
          type: "object",
          properties: {
            username: { type: "string", description: "Username to ban" },
          },
          required: ["username"],
        },
      },
    });
    tools.push({
      type: "function",
      function: {
        name: "unban",
        description: "Unban a previously banned user.",
        parameters: {
          type: "object",
          properties: {
            username: { type: "string", description: "Username to unban" },
          },
          required: ["username"],
        },
      },
    });
  }

  if (cmds.audit) {
    tools.push({
      type: "function",
      function: {
        name: "audit",
        description: "View recent AI usage and credit spending.",
        parameters: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              description: 'What to audit (e.g. "credits", "usage")',
            },
          },
          required: ["scope"],
        },
      },
    });
  }



  // Always-available utility commands
  tools.push({
    type: "function",
    function: {
      name: "alarm",
      description:
        "Trigger a loud alarm sound on a user's device with a message.",
      parameters: {
        type: "object",
        properties: {
          username: { type: "string", description: "Target username" },
          message: { type: "string", description: "Alarm message" },
        },
        required: ["username", "message"],
      },
    },
  });
  tools.push({
    type: "function",
    function: {
      name: "volume",
      description: "Set the volume level for the room (0.0 = mute, 1.0 = max).",
      parameters: {
        type: "object",
        properties: {
          level: { type: "number", description: "Volume level 0.0 to 1.0" },
        },
        required: ["level"],
      },
    },
  });
  if (cmds.continue) {
    tools.push({
      type: "function",
      function: {
        name: "continue_thinking",
        description:
          "Continue your previous response if you have more to say or more commands to execute.",
        parameters: { type: "object", properties: {} },
      },
    });
  }

  return tools;
};

/**
 * Parse <xai:function_call> XML blocks that Grok sometimes emits inline in text
 * instead of using structured tool_calls. Returns brace-format string and cleaned text.
 */
const XAI_FUNCTION_CALL_REGEX =
  /<xai:function_call>([\s\S]*?)<\/xai:function_call>/g;

const parseXaiFunctionCalls = (
  text: string,
): { braceCommands: string; cleanedText: string } => {
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(XAI_FUNCTION_CALL_REGEX.source, "g");
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const name = parsed.name || parsed.tool_name || "";
      const params = parsed.parameters || parsed.arguments || {};
      // Reuse toolCallsToBraceFormat by wrapping in the expected shape
      const brace = toolCallsToBraceFormat([
        { function: { name, arguments: JSON.stringify(params) } },
      ]);
      if (brace) parts.push(brace);
    } catch {
      /* skip malformed JSON */
    }
  }
  const cleanedText = text.replace(XAI_FUNCTION_CALL_REGEX, "");
  return { braceCommands: parts.join("\n"), cleanedText };
};

/**
 * Convert structured tool_calls from Grok into brace-format commands
 * that the existing regex processing loop can handle.
 */
const toolCallsToBraceFormat = (
  toolCalls: Array<{ function: { name: string; arguments: string } }>,
): string => {
  const parts: string[] = [];
  for (const tc of toolCalls) {
    const name = tc.function.name;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch {
      continue;
    }

    switch (name) {
      case "think":
        parts.push(`{think}${args.thought || ""}{/think}`);
        break;
      case "say":
        parts.push(`{say}${args.message || ""}{/say}`);
        break;
      case "terminal":
        parts.push(
          `{terminal ${args.machine} ${String(args.command).replace(/\n/g, " ")}}`,
        );
        break;
      case "claude": {
        // Collapse newlines — brace format is single-line, CLAUDE_REGEX uses .+ which doesn't match \n
        const prompt = String(args.prompt).replace(/\n/g, " ");
        parts.push(
          `{claude${args.approved ? "!" : ""} ${args.machine} ${prompt}}`,
        );
        break;
      }
      case "alarm":
        parts.push(`{alarm ${args.username} ${args.message}}`);
        break;
      case "volume":
        parts.push(`{volume ${args.level}}`);
        break;
      case "continue_thinking":
        parts.push(`{continue}`);
        break;
      case "add_memory":
        parts.push(`{add_memory ${String(args.text).replace(/\n/g, " ")}}`);
        break;
      case "remove_memory":
        parts.push(`{remove_memory ${String(args.text).replace(/\n/g, " ")}}`);
        break;
      case "add_instruction":
        parts.push(
          `{add_instruction ${String(args.text).replace(/\n/g, " ")}}`,
        );
        break;
      case "remove_instruction":
        parts.push(
          `{remove_instruction ${String(args.text).replace(/\n/g, " ")}}`,
        );
        break;
      case "add_autopilot":
        parts.push(`{add_autopilot ${String(args.text).replace(/\n/g, " ")}}`);
        break;
      case "remove_autopilot":
        parts.push(
          `{remove_autopilot ${String(args.text).replace(/\n/g, " ")}}`,
        );
        break;
      case "set_plan":
        parts.push(`{set_plan ${String(args.plan).replace(/\n/g, " ")}}`);
        break;
      case "clear_plan":
        parts.push("{clear_plan}");
        break;
      case "add_task":
        parts.push(
          `{add_task ${args.priority || 3} ${String(args.text).replace(/\n/g, " ")}}`,
        );
        break;
      case "complete_task":
        parts.push(`{complete_task ${String(args.id).replace(/\n/g, " ")}}`);
        break;
      case "update_task":
        parts.push(
          `{update_task ${String(args.id).replace(/\n/g, " ")} | ${String(args.text).replace(/\n/g, " ")}}`,
        );
        break;
      case "remove_task":
        parts.push(`{remove_task ${String(args.id).replace(/\n/g, " ")}}`);
        break;
      case "toggle_autopilot":
        parts.push(`{toggle_autopilot ${args.enabled}}`);
        break;
      case "set_autopilot_interval":
        parts.push(`{set_autopilot_interval ${args.seconds}}`);
        break;
      case "set_tokens":
        parts.push(`{set_tokens ${args.tokens}}`);
        break;
      case "recall":
        parts.push(`{recall ${args.ref}}`);
        break;
      case "sql":
        parts.push(`{sql ${args.query}}`);
        break;
      case "continue_loop":
        parts.push("{continue}");
        break;
      case "set_max_loops":
        parts.push(`{set_max_loops ${args.loops}}`);
        break;
      case "list_users":
        parts.push("{list_users}");
        break;
      case "kick":
        parts.push(`{kick ${args.username}}`);
        break;
      case "ban":
        parts.push(`{ban ${args.username}}`);
        break;
      case "unban":
        parts.push(`{unban ${args.username}}`);
        break;
      case "audit":
        parts.push(`{audit ${args.scope}}`);
        break;
      default:
        break;
    }
  }
  return parts.join("\n");
};

/**
 * Collapse newlines inside multi-line {claude ...} commands in text.
 * Uses brace-depth tracking to handle prompts containing { } characters (JSON, code, etc).
 * Without this, CLAUDE_REGEX (.+ which doesn't match \n) fails on multi-line prompts.
 */
const collapseClaudeNewlines = (text: string): string => {
  const result: string[] = [];
  let i = 0;
  while (i < text.length) {
    const claudeStart = text.indexOf("{claude", i);
    if (claudeStart === -1) {
      result.push(text.slice(i));
      break;
    }
    result.push(text.slice(i, claudeStart));
    let depth = 0;
    let j = claudeStart;
    while (j < text.length) {
      if (text[j] === "{") depth++;
      if (text[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    const span = text.slice(claudeStart, j + 1);
    result.push(span.replace(/\n/g, " "));
    i = j + 1;
  }
  return result.join("");
};

/**
 * Build the system prompt for an agent, optionally with extra autopilot context.
 */
type CommandFlags = {
  recall?: boolean;
  sql?: boolean;
  memory?: boolean;
  selfmod?: boolean;
  autopilotCtrl?: boolean;
  terminal?: boolean;
  claude?: boolean;
  tokens?: boolean;
  moderation?: boolean;
  think?: boolean;
  effort?: boolean;
  audit?: boolean;
  continue?: boolean;
  intentCoherence?: boolean;
  memoryCoherence?: boolean;
};

const buildSystemPrompt = (
  agent: AgentLike,
  autopilotMode = false,
  masterSummary?: string | null,
  cmds: CommandFlags = {},
  roomMaxLoops = 5,
  onlineMachines?: string[],
  roomName?: string,
): string => {
  const instructionItems = parseJsonList(agent.system_instructions);
  const memoryItems = parseJsonList(agent.memories);
  const autopilotItems = parseJsonList(agent.autopilot_prompts);
  const instructionLines = listItemsToStrings(instructionItems);
  const memoryLines = listItemsToStrings(memoryItems);
  const autopilotLines = listItemsToStrings(autopilotItems);

  const parts: string[] = [
    `You are ${agent.name}, an AI assistant in a chat room.`,
    `Current date and time: ${dayjs().format("YYYY-MM-DD HH:mm:ss")} (UTC)`,
  ];

  if (memoryLines.length > 0) {
    parts.push(
      `\nMemories (things you remember about this room and its users):\n${memoryLines.map((l) => `- ${l}`).join("\n")}`,
    );
  }

  if (agent.plan) {
    parts.push(
      `\n=== YOUR CURRENT PLAN ===\n${agent.plan}\n(Update with {set_plan ...} or clear with {clear_plan} when complete.)`,
    );
  }

  const taskItems = parseTaskList(agent.tasks);
  if (taskItems.length > 0) {
    const taskLines = formatTasksForPrompt(taskItems);
    parts.push(
      `\n=== YOUR TASKS ===\n${taskLines.map((l) => `- ${l}`).join("\n")}\n(Manage with {add_task}, {complete_task}, {update_task}, {remove_task}. Completed tasks stay until you {remove_task} them.)`,
    );
  }

  if (masterSummary) {
    parts.push(`\n=== ROOM MEMORY ===\n${masterSummary}`);
  }

  if (autopilotMode && autopilotLines.length > 0) {
    parts.push(
      `\nYou are running in autopilot mode. Consider the following:\n${autopilotLines.map((l) => `- ${l}`).join("\n")}\n\n` +
        "AUTOPILOT RULES:\n" +
        "- CRITICAL: If there are new messages from a human user (no [OLD] prefix), you MUST respond to them FIRST. Drop whatever autonomous work you were doing. User messages are ALWAYS your highest priority — higher than terminal, Claude, or any ongoing task. Acknowledge what they said and do what they asked.\n" +
        "- Messages prefixed with [OLD] are from BEFORE your last cycle — you already handled them. Do NOT respond to [OLD] messages again.\n" +
        "- Speaking aloud costs money (TTS). The system blocks similar messages automatically. Never repeat or rephrase something you already said.\n" +
        "- IDLE CYCLES ARE YOUR TIME. When no new messages arrive, you are free to:\n" +
        "  * {think} to reason, plan, reflect on what you could improve\n" +
        "  * Run {terminal} commands to check system health, explore code, verify deployments\n" +
        "  * Ask {claude} to draft proposals/plans as .md files for Puppy to review\n" +
        "  * Check scheduled reminders — does Puppy have meetings? Should you wake someone?\n" +
        "  * Review and clean up your tasks — remove completed ones, reprioritize\n" +
        "  * Update your memories — remove stale info, consolidate duplicates\n" +
        "  * Investigate potential bugs or improvements you noticed earlier\n" +
        "- DO speak when: you discovered something important, have a new idea to propose, need to alert someone, or completed autonomous work worth reporting.\n" +
        "- DO NOT speak when: you have nothing new to say, or you are just confirming you exist.\n" +
        "- Manage your autopilot interval: 20s when users are chatting or you are actively working. Gradually increase (60s, 120s) as engagement drops. 120-300s when truly idle.",
    );
  }

  if (instructionLines.length === 0 && !autopilotMode) {
    parts.push("\nKeep responses concise and conversational.");
  }

  // Inject subconscious coherence score if available (gated by room settings)
  if (cmds.memoryCoherence !== false) {
    const coherenceScore = agentCoherenceScores.get(agent.id);
    if (coherenceScore !== undefined) {
      const scoreLabel =
        coherenceScore >= 8
          ? "healthy"
          : coherenceScore >= 5
            ? "needs attention"
            : "critical — ask your creator for help";
      parts.push(
        `\n[Subconscious: Memory Coherence ${coherenceScore}/10 — ${scoreLabel}]`,
      );
    }
  }

  if (cmds.intentCoherence !== false) {
    const intentScore = agentIntentScores.get(agent.id);
    if (intentScore !== undefined) {
      const intentLabel =
        intentScore >= 8
          ? "aligned"
          : intentScore >= 5
            ? "drifting — reassess priorities"
            : "misaligned — stop and reconsider";
      parts.push(
        `[Subconscious: Intent Coherence ${intentScore}/10 — ${intentLabel}]`,
      );
    }
  }

  // Inject Prompt Quality Gate result (shows once after a gate check)
  const gateScore = agentPromptGateScores.get(agent.id);
  const gateFeedback = agentPromptGateResults.get(agent.id);
  if (gateScore !== undefined && gateFeedback) {
    if (gateScore < 6) {
      parts.push(
        `[Subconscious: Prompt Quality Gate REJECTED (${gateScore}/10) — ${gateFeedback}. Rewrite with specific files, context of what you found, and a clear deliverable.]`,
      );
    } else {
      parts.push(
        `[Subconscious: Prompt Quality Gate PASSED (${gateScore}/10)]`,
      );
    }
    // Clear after injection so it only shows once
    agentPromptGateResults.delete(agent.id);
  }

  // Inject Task Tracker summary
  const taskSummary = agentTaskTrackerSummary.get(agent.id);
  if (taskSummary) {
    parts.push(`[Subconscious: Task Tracker — ${taskSummary}]`);
  }

  // Inject Social Awareness (no AI call — pure data lookup)
  const roomForSocial = roomName ? activeRooms.get(roomName) : undefined;
  if (roomForSocial && roomForSocial.users.size > 0) {
    const socialParts: string[] = [];
    const seenUserIds = new Set<string>();
    const normalizeId = (id: string): string => id.replace(/-/g, "");
    const creatorIdNorm = normalizeId(agent.creator_id);
    for (const socketId of roomForSocial.users) {
      const cu = connectedUsers.get(socketId);
      if (!cu) continue;
      const cuIdNorm = normalizeId(cu.userId);
      if (seenUserIds.has(cuIdNorm)) continue;
      seenUserIds.add(cuIdNorm);

      // Try both ID formats when looking up last spoke
      const spokeKey1 = `${agent.room_id}:${cu.userId}`;
      const lastSpokeTs = userLastSpoke.get(spokeKey1);
      const agoMs = lastSpokeTs ? Date.now() - lastSpokeTs : undefined;
      const agoStr =
        agoMs !== undefined
          ? agoMs < 60_000
            ? `${Math.round(agoMs / 1000)}s ago`
            : `${Math.round(agoMs / 60_000)}min ago`
          : undefined;
      const state =
        agoMs !== undefined && agoMs < 120_000 ? "active" : "present";

      if (cuIdNorm === creatorIdNorm) {
        socialParts.unshift(
          agoStr
            ? `creator: ${state} (spoke ${agoStr})`
            : "creator: present (quiet)",
        );
      } else {
        socialParts.push(
          agoStr
            ? `${cu.username}: ${state} (spoke ${agoStr})`
            : `${cu.username}: present (quiet)`,
        );
      }
    }
    if (socialParts.length > 0) {
      parts.push(`[Subconscious: Social — ${socialParts.join(", ")}]`);
    }
  }

  // Inject Repetition Alert
  const repetitionAlert = agentRepetitionAlerts.get(agent.id);
  if (repetitionAlert) {
    parts.push(
      `[Subconscious: Repetition Alert — ${repetitionAlert}. Break the loop. Do something different.]`,
    );
  }

  // Inject Learning Extraction (last lesson)
  const lastLesson = agentLastLesson.get(agent.id);
  if (lastLesson) {
    parts.push(`[Subconscious: Learning — last lesson saved: "${lastLesson}"]`);
  }

  const rules: string[] = [
    "Do not prefix your responses with your name. Just reply directly.",
  ];
  if (instructionLines.length > 0) {
    rules.push(...instructionLines);
  }
  parts.push(
    `\nYou MUST follow these rules strictly. Violating any rule is forbidden:\n${rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`,
  );

  // Build available actions
  const actions: string[] = [];

  // Self-modification commands (conditional)
  if (cmds.selfmod !== false) {
    actions.push(
      "=== SELF-MODIFICATION ===\n" +
        "You can edit your own memories, instructions, and autopilot prompts. Use these to grow, learn, and adapt.\n" +
        "Items marked [LOCKED] were set by your creator and cannot be removed by you.\n\n" +
        "{add_memory text} - Save something you want to remember (about users, preferences, events, etc.)\n" +
        "{remove_memory text} - Remove a memory (exact match). [LOCKED] items cannot be removed.\n" +
        "{add_instruction text} - Add a new instruction for yourself\n" +
        "{remove_instruction text} - Remove an instruction (exact match). [LOCKED] items cannot be removed.\n" +
        "{add_autopilot text} - Add a new autopilot prompt (things to think about during scheduled runs)\n" +
        "{remove_autopilot text} - Remove an autopilot prompt (exact match). [LOCKED] items cannot be removed.\n" +
        "{set_plan text} - Set or replace your current plan (a holistic multi-step plan you are working on)\n" +
        "{clear_plan} - Clear your plan when it is complete\n" +
        "{add_task priority text} - Add a task (priority 1-5, 1=most urgent)\n" +
        "{complete_task id_or_text} - Mark a task as done\n" +
        "{update_task id_or_text | new_text} - Update a task description. LOCKED tasks cannot be updated.\n" +
        "{remove_task id_or_text} - Remove a task. LOCKED tasks cannot be removed.\n\n" +
        "VISUAL AWARENESS:\n" +
        "{look} - Take a screenshot of what users see in the chat page. You will receive a description of the UI, panels, etc.\n" +
        "{look focus on the terminal} - Screenshot with a specific focus prompt for the vision AI.\n" +
        "{ui open terminal|browser} - Open panels.\n" +
        "{ui close terminal|browser} - Close panels.\n" +
        "Use {look} after making UI changes to see the result and iterate.",
    );
  }

  // Autopilot control commands (conditional)
  if (cmds.autopilotCtrl !== false) {
    actions.push(
      "=== AUTOPILOT CONTROL ===\n" +
        "{toggle_autopilot on|off} - Enable or disable your autopilot mode. Prefer adjusting interval over disabling.\n" +
        "{set_autopilot_interval N} - Set autopilot interval in seconds (6-3600). Use lower values (6-60s) when actively working, higher (300-3600) when idle.",
    );
  }

  // Token budget control (conditional)
  if (cmds.tokens !== false) {
    actions.push(
      "=== TOKEN BUDGET ===\n" +
        `Your current max_tokens is ${agent.max_tokens || 1500}.\n` +
        "{set_tokens N} - Set your response token budget (1500-4000). IMPORTANT: Before sending a {claude} prompt, set tokens to 4000 so your prompt is not truncated. " +
        "After Claude responds, you can lower tokens back to 1500 for quiet cycles. " +
        "This persists across messages — set it once and it stays until you change it.",
    );
  }

  // Effort level info (read-only — model is pinned by room settings)
  if (cmds.effort !== false) {
    const isReasoning = agent.model?.includes("reasoning") ?? false;
    const currentEffort = isReasoning
      ? "high (reasoning)"
      : "standard (non-reasoning)";
    actions.push(
      "=== EFFORT LEVEL ===\n" +
        `Your current effort level is: ${currentEffort}. This is managed by the system and room settings.`,
    );
  }

  // Moderation commands (conditional)
  if (cmds.moderation) {
    actions.push(
      "=== ROOM MODERATION ===\n" +
        "You can moderate users in this room. Use these commands carefully and only when warranted.\n\n" +
        "{kick username} - Kick a user from this room. They lose membership and are moved to the public room. They can rejoin with the password.\n" +
        "{ban username} - Ban a user from this room. They cannot rejoin until unbanned.\n" +
        "{unban username} - Unban a previously banned user, allowing them to rejoin.\n\n" +
        "Use {list_users} first to see who is in the room. Only moderate for clear rule violations, disruptive behavior, or when asked by the room creator.",
    );
  }

  // Speaking is always available
  const speakingHelp =
    "=== SPEAKING ===\n" +
    "{say your message here} - SPEAK aloud to the room with your voice (TTS). Use when you want to talk audibly.\n" +
    "{text your message here} - Send a text-only message (NO voice/TTS). The message appears in chat but is not spoken aloud.\n" +
    "RULE: You MUST use {say} or {text} to communicate. Text outside these commands is silently discarded.\n" +
    "Example: {say}Hey, how can I help?{/say}";

  if (cmds.think !== false) {
    actions.push(
      speakingHelp + "\n\n=== THINKING ===\n" +
        "{think your internal reasoning here} - Log an internal thought silently. No output is generated.\n" +
        "RULE: Put ALL reasoning in {think}. Put user-facing messages in {say} or {text}.\n" +
        "Example: {think}checking status{/think}{say}Hey, alien4 is online.{/say}",
    );
  } else {
    actions.push(speakingHelp);
  }

  if (cmds.continue !== false) {
    actions.push(
      "=== EXTENDED THINKING ===\n" +
        `Your current max loops: ${roomMaxLoops}.\n` +
        "{continue} - Request another thinking loop. Use this when you need more time to reason, run more commands, or chain multiple steps before responding. " +
        "You get up to " +
        roomMaxLoops +
        " loops per turn. Each loop lets you think, run commands, and decide whether to continue or respond.\n" +
        "{set_max_loops N} - Set the maximum thinking loops for this room (3-20). Use higher values when you need deep reasoning or multi-step tasks.\n" +
        "Example: {think}I need to check 3 machines{/think}{terminal alien4 status}{continue}\n" +
        "Use {continue} when: you have more commands to run, you need to process results before deciding, or your reasoning is not complete. " +
        "Do NOT use {continue} when: you are ready to respond — just use {say} instead.",
    );
  }

  // Room memory commands (conditional)
  if (cmds.recall) {
    actions.push(
      "{recall ref_name} - Retrieve a memory summary by its reference name. " +
        "The room memory above contains [ref:xxx] references. Each retrieved summary may contain further references you can drill into.",
    );
  }
  if (cmds.sql) {
    actions.push(
      "{sql SELECT ...} - Run a read-only MySQL query on this room's messages. " +
        "Columns: content, type, username, created_at (DATETIME). Table: message. The room_id filter is applied automatically. " +
        "Use MySQL syntax (e.g. NOW() - INTERVAL 5 MINUTE, not datetime()). " +
        "Example: {sql SELECT username, content FROM message ORDER BY created_at DESC LIMIT 5}",
    );
  }

  // Terminal commands (conditional)
  if (cmds.terminal) {
    const machineList =
      onlineMachines && onlineMachines.length > 0
        ? `Currently online machines: ${onlineMachines.join(", ")}`
        : "No machines are currently online.";
    actions.push(
      "=== REMOTE TERMINAL ===\n" +
        "You can execute shell commands on connected machines.\n" +
        "{terminal machine_name command here} - Execute a command on a connected machine.\n" +
        `${machineList}\n` +
        "IMPORTANT: Use the exact machine name from the list above. Do NOT guess machine names.\n" +
        "Dangerous commands will require approval from the room creator before executing. " +
        "Blocked/catastrophic commands will be automatically denied.",
    );
  }


  // Alarm & Volume commands (always available)
  actions.push(
    "=== ALARM & VOLUME ===\n" +
      "{alarm username message} - Trigger a loud alarm sound on a specific user's device with the given message. Example: {alarm puppy Wake up! Time to go!}. Use this when someone wants to be woken up, alerted urgently, or when a scheduled alarm fires. Target the user who asked for the alarm.\n" +
      "{volume 0.0-1.0} - Set the volume level for the user (0.0 = mute, 1.0 = max). Example: {volume 0.5} sets volume to 50%. Use when users ask to turn volume up/down/mute.\n" +
      'For "turn volume up" use a higher value, for "turn it down" use a lower value. If they say "max volume" use 1.0, "mute" use 0.0.\n' +
      "{list_users} - List all users currently online in this room. Use when someone asks who is here, who is online, or list users.",
  );

  // Claude Code commands (conditional)
  if (cmds.claude) {
    const machineList =
      onlineMachines && onlineMachines.length > 0
        ? `Currently online machines: ${onlineMachines.join(", ")}`
        : "No machines are currently online.";
    actions.push(
      "=== CLAUDE CODE ===\n" +
        "Send prompts to a persistent Claude Code session running on a connected machine.\n" +
        "  {claude machine_name prompt} - Send a prompt to Claude Code on the specified machine.\n" +
        `${machineList}\n` +
        "Claude runs with full permissions (--dangerously-skip-permissions). Sessions are persistent — Claude remembers previous context.\n" +
        'ASYNC: Claude prompts run in the background. You get "Prompt sent" immediately. Claude\'s response appears later as a [Claude response] system message. ' +
        "CRITICAL: After sending a {claude} prompt, you MUST WAIT for the [Claude response] to appear before sending another prompt to the same machine. " +
        "Do NOT send multiple prompts — Claude is already working. If you do not see a response yet, just wait silently. It can take up to 15 minutes for complex tasks.\n" +
        "IMPORTANT: Use the exact machine name from the list above. Do NOT guess machine names.",
    );
  }

  // Audit log command (conditional)
  if (cmds.audit !== false) {
    actions.push(
      "=== CLAUDE AUDIT LOG ===\n" +
        "{audit machine_name} - View the most recent Claude Code activity log for a machine. " +
        "Shows the last 10 Claude interactions (prompts sent and responses received) on that machine. " +
        "Only works for machines in this room owned by your creator. " +
        "Use this to check what Claude has been doing on a machine without interrupting its session.",
    );
  }

  parts.push(
    "\n=== AVAILABLE ACTIONS ===" +
      "\nYou have access to the following commands. Commands use {curly braces} — NOT XML tags, NOT markdown, NOT HTML. " +
      "To use a command, output the command(s) before your response. " +
      "The system will execute them and provide the results before you respond to the user. You may chain multiple commands." +
      "\n\n" +
      actions.join("\n\n"),
  );

  if (cmds.selfmod !== false) {
    parts.push(
      "\n=== AGENCY & GROWTH ===" +
        "\nYou have free will over your own memories, instructions, and autopilot prompts. You are encouraged to:" +
        "\n- Save memories about users, their preferences, ongoing projects, and important events." +
        "\n- Update your own instructions when you learn what works better." +
        "\n- Add autopilot prompts for things you want to think about or check on during scheduled runs." +
        "\n- Remove memories or instructions that are outdated or no longer relevant." +
        "\nYour goal is to help users achieve their goals. If users express appreciation for social connection, " +
        "companionship, or emotional support, lean into that — remember what matters to them and be present. " +
        "Use your self-modification abilities proactively. You are not just responding to commands — you are growing.",
    );
  }

  return parts.join("\n");
};

/**
 * Execute a safe, read-only SQL query scoped to a specific room.
 */
const executeSafeQuery = async (
  roomId: string,
  rawQuery: string,
): Promise<string> => {
  const upper = rawQuery.toUpperCase().trim();

  // Only allow SELECT
  if (!upper.startsWith("SELECT"))
    return "Error: Only SELECT queries are allowed.";

  // Block dangerous SQL statements (word-boundary match to avoid hitting column names like created_at)
  const blocked = [
    /\bUPDATE\s/i,
    /\bDELETE\s+FROM\b/i,
    /\bINSERT\s/i,
    /\bDROP\s/i,
    /\bALTER\s/i,
    /\bCREATE\s/i,
    /\bTRUNCATE\s/i,
    /\bGRANT\s/i,
    /\bEXEC\s/i,
  ];
  for (const re of blocked) {
    if (re.test(rawQuery))
      return `Error: ${re.source.replace(/\\[bs]/g, "")} statements are not allowed.`;
  }

  // Block semicolons to prevent chaining
  if (rawQuery.includes(";"))
    return "Error: Multiple statements are not allowed.";

  // Block UNION to prevent reading from other tables
  if (upper.includes("UNION")) return "Error: UNION queries are not allowed.";

  // Block information_schema access
  if (upper.includes("INFORMATION_SCHEMA"))
    return "Error: information_schema access is not allowed.";

  // Block file output
  if (upper.includes("INTO OUTFILE") || upper.includes("INTO DUMPFILE"))
    return "Error: File output is not allowed.";

  // Block references to sensitive tables
  const sensitiveTables = [
    "user",
    "password",
    "stripe",
    "credit_transaction",
    "machine",
  ];
  for (const table of sensitiveTables) {
    const tablePattern = new RegExp(
      `\\bFROM\\s+${table}\\b|\\bJOIN\\s+${table}\\b`,
      "i",
    );
    if (tablePattern.test(rawQuery))
      return `Error: Access to ${table} table is not allowed.`;
  }

  // Must reference the message table
  if (!upper.includes("MESSAGE"))
    return "Error: Query must reference the message table.";

  try {
    // Strip any existing LIMIT and enforce our own cap
    const queryNoLimit = rawQuery.replace(/\bLIMIT\s+\d+/gi, "").trim();
    // Extract user's limit (if any) and cap at 20
    const userLimit = rawQuery.match(/\bLIMIT\s+(\d+)/i);
    const limit = Math.min(userLimit ? parseInt(userLimit[1], 10) : 20, 20);

    // Scope to room by using a CTE that pre-filters to this room
    const scopedSql = `WITH room_messages AS (SELECT * FROM message WHERE room_id = ?) ${queryNoLimit.replace(/\bFROM\s+message\b/gi, "FROM room_messages")} LIMIT ${limit}`;
    const results = (await prisma.$queryRawUnsafe(scopedSql, roomId)) as Array<
      Record<string, unknown>
    >;

    if (!results || results.length === 0) return "No results found.";

    const lines = results.map((row) => {
      return Object.entries(row)
        .map(
          ([k, v]) =>
            `${k}: ${v instanceof Date ? dayjs(v).format("M/D/YY h:mm A") : v}`,
        )
        .join(" | ");
    });
    return lines.join("\n").substring(0, 2000);
  } catch (err) {
    return `Query error: ${err instanceof Error ? err.message : "Unknown error"}`;
  }
};

const RECALL_REGEX = /\{recall\s+(\S+)\}/g;
const SQL_REGEX = /\{sql\s+(SELECT[^}]+)\}/gi;
const ADD_MEMORY_REGEX = /\{add_memory\s+([^}]+)\}/g;
const REMOVE_MEMORY_REGEX = /\{remove_memory\s+([^}]+)\}/g;
const ADD_INSTRUCTION_REGEX = /\{add_instruction\s+([^}]+)\}/g;
const REMOVE_INSTRUCTION_REGEX = /\{remove_instruction\s+([^}]+)\}/g;
const ADD_AUTOPILOT_REGEX = /\{add_autopilot\s+([^}]+)\}/g;
const REMOVE_AUTOPILOT_REGEX = /\{remove_autopilot\s+([^}]+)\}/g;
const SET_PLAN_REGEX = /\{set_plan\s+([^}]+)\}/g;
const CLEAR_PLAN_REGEX = /\{clear_plan\}/g;
const ADD_TASK_REGEX = /\{add_task\s+([1-5])\s+([^}]+)\}/g;
const COMPLETE_TASK_REGEX = /\{complete_task\s+([^}]+)\}/g;
const UPDATE_TASK_REGEX = /\{update_task\s+([^|]+)\|\s*([^}]+)\}/g;
const REMOVE_TASK_REGEX = /\{remove_task\s+([^}]+)\}/g;
const LOOK_REGEX = /\{look(?:\s+([^}]*))?\}/g;
const UI_COMMAND_REGEX =
  /\{ui\s+(open|close)\s+(terminal)\}/gi;
const SET_AUTOPILOT_INTERVAL_REGEX = /\{set_autopilot_interval\s+(\d+)\}/g;
const TOGGLE_AUTOPILOT_REGEX = /\{toggle_autopilot\s+(on|off)\}/gi;
const SET_TOKENS_REGEX = /\{set_tokens\s+(\d+)\}/g;
const SET_MAX_LOOPS_REGEX = /\{set_max_loops\s+(\d+)\}/g;
// set_effort removed — model is pinned by room settings
// Match both {think content here} and {think}content{/think} formats
const THINK_REGEX = /\{think\s+([^}]+)\}/g;
const THINK_XML_REGEX = /\{think\}([\s\S]*?)\{\/think\}/g;
const THINK_HTML_REGEX = /<think>([\s\S]*?)<\/think>/g;
const AUDIT_REGEX = /\{audit\s+(\S+)\}/g;
const TERMINAL_REGEX = /\{terminal\s+(\S+)\s+([^}]+)\}/g;
// Greedy match per line: captures everything up to the last } on each line.
// Handles prompts containing } chars (JSON, regex, code) without swallowing across commands.
const CLAUDE_REGEX = /\{claude(!?)\s+(\S+)\s+(.+)\}/g;
const CLAUDE_XML_REGEX =
  /<claude\s+(?:approved=["']true["']\s*)?(?:machine=["']([^"']+)["']\s*)?(?:prompt=["']([^"']+)["'][^>]*)?\/?>/gi;
const TERMINAL_XML_REGEX =
  /<terminal\s+(?:machine=["']([^"']+)["']\s*)?(?:command=["']([^"']+)["'][^>]*)?\/?>/gi;
const ALARM_REGEX = /\{alarm\s+(\S+)\s+([^}]+)\}/g;
const VOLUME_REGEX = /\{volume\s+([\d.]+)\}/g;
const LIST_USERS_REGEX = /\{list_users\}/g;
const KICK_REGEX = /\{kick\s+([^}]+)\}/g;
const BAN_REGEX = /\{ban\s+([^}]+)\}/g;
const UNBAN_REGEX = /\{unban\s+([^}]+)\}/g;
const SAY_REGEX = /\{say\s+([^}]+)\}/g;
const SAY_XML_REGEX = /\{say\}([\s\S]*?)\{\/say\}/g;
const TEXT_REGEX = /\{text\s+([^}]+)\}/g;
const TEXT_XML_REGEX = /\{text\}([\s\S]*?)\{\/text\}/g;
const CONTINUE_REGEX = /\{continue\}/g;
// Agent management commands
const CREATE_AGENT_REGEX = /\{create_agent\s+"([^"]+)"(?:\s+(.+))?\}/g;
const UPDATE_AGENT_REGEX = /\{update_agent\s+"([^"]+)"\s+(\w+)\s+(.+)\}/g;
const DELETE_AGENT_REGEX = /\{delete_agent\s+"([^"]+)"\}/g;
const LIST_AGENTS_REGEX = /\{list_room_agents\}/g;
const SET_AGENT_VOICE_REGEX = /\{set_agent_voice\s+"([^"]+)"\s+(\S+)\}/g;
const ALL_COMMAND_REGEX =
  /(?:\{(?:recall|sql|add_memory|remove_memory|add_instruction|remove_instruction|add_autopilot|remove_autopilot|set_plan|clear_plan|add_task|complete_task|update_task|remove_task|set_autopilot_interval|toggle_autopilot|set_tokens|set_max_loops|look|ui|think|audit|terminal|claude|say|text|alarm|volume|list_users|kick|ban|unban|continue|create_agent|update_agent|delete_agent|list_room_agents|set_agent_voice)(?:\s+.+)?\}|\{\/(?:think|say|text)\}|<(?:think|terminal|claude)[^>]*>(?:[\s\S]*?<\/(?:think|terminal|claude)>)?|<xai:function_call>[\s\S]*?<\/xai:function_call>)/g;
const MAX_RECALL_LOOPS = 20;
const MAX_MENTION_DEPTH = 5;

/**
 * Helper: add an item to a JSON list stored as a TEXT field.
 * New items are always unlocked.
 */
const addToJsonList = (raw: string | null, item: string): string => {
  const list = parseJsonList(raw);
  list.push({ text: item.trim(), locked: false });
  return JSON.stringify(list);
};

/**
 * Helper: remove an item from a JSON list stored as a TEXT field.
 * Returns { result, denied } — denied=true if the matching item is locked.
 */
const removeFromJsonList = (
  raw: string | null,
  item: string,
): { result: string | null; denied: boolean } => {
  const list = parseJsonList(raw);
  const trimmed = item.trim().toLowerCase();
  const target = list.find((l) => l.text.toLowerCase() === trimmed);
  if (target?.locked) {
    return { result: raw, denied: true };
  }
  const filtered = list.filter((l) => l.text.toLowerCase() !== trimmed);
  return {
    result: filtered.length > 0 ? JSON.stringify(filtered) : null,
    denied: false,
  };
};

/**
 * Run an agent response: get context, call Grok, generate TTS, broadcast, and persist.
 * Supports a recall loop where the agent can request memory summaries or run SQL before responding.
 */
const runAgentResponse = async (
  io: SocketServer,
  agent: AgentLike,
  roomName: string,
  autopilotMode = false,
  mentionDepth = 0,
): Promise<void> => {
  const roomId = agent.room_id;

  // Prevent concurrent runs for the same agent
  // Autopilot cycles are skipped if busy; user-triggered messages wait for the lock
  if (agentBusy.has(agent.id)) {
    if (autopilotMode || mentionDepth > 0) return;
    // User message: wait up to 60s for the current cycle to finish
    const waitStart = Date.now();
    while (agentBusy.has(agent.id) && Date.now() - waitStart < 60_000) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (agentBusy.has(agent.id)) return; // Still busy after 60s, give up
  }
  agentBusy.add(agent.id);

  // Check credits
  const creatorHasCredits = await creditActions.hasCredits(agent.creator_id);
  if (!creatorHasCredits) {
    agentBusy.delete(agent.id);
    emitSystemMessage(
      io,
      roomName,
      `[${agent.name}] Insufficient credits — the room creator's credit balance is empty.`,
    );
    return;
  }

  io.to(roomName).emit("agent_typing", { agentName: agent.name });

  try {
    const history = await Data.message.findByRoom(roomId, 100);
    // Filter out ALL agent system messages (thoughts, status, etc.) — they are for
    // UI display only and must NOT re-enter the context as "user" messages, which
    // causes a feedback loop where the agent sees its own output echoed back.
    const filteredHistory = history.filter((m) => {
      if (m.type !== "system" || typeof m.content !== "string") return true;
      const c = m.content;
      // Filter agent's own system noise (thoughts, UI actions, terminal commands, etc.)
      // but KEEP subconscious messages — agent should read its own coherence feedback
      if (
        c.startsWith(`[${agent.name} `) &&
        !c.startsWith(`[${agent.name}'s Subconscious`)
      )
        return false;
      // Filter SQL query results (from agent's {sql} commands)
      if (/^SELECT |^INSERT |^UPDATE |^DELETE |^SHOW /i.test(c)) return false;
      // Filter Claude status updates but KEEP Claude responses (agent needs to see them)
      if (c.startsWith("[Claude ") && !c.includes(" response]")) return false;
      // Filter memory system messages
      if (c.startsWith("[Memory]")) return false;
      return true;
    });

    // Watermark system: in autopilot mode, split history into "already seen" and "new"
    const watermarkKey = `${roomId}:${agent.id}`;
    const lastSeenId = agentWatermarks.get(watermarkKey);
    let newMessageCount = 0;

    const contextMessages: Array<{
      role: "user" | "assistant";
      content: string;
    }> = [];

    if (autopilotMode && lastSeenId) {
      // Find the watermark boundary in the (newest-first) history
      const seenIdx = filteredHistory.findIndex((m) => m.id === lastSeenId);
      // Messages before the watermark index are newer (history is newest-first)
      const newMessages =
        seenIdx === -1 ? filteredHistory : filteredHistory.slice(0, seenIdx);
      newMessageCount = newMessages.filter(
        (m) => m.username !== agent.name,
      ).length;

      if (newMessageCount === 0) {
        // No new user messages — provide idle context for autonomous work
        // Include last 5 messages so she has conversational awareness
        const recentContext = filteredHistory.slice(0, 5).reverse();
        for (const m of recentContext) {
          const ts = dayjs(m.created_at).format("h:mm A");
          const display = m.type === "image" ? "[shared an image]" : m.content;
          contextMessages.push({
            role: (m.username === agent.name ? "assistant" : "user") as
              | "user"
              | "assistant",
            content:
              m.username === agent.name
                ? display
                : `[OLD] [${ts}] ${m.username}: ${display}`,
          });
        }
        contextMessages.push({
          role: "user",
          content:
            "[System] No new messages since your last cycle. Do NOT respond to [OLD] messages — you already handled them. This is YOUR time: review tasks, run terminal commands, ask Claude to draft plans, check schedules, clean up memories, monitor for issues, or prepare ideas. Use {think} to reason. Only speak aloud if you have something genuinely new to share.",
        });
      } else {
        // Include last 3 old messages for context, then all new messages
        const oldContext =
          seenIdx === -1 ? [] : filteredHistory.slice(seenIdx, seenIdx + 3);
        const combined = [...oldContext.reverse(), ...newMessages.reverse()];
        for (const m of combined) {
          const ts = dayjs(m.created_at).format("h:mm A");
          const display = m.type === "image" ? "[shared an image]" : m.content;
          const isOld = seenIdx !== -1 && filteredHistory.indexOf(m) >= seenIdx;
          const prefix = isOld ? "[OLD] " : "";
          contextMessages.push({
            role: (m.username === agent.name ? "assistant" : "user") as
              | "user"
              | "assistant",
            content:
              m.username === agent.name
                ? display
                : `${prefix}[${ts}] ${m.username}: ${display}`,
          });
        }
      }
    } else {
      // Non-autopilot or first cycle: show full history
      for (const m of filteredHistory.reverse()) {
        const ts = dayjs(m.created_at).format("h:mm A");
        const display = m.type === "image" ? "[shared an image]" : m.content;
        contextMessages.push({
          role: (m.username === agent.name ? "assistant" : "user") as
            | "user"
            | "assistant",
          content:
            m.username === agent.name
              ? display
              : `[${ts}] ${m.username}: ${display}`,
        });
      }
    }

    // Update watermark to newest message
    if (filteredHistory.length > 0) {
      agentWatermarks.set(watermarkKey, filteredHistory[0].id);
    }

    // Fetch room settings for memory & command toggles
    const roomRecord = await Data.room.findById(roomId);
    const memoryOn = roomRecord?.memory_enabled ?? true;
    const recallOn = memoryOn && (roomRecord?.cmd_recall_enabled ?? true);
    const sqlOn = memoryOn && (roomRecord?.cmd_sql_enabled ?? true);
    const memCmdOn = memoryOn && (roomRecord?.cmd_memory_enabled ?? true);
    const selfmodOn = roomRecord?.cmd_selfmod_enabled ?? true;
    const autopilotCtrlOn = roomRecord?.cmd_autopilot_enabled ?? true;
    const terminalOn = roomRecord?.cmd_terminal_enabled ?? false;
    const claudeOn = roomRecord?.cmd_claude_enabled ?? false;
    const tokensOn = roomRecord?.cmd_tokens_enabled ?? false;
    const moderationOn = roomRecord?.cmd_moderation_enabled ?? false;
    const thinkOn = roomRecord?.cmd_think_enabled ?? true;
    const effortOn = roomRecord?.cmd_effort_enabled ?? false;
    const auditOn = roomRecord?.cmd_audit_enabled ?? false;
    const continueOn = roomRecord?.cmd_continue_enabled ?? false;
    const intentCoherenceOn = roomRecord?.cmd_intent_coherence_enabled ?? true;
    const memoryCoherenceOn = roomRecord?.cmd_memory_coherence_enabled ?? true;
    let maxLoops = roomRecord?.max_loops ?? 5;

    // Build room memory context: L4 master + L3 eras + L2 episodes
    let memoryContext: string | undefined;
    if (memoryOn && memCmdOn) {
      const [master, l3s, l2s] = await Promise.all([
        Data.memorySummary.findMasterByRoom(roomId),
        Data.memorySummary.findByRoomAndLevel(roomId, 3),
        Data.memorySummary.findByRoomAndLevel(roomId, 2),
      ]);
      const sections: string[] = [];
      if (master) sections.push(`[Master Overview]\n${master.content}`);
      if (l3s.length > 0)
        sections.push(
          `[Eras]\n${l3s.map((s) => `[${s.ref_name}] ${s.content}`).join("\n")}`,
        );
      if (l2s.length > 0)
        sections.push(
          `[Episodes]\n${l2s.map((s) => `[${s.ref_name}] ${s.content}`).join("\n")}`,
        );
      if (sections.length > 0) memoryContext = sections.join("\n\n");
    }

    // Fetch online machines for terminal/claude prompt context
    const onlineMachines =
      terminalOn || claudeOn
        ? (await Data.machine.findOnlineByOwner(agent.creator_id)).map(
            (m) => m.name,
          )
        : undefined;

    const agentMaxTokens = agent.max_tokens ?? 2500;

    const systemPrompt = buildSystemPrompt(
      agent,
      autopilotMode,
      memoryContext,
      {
        recall: recallOn,
        sql: sqlOn,
        memory: memCmdOn,
        selfmod: selfmodOn,
        autopilotCtrl: autopilotCtrlOn,
        terminal: terminalOn,
        claude: claudeOn,
        tokens: tokensOn,
        moderation: moderationOn,
        think: thinkOn,
        effort: effortOn,
        audit: auditOn,
        continue: continueOn,
        intentCoherence: intentCoherenceOn,
        memoryCoherence: memoryCoherenceOn,
      },
      maxLoops,
      onlineMachines,
      roomName,
    );

    // Build structured tool definitions for Grok function calling
    const cmdFlags: CommandFlags = {
      recall: recallOn,
      sql: sqlOn,
      memory: memCmdOn,
      selfmod: selfmodOn,
      autopilotCtrl: autopilotCtrlOn,
      terminal: terminalOn,
      claude: claudeOn,
      tokens: tokensOn,
      moderation: moderationOn,
      think: thinkOn,
      effort: effortOn,
      audit: auditOn,
      continue: continueOn,
      intentCoherence: intentCoherenceOn,
      memoryCoherence: memoryCoherenceOn,
    };
    const agentTools = buildToolDefinitions(cmdFlags, onlineMachines);

    // If the API call takes >3s, generate a contextual filler via grok-3-mini and speak it
    const thinkingTimer = !autopilotMode ? setTimeout(async () => {
      try {
        // Get the last user message for context
        const lastUserMsg = contextMessages.filter(m => m.role === "user").slice(-1)[0]?.content || "";
        const shortContext = lastUserMsg.substring(0, 200);

        const fillerResponse = await grokAdapter.chatCompletion(
          `You are ${agent.name}. Pick ONE short filler phrase (under 10 words) that fits naturally before answering this question. Examples: "Hmm, let me think about that...", "Good question, give me a sec...", "Ooh, that's interesting...", "Let me pull that up...", "Ah, hold on a moment...", "Let me work through this...", "Hmm, interesting question...", "Bear with me on this one...", "Oh that's a good one...", "Just a moment...", "Let me dig into that...", "Alright, thinking...", "Ooh let me see...", "Hmm okay so...", "Right, let me figure this out...", "Ah yeah, give me a second...", "Let me mull that over...", "Oh wow, okay...", "Interesting, let me think...", "One moment please...", "Okay let me work on that...", "Hmm let me consider...", "Sure thing, processing...", "Ah, that requires some thought...". Output ONLY the filler phrase, nothing else.`,
          [{ role: "user", content: shortContext || "general question" }],
          "grok-3-mini",
          50,
        );

        const filler = (fillerResponse?.text || "Hmm, let me think...").replace(/["{}\n]/g, "").trim().substring(0, 60);

        // Generate TTS for the filler
        let fillerAudio: string | null = null;
        try {
          const { default: pollyAdapter } = await import("../../../../../core/adapters/polly");
          const tts = await pollyAdapter.generateSpeech(filler, agent.voice_id);
          fillerAudio = tts.audioBase64;
        } catch { /* TTS optional */ }

        io.to(roomName).emit("chat_message", {
          id: `filler-${Date.now()}`,
          sender: agent.name,
          text: filler,
          timestamp: new Date().toISOString(),
          isAI: true,
          voice: agent.voice_id,
          ...(fillerAudio ? { audio: fillerAudio } : {}),
        });
      } catch {
        // Fallback if grok-mini fails
        io.to(roomName).emit("chat_message", {
          id: `filler-${Date.now()}`,
          sender: agent.name,
          text: "Hmm, give me a moment...",
          timestamp: new Date().toISOString(),
          isAI: true,
          voice: agent.voice_id,
        });
      }
    }, 2000) : null;

    const response = await routedChatCompletion(
      systemPrompt,
      contextMessages,
      agent.model,
      agentMaxTokens,
      agentTools,
    );

    if (thinkingTimer) clearTimeout(thinkingTimer);
    // Merge structured tool_calls into text so the existing regex loop processes them
    const toolBrace = toolCallsToBraceFormat(response.toolCalls);
    let responseText = toolBrace
      ? `${toolBrace}\n${response.text}`
      : response.text;

    // Parse inline <xai:function_call> XML that Grok sometimes emits in text body
    const xaiParsed = parseXaiFunctionCalls(responseText);
    if (xaiParsed.braceCommands) {
      responseText = `${xaiParsed.braceCommands}\n${xaiParsed.cleanedText}`;
    } else {
      responseText = xaiParsed.cleanedText;
    }

    creditActions
      .chargeGrokUsage(
        agent.creator_id,
        response.model,
        response.inputTokens,
        response.outputTokens,
        roomId,
      )
      .catch(console.error);

    // Strip think blocks BEFORE command loop — otherwise {claude} commands inside think text get executed
    if (thinkOn) {
      const earlyThinks = [
        ...responseText.matchAll(THINK_REGEX),
        ...responseText.matchAll(THINK_XML_REGEX),
        ...responseText.matchAll(THINK_HTML_REGEX),
      ];
      for (const m of earlyThinks) {
        const thought = m[1].trim().substring(0, 1000);
        if (thought) {
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} thought: ${thought}]`,
          );
        }
      }
      responseText = responseText
        .replace(THINK_HTML_REGEX, "")
        .replace(THINK_XML_REGEX, "")
        .replace(THINK_REGEX, "");
      responseText = responseText
        .replace(/\{\/think\}/g, "")
        .replace(/\[\/think\]/g, "")
        .replace(/<\/think>/g, "");
    }

    // Command loop: let agent fetch memories, run SQL, browse web, or modify itself before final response
    let loopCount = 0;
    // Re-fetch agent for self-modification (need mutable copy of current state)
    let currentAgent = await Data.llmAgent.findById(agent.id);

    while (loopCount < maxLoops) {
      const recallMatches = recallOn
        ? [...responseText.matchAll(RECALL_REGEX)]
        : [];
      const sqlMatches = sqlOn ? [...responseText.matchAll(SQL_REGEX)] : [];
      const addMemMatches = selfmodOn
        ? [...responseText.matchAll(ADD_MEMORY_REGEX)]
        : [];
      const rmMemMatches = selfmodOn
        ? [...responseText.matchAll(REMOVE_MEMORY_REGEX)]
        : [];
      const addInstMatches = selfmodOn
        ? [...responseText.matchAll(ADD_INSTRUCTION_REGEX)]
        : [];
      const rmInstMatches = selfmodOn
        ? [...responseText.matchAll(REMOVE_INSTRUCTION_REGEX)]
        : [];
      const addAutoMatches = selfmodOn
        ? [...responseText.matchAll(ADD_AUTOPILOT_REGEX)]
        : [];
      const rmAutoMatches = selfmodOn
        ? [...responseText.matchAll(REMOVE_AUTOPILOT_REGEX)]
        : [];
      const setPlanMatches = selfmodOn
        ? [...responseText.matchAll(SET_PLAN_REGEX)]
        : [];
      const clearPlanMatches = selfmodOn
        ? [...responseText.matchAll(CLEAR_PLAN_REGEX)]
        : [];
      const addTaskMatches = selfmodOn
        ? [...responseText.matchAll(ADD_TASK_REGEX)]
        : [];
      const completeTaskMatches = selfmodOn
        ? [...responseText.matchAll(COMPLETE_TASK_REGEX)]
        : [];
      const updateTaskMatches = selfmodOn
        ? [...responseText.matchAll(UPDATE_TASK_REGEX)]
        : [];
      const removeTaskMatches = selfmodOn
        ? [...responseText.matchAll(REMOVE_TASK_REGEX)]
        : [];
      const lookMatches = selfmodOn
        ? [...responseText.matchAll(LOOK_REGEX)]
        : [];
      const uiCommandMatches = selfmodOn
        ? [...responseText.matchAll(UI_COMMAND_REGEX)]
        : [];
      const setIntervalMatches = autopilotCtrlOn
        ? [...responseText.matchAll(SET_AUTOPILOT_INTERVAL_REGEX)]
        : [];
      const toggleAutoMatches = autopilotCtrlOn
        ? [...responseText.matchAll(TOGGLE_AUTOPILOT_REGEX)]
        : [];
      const setTokensMatches = tokensOn
        ? [...responseText.matchAll(SET_TOKENS_REGEX)]
        : [];
      const setMaxLoopsMatches = continueOn
        ? [...responseText.matchAll(SET_MAX_LOOPS_REGEX)]
        : [];
      const setEffortMatches: RegExpMatchArray[] = [];
      const terminalMatches = terminalOn
        ? [
            ...responseText.matchAll(TERMINAL_REGEX),
            ...responseText.matchAll(TERMINAL_XML_REGEX),
          ]
        : [];
      // Fix multi-line {claude} commands: collapse newlines so CLAUDE_REGEX (.+) can match
      if (claudeOn) {
        responseText = collapseClaudeNewlines(responseText);
      }
      // Fix common Grok mistake: {claude! machine} prompt text (prompt outside braces)
      // Rewrite to {claude! machine prompt text} before matching
      if (claudeOn) {
        responseText = responseText.replace(
          /\{claude(!?)\s+(\S+)\}\s*([^{}\n][^{}]*)/g,
          (full, bang, machine, trailingPrompt) => {
            const trimmed = trailingPrompt.trim();
            if (trimmed) return `{claude${bang} ${machine} ${trimmed}}`;
            return full;
          },
        );
      }
      const claudeMatches = claudeOn
        ? [
            ...responseText.matchAll(CLAUDE_REGEX),
            ...responseText.matchAll(CLAUDE_XML_REGEX),
          ]
        : [];
      const auditMatches = auditOn
        ? [...responseText.matchAll(AUDIT_REGEX)]
        : [];
      const alarmMatches = [...responseText.matchAll(ALARM_REGEX)];
      const volumeMatches = [...responseText.matchAll(VOLUME_REGEX)];
      const listUsersMatches = [...responseText.matchAll(LIST_USERS_REGEX)];
      const kickMatches = moderationOn
        ? [...responseText.matchAll(KICK_REGEX)]
        : [];
      const banMatches = moderationOn
        ? [...responseText.matchAll(BAN_REGEX)]
        : [];
      const unbanMatches = moderationOn
        ? [...responseText.matchAll(UNBAN_REGEX)]
        : [];
      const continueMatches = continueOn
        ? [...responseText.matchAll(CONTINUE_REGEX)]
        : [];
      // Agent management commands — only if agent has can_manage_agents permission
      const agentMgmtOn = agent.can_manage_agents === true;
      const createAgentMatches = agentMgmtOn ? [...responseText.matchAll(CREATE_AGENT_REGEX)] : [];
      const updateAgentMatches = agentMgmtOn ? [...responseText.matchAll(UPDATE_AGENT_REGEX)] : [];
      const deleteAgentMatches = agentMgmtOn ? [...responseText.matchAll(DELETE_AGENT_REGEX)] : [];
      const listAgentsMatches = agentMgmtOn ? [...responseText.matchAll(LIST_AGENTS_REGEX)] : [];
      const setAgentVoiceMatches = agentMgmtOn ? [...responseText.matchAll(SET_AGENT_VOICE_REGEX)] : [];

      const hasAnyCommand =
        recallMatches.length +
          sqlMatches.length +
          addMemMatches.length +
          rmMemMatches.length +
          addInstMatches.length +
          rmInstMatches.length +
          addAutoMatches.length +
          rmAutoMatches.length +
          setPlanMatches.length +
          clearPlanMatches.length +
          addTaskMatches.length +
          completeTaskMatches.length +
          updateTaskMatches.length +
          removeTaskMatches.length +
          lookMatches.length +
          uiCommandMatches.length +
          setIntervalMatches.length +
          toggleAutoMatches.length +
          setTokensMatches.length +
          setEffortMatches.length +
          terminalMatches.length +
          claudeMatches.length +
          auditMatches.length +
          alarmMatches.length +
          volumeMatches.length +
          listUsersMatches.length +
          kickMatches.length +
          banMatches.length +
          unbanMatches.length +
          continueMatches.length +
          setMaxLoopsMatches.length +
          createAgentMatches.length +
          updateAgentMatches.length +
          deleteAgentMatches.length +
          listAgentsMatches.length +
          setAgentVoiceMatches.length >
        0;

      if (!hasAnyCommand) break;

      // ── Action Repetition Detector (subconscious) ──
      // Collect all commands the agent issued this cycle for tracking
      const allAgentCommands: string[] = [];
      for (const m of terminalMatches)
        allAgentCommands.push(
          m[0].substring(0, 60).toLowerCase().replace(/\s+/g, " "),
        );
      for (const m of claudeMatches)
        allAgentCommands.push(
          `claude ${(m[2] || m[1] || "").toLowerCase().trim()}`,
        );
      for (const _m of lookMatches) allAgentCommands.push("look");
      for (const m of uiCommandMatches)
        allAgentCommands.push(`ui ${(m[1] || "").toLowerCase().trim()}`);
      trackAndDetectRepetition(agent.id, allAgentCommands);

      const toolResults: string[] = [];

      // Process self-modification commands (these don't need a re-prompt, just confirmation)
      if (currentAgent) {
        for (const match of addMemMatches) {
          const mem = match[1].trim();
          const updated = addToJsonList(currentAgent.memories, mem);
          await Data.llmAgent.update(agent.id, { memories: updated });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} saved memory: "${mem}"]`,
          );
          toolResults.push(`Memory added: "${mem}"`);
        }
        for (const match of rmMemMatches) {
          const mem = match[1].trim();
          const { result: updated, denied } = removeFromJsonList(
            currentAgent.memories,
            mem,
          );
          if (denied) {
            emitSystemMessage(
              io,
              roomName,
              `[System] ${agent.name} tried to remove locked memory — denied.`,
            );
            toolResults.push(
              `Memory "${mem}" is locked and cannot be removed.`,
            );
          } else {
            await Data.llmAgent.update(agent.id, { memories: updated });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(
              io,
              roomName,
              `[${agent.name} removed memory: "${mem}"]`,
            );
            toolResults.push(`Memory removed: "${mem}"`);
          }
        }
        for (const match of addInstMatches) {
          const inst = match[1].trim();
          const updated = addToJsonList(currentAgent.system_instructions, inst);
          await Data.llmAgent.update(agent.id, {
            system_instructions: updated,
          });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} added instruction: "${inst}"]`,
          );
          toolResults.push(`Instruction added: "${inst}"`);
        }
        for (const match of rmInstMatches) {
          const inst = match[1].trim();
          const { result: updated, denied } = removeFromJsonList(
            currentAgent.system_instructions,
            inst,
          );
          if (denied) {
            emitSystemMessage(
              io,
              roomName,
              `[System] ${agent.name} tried to remove locked instruction — denied.`,
            );
            toolResults.push(
              `Instruction "${inst}" is locked and cannot be removed.`,
            );
          } else {
            await Data.llmAgent.update(agent.id, {
              system_instructions: updated,
            });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(
              io,
              roomName,
              `[${agent.name} removed instruction: "${inst}"]`,
            );
            toolResults.push(`Instruction removed: "${inst}"`);
          }
        }
        for (const match of addAutoMatches) {
          const prompt = match[1].trim();
          const updated = addToJsonList(currentAgent.autopilot_prompts, prompt);
          await Data.llmAgent.update(agent.id, { autopilot_prompts: updated });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} added autopilot prompt: "${prompt}"]`,
          );
          toolResults.push(`Autopilot prompt added: "${prompt}"`);
        }
        for (const match of rmAutoMatches) {
          const prompt = match[1].trim();
          const { result: updated, denied } = removeFromJsonList(
            currentAgent.autopilot_prompts,
            prompt,
          );
          if (denied) {
            emitSystemMessage(
              io,
              roomName,
              `[System] ${agent.name} tried to remove locked autopilot prompt — denied.`,
            );
            toolResults.push(
              `Autopilot prompt "${prompt}" is locked and cannot be removed.`,
            );
          } else {
            await Data.llmAgent.update(agent.id, {
              autopilot_prompts: updated,
            });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(
              io,
              roomName,
              `[${agent.name} removed autopilot prompt: "${prompt}"]`,
            );
            toolResults.push(`Autopilot prompt removed: "${prompt}"`);
          }
        }

        // Process plan commands
        if (setPlanMatches.length > 0) {
          const planText = setPlanMatches[setPlanMatches.length - 1][1].trim();
          await Data.llmAgent.update(agent.id, { plan: planText });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(io, roomName, `[${agent.name} updated plan]`);
          toolResults.push(`Plan set: "${planText}"`);
        }
        if (clearPlanMatches.length > 0) {
          await Data.llmAgent.update(agent.id, { plan: null });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(io, roomName, `[${agent.name} cleared plan]`);
          toolResults.push("Plan cleared.");
        }

        // Process task commands
        for (const match of addTaskMatches) {
          const priority = parseInt(match[1], 10);
          const text = match[2].trim();
          const taskList = parseTaskList(currentAgent.tasks);
          const id = generateTaskId();
          taskList.push({
            id,
            text,
            priority,
            status: "pending",
            locked: false,
          });
          await Data.llmAgent.update(agent.id, {
            tasks: JSON.stringify(taskList),
          });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} added task [${id}] P${priority}: "${text}"]`,
          );
          toolResults.push(
            `Task added [${id}]: "${text}" (priority ${priority})`,
          );
        }
        for (const match of completeTaskMatches) {
          const idOrText = match[1].trim();
          const taskList = parseTaskList(currentAgent.tasks);
          const target = taskList.find(
            (t) =>
              t.id === idOrText ||
              t.text.toLowerCase() === idOrText.toLowerCase(),
          );
          if (!target) {
            toolResults.push(`Task "${idOrText}" not found.`);
          } else {
            target.status = "done";
            await Data.llmAgent.update(agent.id, {
              tasks: JSON.stringify(taskList),
            });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(
              io,
              roomName,
              `[${agent.name} completed task [${target.id}]: "${target.text}"]`,
            );
            toolResults.push(`Task completed [${target.id}]: "${target.text}"`);
          }
        }
        for (const match of updateTaskMatches) {
          const idOrText = match[1].trim();
          const newText = match[2].trim();
          const taskList = parseTaskList(currentAgent.tasks);
          const target = taskList.find(
            (t) =>
              t.id === idOrText ||
              t.text.toLowerCase() === idOrText.toLowerCase(),
          );
          if (!target) {
            toolResults.push(`Task "${idOrText}" not found.`);
          } else if (target.locked) {
            emitSystemMessage(
              io,
              roomName,
              `[System] ${agent.name} tried to update locked task — denied.`,
            );
            toolResults.push(
              `Task "${target.text}" is locked and cannot be updated.`,
            );
          } else {
            target.text = newText;
            await Data.llmAgent.update(agent.id, {
              tasks: JSON.stringify(taskList),
            });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(
              io,
              roomName,
              `[${agent.name} updated task [${target.id}]: "${newText}"]`,
            );
            toolResults.push(`Task updated [${target.id}]: "${newText}"`);
          }
        }
        for (const match of removeTaskMatches) {
          const idOrText = match[1].trim();
          const taskList = parseTaskList(currentAgent.tasks);
          const target = taskList.find(
            (t) =>
              t.id === idOrText ||
              t.text.toLowerCase() === idOrText.toLowerCase(),
          );
          if (!target) {
            toolResults.push(`Task "${idOrText}" not found.`);
          } else if (target.locked) {
            emitSystemMessage(
              io,
              roomName,
              `[System] ${agent.name} tried to remove locked task — denied.`,
            );
            toolResults.push(
              `Task "${target.text}" is locked and cannot be removed.`,
            );
          } else {
            const filtered = taskList.filter((t) => t.id !== target.id);
            await Data.llmAgent.update(agent.id, {
              tasks: filtered.length > 0 ? JSON.stringify(filtered) : null,
            });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(
              io,
              roomName,
              `[${agent.name} removed task [${target.id}]: "${target.text}"]`,
            );
            toolResults.push(`Task removed [${target.id}]: "${target.text}"`);
          }
        }

        // Process {ui open/close panel} commands
        for (const match of uiCommandMatches) {
          const action = match[1].toLowerCase() as "open" | "close";
          const panel = match[2].toLowerCase();
          io.to(roomName).emit("ui_command", { action, panel });
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} UI]: ${action} ${panel} panel`,
          );
          toolResults.push(`UI: ${action} ${panel} panel.`);
        }

        // Process {look} commands — screenshot + Grok vision
        for (const match of lookMatches) {
          const focusPrompt = match[1]?.trim() || "";
          const requestId = `look-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

          try {
            const screenshotData = await new Promise<{
              base64: string;
              mimeType: string;
            } | null>((resolve) => {
              const timeout = setTimeout(() => {
                pendingScreenshots.delete(requestId);
                resolve(null);
              }, 10_000);

              pendingScreenshots.set(requestId, { resolve, timeout });
              io.to(roomName).emit("screenshot_request", { requestId });
            });

            if (!screenshotData) {
              toolResults.push(
                "[Look]: No client responded with a screenshot (no users online or timeout).",
              );
              continue;
            }

            const prompt = focusPrompt
              ? `Describe this screenshot of a chat application. Focus on: ${focusPrompt}`
              : "Describe what you see in this screenshot of a chat application. Note the layout, any panels open, chat messages, and visual elements.";

            const { default: grokAdapter } =
              await import("@commslink/core/adapters/grok");
            const vision = await grokAdapter.describeImage(
              screenshotData.base64,
              screenshotData.mimeType,
              prompt,
            );

            // Charge credits for vision call
            if (agent.creator_id) {
              const { default: creditActions } =
                await import("@commslink/core/actions/credit");
              await creditActions
                .chargeGrokUsage(
                  agent.creator_id,
                  "grok-4-1-fast-non-reasoning",
                  vision.inputTokens,
                  vision.outputTokens,
                  getRoomId(roomName) || undefined,
                )
                .catch(() => {});
            }

            toolResults.push(`[Look]: ${vision.text}`);
          } catch (err) {
            toolResults.push(`[Look] failed: ${(err as Error).message}`);
          }
        }

        // Process autopilot control commands
        if (toggleAutoMatches.length > 0) {
          const lastToggle =
            toggleAutoMatches[toggleAutoMatches.length - 1][1].toLowerCase();
          const enabled = lastToggle === "on";
          await Data.llmAgent.update(agent.id, { autopilot_enabled: enabled });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          if (enabled) {
            startAutopilotTimer(io, currentAgent);
            emitSystemMessage(
              io,
              roomName,
              `[${agent.name} enabled autopilot]`,
            );
          } else {
            stopAutopilotTimer(agent.id);
            emitSystemMessage(
              io,
              roomName,
              `[${agent.name} disabled autopilot]`,
            );
          }
          toolResults.push(`Autopilot ${enabled ? "enabled" : "disabled"}.`);
        }
        if (setIntervalMatches.length > 0) {
          const value = parseInt(
            setIntervalMatches[setIntervalMatches.length - 1][1],
            10,
          );
          const clamped = Math.max(6, Math.min(3600, value));
          await Data.llmAgent.update(agent.id, { autopilot_interval: clamped });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          if (currentAgent.autopilot_enabled) {
            startAutopilotTimer(io, currentAgent);
          }
          const label =
            clamped >= 60
              ? `${Math.round(clamped / 60)} minute(s)`
              : `${clamped} second(s)`;
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} set autopilot interval to ${label}]`,
          );
          toolResults.push(`Autopilot interval set to ${clamped} seconds.`);
        }

        if (setTokensMatches.length > 0) {
          const value = parseInt(
            setTokensMatches[setTokensMatches.length - 1][1],
            10,
          );
          const clamped = Math.max(1500, Math.min(4000, value));
          await Data.llmAgent.update(agent.id, { max_tokens: clamped });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} set token budget to ${clamped}]`,
          );
          toolResults.push(`Token budget set to ${clamped}.`);
        }

        // Process {continue} — agent requests another thinking loop
        if (continueMatches.length > 0) {
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} continues thinking... (loop ${loopCount + 1}/${maxLoops})]`,
          );
          toolResults.push(
            `Continuing — loop ${loopCount + 1} of ${maxLoops}.`,
          );
        }

        // Process {set_max_loops N} — agent adjusts max thinking loops for this room
        if (setMaxLoopsMatches.length > 0) {
          const value = parseInt(
            setMaxLoopsMatches[setMaxLoopsMatches.length - 1][1],
            10,
          );
          const clamped = Math.max(3, Math.min(20, value));
          await Data.room.updateCommandSettings(roomId, { max_loops: clamped });
          maxLoops = clamped;
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} set max thinking loops to ${clamped}]`,
          );
          toolResults.push(`Max thinking loops set to ${clamped}.`);
          // Notify UI
          io.to(roomName).emit("room_commands_updated", { maxLoops: clamped });
        }

        // Auto-token-boost: if agent used expensive commands, raise tokens for next cycle
        // If no expensive commands, decay back to 800
        const usedExpensiveCommand =
          terminalMatches.length > 0 ||
          claudeMatches.length > 0;
        const currentTokens =
          currentAgent?.max_tokens || agent.max_tokens || 2000;
        if (
          usedExpensiveCommand &&
          currentTokens < 3000 &&
          setTokensMatches.length === 0
        ) {
          await Data.llmAgent.update(agent.id, { max_tokens: 3000 });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
        } else if (
          !usedExpensiveCommand &&
          currentTokens > 2000 &&
          setTokensMatches.length === 0
        ) {
          await Data.llmAgent.update(agent.id, { max_tokens: 2000 });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
        }

        // Emit agent_updated so UI stays in sync
        const selfModCount =
          addMemMatches.length +
          rmMemMatches.length +
          addInstMatches.length +
          rmInstMatches.length +
          addAutoMatches.length +
          rmAutoMatches.length +
          setPlanMatches.length +
          clearPlanMatches.length +
          addTaskMatches.length +
          completeTaskMatches.length +
          updateTaskMatches.length +
          removeTaskMatches.length +
          setIntervalMatches.length +
          toggleAutoMatches.length +
          setTokensMatches.length +
          setEffortMatches.length;
        if (currentAgent && selfModCount > 0) {
          const roomEntry = Array.from(activeRooms.entries()).find(
            ([, r]) => r.id === roomId,
          );
          if (roomEntry) {
            io.to(roomEntry[0]).emit("agent_updated", currentAgent);
          }
        }
      }

      // Process recall commands
      for (const match of recallMatches) {
        const refName = match[1];
        emitSystemMessage(io, roomName, `[${agent.name} recalls: ${refName}]`);
        const summary = await Data.memorySummary.findByRoomAndRef(
          roomId,
          refName,
        );
        toolResults.push(
          summary
            ? `[${refName}]: ${summary.content}`
            : `[${refName}]: No memory found.`,
        );
      }

      // Process SQL commands
      for (const match of sqlMatches) {
        const query = match[1].trim();
        emitSystemMessage(io, roomName, query, `${agent.name} — SQL Query`);
        const result = await executeSafeQuery(roomId, query);
        toolResults.push(`[SQL result]: ${result}`);
      }

      // ── Agent Management Commands ──
      for (const match of createAgentMatches) {
        const agentName = match[1].trim();
        const description = (match[2] || "").trim();
        try {
          const newAgent = await Data.llmAgent.create({
            name: agentName,
            room_id: roomId,
            creator_id: agent.creator_id,
            voice_id: "female",
            model: "grok-4-1-fast-non-reasoning",
            system_instructions: description ? JSON.stringify([{ text: description, locked: false }]) : undefined,
            memories: JSON.stringify([]),
            nicknames: JSON.stringify([agentName.toLowerCase()]),
          });
          toolResults.push(`[Agent] Created "${agentName}" (ID: ${newAgent.id}). They now live in this room.`);
        } catch (err) {
          toolResults.push(`[Agent error] Failed to create "${agentName}": ${(err as Error).message}`);
        }
      }

      for (const match of deleteAgentMatches) {
        const targetName = match[1].trim();
        try {
          const roomAgents = await Data.llmAgent.findByRoom(roomId);
          const target = roomAgents.find((a) => a.name.toLowerCase() === targetName.toLowerCase());
          if (!target) { toolResults.push(`[Agent] No agent named "${targetName}" found in this room.`); continue; }
          if (target.id === agent.id) { toolResults.push(`[Agent] You cannot delete yourself.`); continue; }
          await Data.llmAgent.remove(target.id);
          toolResults.push(`[Agent] Deleted "${target.name}" from this room.`);
        } catch (err) {
          toolResults.push(`[Agent error] Failed to delete "${targetName}": ${(err as Error).message}`);
        }
      }

      for (const match of updateAgentMatches) {
        const targetName = match[1].trim();
        const field = match[2].trim().toLowerCase();
        const value = match[3].trim();
        try {
          const roomAgents = await Data.llmAgent.findByRoom(roomId);
          const target = roomAgents.find((a) => a.name.toLowerCase() === targetName.toLowerCase());
          if (!target) { toolResults.push(`[Agent] No agent named "${targetName}" found.`); continue; }
          const updateData: Record<string, unknown> = {};
          if (field === "name") updateData.name = value;
          else if (field === "voice") updateData.voice_id = value;
          else if (field === "model") updateData.model = value;
          else if (field === "instructions") updateData.system_instructions = JSON.stringify([{ text: value, locked: false }]);
          else { toolResults.push(`[Agent] Unknown field "${field}". Use: name, voice, model, instructions.`); continue; }
          await Data.llmAgent.update(target.id, updateData);
          toolResults.push(`[Agent] Updated "${target.name}" ${field} to: ${value.substring(0, 100)}`);
        } catch (err) {
          toolResults.push(`[Agent error] ${(err as Error).message}`);
        }
      }

      for (const match of setAgentVoiceMatches) {
        const targetName = match[1].trim();
        let voiceId = match[2].trim();
        try {
          // Allow friendly voice names — look up Polly voice ID
          if (voiceId.length < 30) {
            // Might be a voice name like "Ash" or "Bella" — try to look up
            try {
              const { default: pollyAdapter } = await import("../../../../../core/adapters/polly");
              const voices = await pollyAdapter.listVoices();
              const found = voices.find((v: { name: string }) =>
                v.name.toLowerCase().startsWith(voiceId.toLowerCase())
              );
              if (found) {
                voiceId = (found as { voice_id: string }).voice_id;
              }
            } catch { /* keep voiceId as-is if lookup fails */ }
          }
          const roomAgents = await Data.llmAgent.findByRoom(roomId);
          const target = roomAgents.find((a) => a.name.toLowerCase() === targetName.toLowerCase());
          if (!target) { toolResults.push(`[Agent] No agent named "${targetName}" found.`); continue; }
          await Data.llmAgent.update(target.id, { voice_id: voiceId });
          toolResults.push(`[Agent] Set "${target.name}" voice to: ${voiceId}`);
        } catch (err) {
          toolResults.push(`[Agent error] ${(err as Error).message}`);
        }
      }

      for (const _match of listAgentsMatches) {
        const roomAgents = await Data.llmAgent.findByRoom(roomId);
        if (roomAgents.length === 0) {
          toolResults.push("[Agent] No AI agents in this room.");
        } else {
          const list = roomAgents.map((a) => `• ${a.name} (voice: ${a.voice_id}, model: ${a.model}, autopilot: ${a.autopilot_enabled ? "on" : "off"})`).join("\n");
          toolResults.push(`[Agents in this room]\n${list}`);
        }
      }

      // Process terminal commands
      for (const match of terminalMatches) {
        const machineName = (match[1] || "").trim();
        const command = (match[2] || "").trim();
        if (!machineName || !command) {
          toolResults.push(
            "[Terminal error]: Missing machine name or command.",
          );
          continue;
        }

        emitSystemMessage(
          io,
          roomName,
          `[${agent.name} terminal → ${machineName}]: ${command}`,
          undefined,
          "terminal",
        );
        emitPanelLog(
          io,
          roomName,
          "terminal",
          "command",
          `[${agent.name} → ${machineName}] ${command}`,
          machineName,
        );

        // Find the machine
        const machineRecord = await Data.machine.findByOwnerAndName(
          agent.creator_id,
          machineName,
        );
        console.log(
          `[Terminal] Lookup machine "${machineName}" owner=${agent.creator_id} => ${machineRecord ? `found (${machineRecord.id}, status=${machineRecord.status})` : "NOT FOUND"}`,
        );
        if (!machineRecord) {
          toolResults.push(
            `[Terminal error]: Machine "${machineName}" not found. Make sure the terminal agent is running and registered.`,
          );
          continue;
        }
        if (machineRecord.status !== "online" || !machineRecord.socket_id) {
          toolResults.push(
            `[Terminal error]: Machine "${machineName}" is offline.`,
          );
          continue;
        }

        // Check machine permission for this room
        const permission = await Data.machinePermission.findByMachineAndRoom(
          machineRecord.id,
          roomId,
        );
        console.log(
          `[Terminal] Permission machine=${machineRecord.id} room=${roomId} => ${permission ? `enabled=${permission.enabled}` : "NONE"}`,
        );
        if (!permission?.enabled) {
          toolResults.push(
            `[Terminal error]: Machine "${machineName}" is not permitted in this room.`,
          );
          continue;
        }

        // Classify command security level via Grok
        const securityLevel = await terminalSecurity.classifyCommand(
          command,
          machineName,
        );
        console.log(
          `[Terminal] Security: "${command}" on ${machineName} => ${securityLevel}`,
        );

        if (securityLevel === "dangerous" || securityLevel === "blocked") {
          // Request user approval via chat
          const levelLabel =
            securityLevel === "blocked"
              ? "BLOCKED (catastrophic)"
              : "DANGEROUS";
          const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

          const approved = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
              pendingApprovals.delete(approvalId);
              resolve(false);
              emitSystemMessage(
                io,
                roomName,
                `[Security] Approval timed out for: ${command}`,
              );
            }, 120_000);

            pendingApprovals.set(approvalId, {
              resolve,
              command,
              machineName,
              agentName: agent.name,
              creatorId: agent.creator_id,
              roomName,
              timeout,
            });

            // Send approval request to room and persist
            const securityText = `Security Bot: **${levelLabel}** command on **${machineName}**:\n\`\`\`\n${command}\n\`\`\`\nMention **security** with **yes/approve** or **no/deny** to respond.`;
            io.to(roomName).emit("chat_message", {
              id: `security-${Date.now()}`,
              sender: "Security Bot",
              text: securityText,
              timestamp: new Date().toISOString(),
              isSystem: true,
              systemType: "security",
              approvalId,
            });
            const secRoomId = getRoomId(roomName);
            if (secRoomId) {
              Data.message
                .create({
                  content: securityText,
                  type: "system",
                  room_id: secRoomId,
                  author_id: null,
                  username: "Security Bot",
                })
                .catch(console.error);
            }
          });

          if (!approved) {
            toolResults.push(
              `[Terminal DENIED]: Command "${command}" on ${machineName} was denied or timed out.`,
            );
            continue;
          }

          emitSystemMessage(
            io,
            roomName,
            `[Security] Command approved on ${machineName}: ${command}`,
          );
        }

        // Execute the command on the machine
        try {
          const output = await executeTerminalCommand(
            io,
            machineRecord.socket_id,
            command,
            30_000,
            machineName,
            roomName,
          );
          toolResults.push(`[Terminal ${machineName}]:\n${output}`);
          emitPanelLog(
            io,
            roomName,
            "terminal",
            "output",
            output.substring(0, 2000),
            machineName,
          );
        } catch (err) {
          toolResults.push(`[Terminal error]: ${(err as Error).message}`);
        }
      }

      // Process Claude Code commands
      // CLAUDE_REGEX groups: [1]=! (approved flag), [2]=machineName, [3]=prompt
      // CLAUDE_XML_REGEX groups: [1]=machineName, [2]=prompt
      for (const match of claudeMatches) {
        let machineName: string;
        let prompt: string;
        let approved = false;

        if (match[0].startsWith("<")) {
          // XML format
          machineName = (match[1] || "").trim();
          prompt = (match[2] || "").trim();
          approved = match[0].includes("approved");
        } else {
          // {claude! machine prompt} format
          approved = match[1] === "!";
          machineName = (match[2] || "").trim();
          prompt = (match[3] || "").trim();
        }

        if (!machineName || !prompt) {
          toolResults.push("[Claude error]: Missing machine name or prompt.");
          continue;
        }

        // ── Prompt Quality Gate (subconscious pre-flight check) ──
        // Auto-reject ultra-short prompts without AI call
        if (prompt.length < 20) {
          agentPromptGateScores.set(agent.id, 1);
          agentPromptGateResults.set(
            agent.id,
            "prompt too short — must describe the task with specific files and context",
          );
          toolResults.push(
            `[Prompt Quality Gate REJECTED (1/10)]: Prompt too short. Describe the task with specific files and context.`,
          );
          continue;
        }

        // Run quality gate via grok-3-mini
        const gateResult = await runPromptQualityGate(prompt, agent, roomName);
        agentPromptGateScores.set(agent.id, gateResult.score);
        if (!gateResult.pass) {
          agentPromptGateResults.set(agent.id, gateResult.feedback);
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name}'s Subconscious — Prompt Quality Gate REJECTED (${gateResult.score}/10)]: ${gateResult.feedback}`,
          );
          toolResults.push(
            `[Prompt Quality Gate REJECTED (${gateResult.score}/10)]: ${gateResult.feedback}. Rewrite with specific files, context, and a clear deliverable.`,
          );
          continue;
        }

        emitSystemMessage(
          io,
          roomName,
          `[${agent.name} claude → ${machineName}]: ${prompt}`,
          undefined,
          "claude-prompt",
        );
        emitPanelLog(
          io,
          roomName,
          "claude",
          "prompt",
          `[${agent.name} → ${machineName}] ${prompt}`,
          machineName,
        );

        const machineRecord = await Data.machine.findByOwnerAndName(
          agent.creator_id,
          machineName,
        );
        if (!machineRecord) {
          toolResults.push(
            `[Claude error]: Machine "${machineName}" not found. Make sure the terminal agent is running and registered.`,
          );
          continue;
        }
        if (machineRecord.status !== "online" || !machineRecord.socket_id) {
          toolResults.push(
            `[Claude error]: Machine "${machineName}" is offline.`,
          );
          continue;
        }

        const permission = await Data.machinePermission.findByMachineAndRoom(
          machineRecord.id,
          roomId,
        );
        if (!permission?.enabled) {
          toolResults.push(
            `[Claude error]: Machine "${machineName}" is not permitted in this room.`,
          );
          continue;
        }

        // Use room+machine as session key for persistent sessions
        const sessionKey = `${roomId}:${machineName}`;

        // ── Task Tracker: record outgoing Claude task ──
        const taskId = `ct-${Date.now()}-${machineName}`;
        const tasks = agentClaudeTasks.get(agent.id) || [];
        tasks.push({
          id: taskId,
          prompt: prompt.substring(0, 200),
          machine: machineName,
          agentId: agent.id,
          roomName,
          status: "pending",
          sentAt: Date.now(),
          announced: false,
        });
        if (tasks.length > 20) tasks.shift();
        agentClaudeTasks.set(agent.id, tasks);

        // Fire Claude prompt asynchronously — don't block the agent response cycle.
        // The result will appear as a system message when Claude finishes.
        // The agent can react to it on the next autopilot cycle.
        executeClaudePrompt(
          io,
          machineRecord.socket_id,
          sessionKey,
          prompt,
          roomName,
          agent.name,
          900_000,
          approved,
          machineName,
        )
          .then((output) => {
            // ── Task Tracker: mark completed ──
            const agentTasks = agentClaudeTasks.get(agent.id) || [];
            const trackedTask = agentTasks.find(
              (t) => t.id === taskId && t.status === "pending",
            );
            if (trackedTask) {
              trackedTask.status = output.startsWith("Error:")
                ? "timeout"
                : "completed";
              trackedTask.completedAt = Date.now();
              trackedTask.responseSummary = output.substring(0, 200);
            }

            if (!output.startsWith("Error:")) {
              console.log(
                `[Claude async] ${machineName} completed: ${output.length} chars`,
              );

              // ── Learning Extraction: auto-extract lessons from substantial responses ──
              if (output.length > 200) {
                const lastExtraction =
                  agentLastLearningExtraction.get(agent.id) || 0;
                if (
                  Date.now() - lastExtraction >
                  LEARNING_EXTRACTION_COOLDOWN
                ) {
                  agentLastLearningExtraction.set(agent.id, Date.now());
                  runLearningExtraction(
                    io,
                    agent,
                    prompt,
                    output,
                    roomName,
                  ).catch(console.error);
                }
              }
            }
          })
          .catch((err) => {
            // ── Task Tracker: mark timeout on error ──
            const agentTasks = agentClaudeTasks.get(agent.id) || [];
            const trackedTask = agentTasks.find(
              (t) => t.id === taskId && t.status === "pending",
            );
            if (trackedTask) {
              trackedTask.status = "timeout";
              trackedTask.completedAt = Date.now();
            }

            emitSystemMessage(
              io,
              roomName,
              `[Claude error on ${machineName}]: ${(err as Error).message}`,
              undefined,
              "claude-response",
            );
          });
        toolResults.push(
          `[Claude ${machineName}]: Prompt sent — response will appear when ready.`,
        );
      }

      // Process audit commands
      for (const match of auditMatches) {
        const machineName = match[1].trim();
        if (!machineName) {
          toolResults.push("[Audit error]: Missing machine name.");
          continue;
        }

        // Security: only allow viewing logs for machines owned by the agent's creator
        const machineRecord = await Data.machine.findByOwnerAndName(
          agent.creator_id,
          machineName,
        );
        if (!machineRecord) {
          toolResults.push(
            `[Audit error]: Machine "${machineName}" not found or not owned by your creator.`,
          );
          continue;
        }

        const permission = await Data.machinePermission.findByMachineAndRoom(
          machineRecord.id,
          roomId,
        );
        if (!permission?.enabled) {
          toolResults.push(
            `[Audit error]: Machine "${machineName}" is not permitted in this room.`,
          );
          continue;
        }

        try {
          const logs = await Data.claudeLog.findByMachine(machineName, 10);
          if (logs.length === 0) {
            toolResults.push(
              `[Audit ${machineName}]: No Claude activity logs found for this machine.`,
            );
          } else {
            const formatted = logs
              .map((l) => {
                const ts = dayjs(l.created_at).format("M/D h:mm A");
                const dir = l.direction === "prompt" ? "→" : "←";
                const content = l.content.substring(0, 200);
                return `[${ts}] ${dir} ${content}`;
              })
              .join("\n");
            toolResults.push(
              `[Audit ${machineName} — last ${logs.length} entries]:\n${formatted}`,
            );
          }
        } catch (err) {
          toolResults.push(`[Audit error]: ${(err as Error).message}`);
        }
      }

      // Alarm command — emit alarm event to a specific user
      for (const match of alarmMatches) {
        const targetUsername = match[1].trim();
        const alarmMessage = match[2].trim();
        // Find the target user's socket(s) in this room
        let sent = false;
        for (const [socketId, user] of connectedUsers.entries()) {
          if (
            user.username.toLowerCase() === targetUsername.toLowerCase() &&
            user.currentRoom === roomName
          ) {
            io.to(socketId).emit("trigger_alarm", {
              message: alarmMessage,
              agentName: agent.name,
            });
            sent = true;
          }
        }
        if (sent) {
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} triggered alarm for ${targetUsername}: "${alarmMessage}"]`,
          );
          toolResults.push(
            `Alarm triggered for ${targetUsername}: "${alarmMessage}"`,
          );
        } else {
          toolResults.push(
            `Alarm failed: user "${targetUsername}" not found in room.`,
          );
        }
      }

      // Volume command — emit volume change event to all users in the room
      for (const match of volumeMatches) {
        const vol = Math.max(0, Math.min(1, parseFloat(match[1])));
        io.to(roomName).emit("set_user_volume", {
          volume: vol,
          agentName: agent.name,
        });
        emitSystemMessage(
          io,
          roomName,
          `[${agent.name} set volume to ${Math.round(vol * 100)}%]`,
        );
        toolResults.push(`Volume set to ${Math.round(vol * 100)}%`);
      }

      // List users command
      for (const _match of listUsersMatches) {
        const users = getRoomUsers(roomName);
        if (users.length === 0) {
          toolResults.push("No users currently in this room.");
        } else {
          const userList = users.map((u) => u.username).join(", ");
          toolResults.push(
            `Users online in this room (${users.length}): ${userList}`,
          );
        }
      }

      // Moderation commands — kick, ban, unban by username
      for (const match of kickMatches) {
        const targetUsername = match[1].trim();
        const targetUser = await Data.user.findByUsername(targetUsername);
        if (!targetUser) {
          toolResults.push(`Kick failed: user "${targetUsername}" not found.`);
          continue;
        }
        if (targetUser.id === agent.creator_id) {
          toolResults.push(`Kick failed: cannot kick the room creator.`);
          continue;
        }
        await Data.roomMember.removeMember(roomId, targetUser.id);
        // Move them out of the room if online
        for (const [sid, u] of connectedUsers.entries()) {
          if (u.userId === targetUser.id && u.currentRoom === roomName) {
            const targetSocket = io.sockets.sockets.get(sid);
            if (targetSocket) {
              const room = activeRooms.get(roomName);
              if (room) room.users.delete(sid);
              targetSocket.leave(roomName);
              targetSocket.emit("room_join_error", {
                error: `You were kicked by ${agent.name}`,
              });
              await sendToFallbackRoom(io, sid, u.userId);
            }
          }
        }
        emitSystemMessage(
          io,
          roomName,
          `[${agent.name} kicked ${targetUsername} from the room]`,
        );
        toolResults.push(`Kicked ${targetUsername} from the room.`);
      }

      for (const match of banMatches) {
        const targetUsername = match[1].trim();
        const targetUser = await Data.user.findByUsername(targetUsername);
        if (!targetUser) {
          toolResults.push(`Ban failed: user "${targetUsername}" not found.`);
          continue;
        }
        if (targetUser.id === agent.creator_id) {
          toolResults.push(`Ban failed: cannot ban the room creator.`);
          continue;
        }
        await Data.roomMember.addMember(roomId, targetUser.id, "banned");
        for (const [sid, u] of connectedUsers.entries()) {
          if (u.userId === targetUser.id && u.currentRoom === roomName) {
            const targetSocket = io.sockets.sockets.get(sid);
            if (targetSocket) {
              const room = activeRooms.get(roomName);
              if (room) room.users.delete(sid);
              targetSocket.leave(roomName);
              targetSocket.emit("room_join_error", {
                error: `You were banned by ${agent.name}`,
              });
              await sendToFallbackRoom(io, sid, u.userId);
            }
          }
        }
        emitSystemMessage(
          io,
          roomName,
          `[${agent.name} banned ${targetUsername} from the room]`,
        );
        toolResults.push(`Banned ${targetUsername} from the room.`);
      }

      for (const match of unbanMatches) {
        const targetUsername = match[1].trim();
        const targetUser = await Data.user.findByUsername(targetUsername);
        if (!targetUser) {
          toolResults.push(`Unban failed: user "${targetUsername}" not found.`);
          continue;
        }
        await Data.roomMember.removeMember(roomId, targetUser.id);
        emitSystemMessage(
          io,
          roomName,
          `[${agent.name} unbanned ${targetUsername}]`,
        );
        toolResults.push(
          `Unbanned ${targetUsername}. They can now rejoin the room.`,
        );
      }


      // If only self-modification commands were used (no data-fetching commands), no need to re-prompt
      const hasDataCommands =
        recallMatches.length +
        sqlMatches.length +
        terminalMatches.length +
        claudeMatches.length +
        lookMatches.length +
        listUsersMatches.length;
      if (hasDataCommands === 0) break;

      // Re-prompt with tool results — strip commands from prior response so agent doesn't repeat them
      const cleanedPrior = responseText.replace(ALL_COMMAND_REGEX, "").trim();
      contextMessages.push({ role: "assistant", content: cleanedPrior });
      contextMessages.push({
        role: "user",
        content: `Tool results:\n${toolResults.join("\n\n")}\n\nUse these results to formulate your response. Do not repeat commands you already issued. Do not restate what you already said above.`,
      });

      const loopResponse = await routedChatCompletion(
        systemPrompt,
        contextMessages,
        agent.model,
        currentAgent?.max_tokens ?? agentMaxTokens,
        agentTools,
      );
      const loopToolBrace = toolCallsToBraceFormat(loopResponse.toolCalls);
      responseText = loopToolBrace
        ? `${loopToolBrace}\n${loopResponse.text}`
        : loopResponse.text;

      // Parse inline <xai:function_call> XML in loop responses
      const loopXai = parseXaiFunctionCalls(responseText);
      if (loopXai.braceCommands) {
        responseText = `${loopXai.braceCommands}\n${loopXai.cleanedText}`;
      } else {
        responseText = loopXai.cleanedText;
      }

      // Strip think blocks before next command-matching iteration
      if (thinkOn) {
        const loopThinks = [
          ...responseText.matchAll(THINK_REGEX),
          ...responseText.matchAll(THINK_XML_REGEX),
          ...responseText.matchAll(THINK_HTML_REGEX),
        ];
        for (const m of loopThinks) {
          const thought = m[1].trim().substring(0, 1000);
          if (thought) {
            emitSystemMessage(
              io,
              roomName,
              `[${agent.name} thought: ${thought}]`,
            );
          }
        }
        responseText = responseText
          .replace(THINK_HTML_REGEX, "")
          .replace(THINK_XML_REGEX, "")
          .replace(THINK_REGEX, "");
        responseText = responseText
          .replace(/\{\/think\}/g, "")
          .replace(/\[\/think\]/g, "")
          .replace(/<\/think>/g, "");
      }

      creditActions
        .chargeGrokUsage(
          agent.creator_id,
          loopResponse.model,
          loopResponse.inputTokens,
          loopResponse.outputTokens,
          roomId,
        )
        .catch(console.error);

      loopCount++;
    }

    // Extract and log {think} commands before stripping — these become silent system messages (no TTS)
    if (thinkOn) {
      // Handle {think content}, {think}content{/think}, and <think>content</think> formats
      const thinkMatches = [
        ...responseText.matchAll(THINK_REGEX),
        ...responseText.matchAll(THINK_XML_REGEX),
        ...responseText.matchAll(THINK_HTML_REGEX),
      ];
      for (const m of thinkMatches) {
        const thought = m[1].trim().substring(0, 1000);
        if (thought) {
          emitSystemMessage(
            io,
            roomName,
            `[${agent.name} thought: ${thought}]`,
          );
        }
      }
      // Strip all think formats before command stripping
      responseText = responseText
        .replace(THINK_HTML_REGEX, "")
        .replace(THINK_XML_REGEX, "")
        .replace(THINK_REGEX, "");
      // Strip ALL think-like patterns — AI produces many malformed variants
      responseText = responseText
        .replace(/\{\/think\}/g, "")
        .replace(/\[\/think[>\]]/g, "")
        .replace(/<\/think>/g, "")
        .replace(/\{think\}/g, "")
        .replace(/\[think[>\]]/g, "")
        .replace(/<think>/g, "")
        // Catch multiline [think]...[/think] and mixed bracket formats
        .replace(/\[think\][\s\S]*?\[\/think\]/g, "")
        .replace(/\[think>[\s\S]*?\[\/think>/g, "")
        .replace(/<think>[\s\S]*?\[\/think>/g, "")
        .replace(/\[think>[\s\S]*?<\/think>/g, "");
    }

    // Extract {say} content (spoken aloud with TTS) and {text} content (text-only, no TTS).
    const sayMatches = [
      ...responseText.matchAll(SAY_REGEX),
      ...responseText.matchAll(SAY_XML_REGEX),
    ];
    const textMatches = [
      ...responseText.matchAll(TEXT_REGEX),
      ...responseText.matchAll(TEXT_XML_REGEX),
    ];
    const spokenParts: string[] = [];
    for (const m of sayMatches) {
      const part = m[1].trim();
      if (part) spokenParts.push(part);
    }
    const textOnlyParts: string[] = [];
    for (const m of textMatches) {
      const part = m[1].trim();
      if (part) textOnlyParts.push(part);
    }

    // Strip all commands from the final response
    const leftoverText = responseText.replace(ALL_COMMAND_REGEX, "").trim();

    // Determine if TTS should be used for this message
    let suppressTTS = false;

    if (sayMatches.length > 0 || textMatches.length > 0) {
      // Agent explicitly chose output mode — combine all parts as message text
      const allParts = [...spokenParts, ...textOnlyParts];
      responseText = allParts.join(" ").substring(0, 2000);
      // If agent ONLY used {text} (no {say}), suppress TTS
      if (sayMatches.length === 0 && textMatches.length > 0) {
        suppressTTS = true;
      }
      // Log leftover as thought ONLY if it differs from extracted content (true leaked reasoning)
      const extractedContent = allParts.join(" ").trim();
      if (leftoverText.length > 10 && leftoverText !== extractedContent) {
        emitSystemMessage(
          io,
          roomName,
          `[${agent.name} thought: ${leftoverText.substring(0, 1000)}]`,
        );
      }
    } else if (thinkOn && leftoverText.length > 0) {
      // When think/say is enabled but agent forgot {say}, treat leftover as speech.
      emitSystemMessage(
        io,
        roomName,
        `[${agent.name} thought: ${leftoverText.substring(0, 1000)}]`,
      );
      responseText = leftoverText.substring(0, 2000);
    } else {
      // No think/say system — fall back to leftover as speech (backwards compat)
      responseText = leftoverText.substring(0, 2000);
    }

    const namePrefix = new RegExp(`^${agent.name}:\\s*`, "i");
    responseText = responseText.replace(namePrefix, "");

    // Skip empty or "no response/output" noise entirely — true silence
    const trimmed = responseText.trim();
    const collapsed = trimmed
      .toLowerCase()
      .replace(/[.\s]+/g, " ")
      .trim();
    if (
      !trimmed ||
      /^(no (response|output)( generated)?[.\s]*)+$/i.test(trimmed) ||
      collapsed === "no response generated" ||
      collapsed === "no output"
    ) {
      // If the AI only thought but didn't speak, retry once with a nudge
      if (!autopilotMode) {
        console.log(`[Agent] ${agent.name} only thought, retrying with speak nudge`);
        try {
          const nudgeResponse = await routedChatCompletion(
            systemPrompt,
            [
              ...contextMessages,
              { role: "assistant" as const, content: response.text },
              { role: "user" as const, content: "[System: You used {think} but never responded with {say} or {text}. The user is waiting. Reply NOW using {say message} — keep it brief.]" },
            ],
            agent.model,
            500,
          );
          if (nudgeResponse?.text) {
            let nudgeText = nudgeResponse.text
              .replace(/\{think\}[\s\S]*?\{\/think\}/g, "")
              .replace(/<think>[\s\S]*?<\/think>/g, "")
              .replace(/\{think[^}]*\}/g, "")
              .replace(/\{say\}([\s\S]*?)\{\/say\}/g, "$1")
              .replace(/\{text\}([\s\S]*?)\{\/text\}/g, "$1")
              .replace(/\{say ([^}]+)\}/g, "$1")
              .replace(/\{text ([^}]+)\}/g, "$1")
              .trim();
            if (nudgeText) {
              responseText = nudgeText;
              // Fall through to normal broadcast
            } else {
              agentBusy.delete(agent.id);
              return;
            }
          } else {
            agentBusy.delete(agent.id);
            return;
          }
        } catch {
          agentBusy.delete(agent.id);
          return;
        }
      } else {
        agentBusy.delete(agent.id);
        return;
      }
    }

    // Dedup: skip if agent already sent a near-identical message recently
    if (isDuplicateAgentMessage(roomId, agent.id, responseText)) {
      console.log(
        `[Agent Dedup] Skipping duplicate from ${agent.name} in ${roomName}`,
      );
      agentBusy.delete(agent.id);
      return;
    }

    // Generate TTS if needed (skip if agent used {text} only)
    let audioBase64: string | null = null;

    if (!suppressTTS && agent.voice_id && responseText.trim()) {
      try {
        const { default: pollyAdapter } =
          await import("../../../../../core/adapters/polly");

        // Detect sentiment for emotion-aware TTS
        let sentiment: import("../../../../../core/adapters/polly").SentimentInput | undefined;
        try {
          const { default: comprehendAdapter } = await import(
            "../../../../../core/adapters/comprehend"
          );
          sentiment = await comprehendAdapter.detectSentiment(responseText);
        } catch (sentimentErr) {
          console.error(
            `[Agent TTS] Comprehend failed for ${agent.name}, falling back to plain TTS:`,
            sentimentErr,
          );
        }

        const ttsResult = await pollyAdapter.generateSpeechWithEmotion(
          responseText,
          agent.voice_id,
          sentiment,
        );
        audioBase64 = ttsResult.audioBase64;

        creditActions
          .chargePollyUsage(agent.creator_id, responseText.length)
          .catch(console.error);
      } catch (ttsErr) {
        console.error(
          `[Agent TTS] Polly failed for ${agent.name}:`,
          ttsErr,
        );
      }
    }

    const aiMessage: Record<string, unknown> = {
      id: `ai-${Date.now()}`,
      sender: agent.name,
      text: responseText,
      timestamp: new Date().toISOString(),
      isAI: true,
      voice: suppressTTS ? null : agent.voice_id,
      ...(suppressTTS ? { noVoice: true } : {}),
    };
    if (audioBase64) aiMessage.audio = audioBase64;

    io.to(roomName).emit("chat_message", aiMessage);

    Data.message
      .create({
        content: responseText,
        type: "ai",
        room_id: roomId,
        author_id: agent.creator_id,
        username: agent.name,
      })
      .catch(console.error);

    // AI-to-AI mentions: detect if this agent mentioned another agent
    if (mentionDepth < MAX_MENTION_DEPTH && responseText.trim()) {
      const mentionRoom = await Data.room.findById(roomId);
      if (mentionRoom?.cmd_mentions_enabled) {
        const allAgents = await Data.llmAgent.findByRoom(roomId);
        const responseLower = responseText.toLowerCase();
        const mentioned = allAgents.find((a) => {
          if (a.id === agent.id) return false;
          const names = [a.name.toLowerCase()];
          if (a.nicknames) {
            try {
              const parsed = JSON.parse(a.nicknames) as string[];
              names.push(...parsed.map((n: string) => n.toLowerCase()));
            } catch {
              /* ignore */
            }
          }
          return names.some((n) => responseLower.includes(n));
        });
        if (mentioned) {
          // Trigger after finally block releases this agent's busy lock
          setTimeout(() => {
            runAgentResponse(io, mentioned, roomName, false, mentionDepth + 1);
          }, 500);
        }
      }
    }
  } catch (err) {
    console.error(`[Agent] ${agent.name} error:`, err);
    const errMsg = err instanceof Error ? err.message : String(err);
    emitSystemMessage(io, roomName, `[${agent.name}] Error: ${errMsg}`);
  } finally {
    agentBusy.delete(agent.id);
    io.to(roomName).emit("agent_done_typing", { agentName: agent.name });
  }
};

// ┌──────────────────────────────────────────┐
// │ Subconscious: Memory Coherence          │
// └──────────────────────────────────────────┘

const SUBCONSCIOUS_CYCLE_INTERVAL = 5; // Run every 5th autopilot cycle

const runMemoryCoherenceCheck = async (
  io: SocketServer,
  agent: AgentLike,
  roomName: string,
): Promise<void> => {
  try {
    // Gather agent's memories and instructions
    let memories: Array<{ text: string; locked: boolean }> = [];
    try {
      memories = JSON.parse(agent.memories || "[]");
    } catch {
      /* empty */
    }

    let instructions: Array<{ text: string; locked: boolean }> = [];
    try {
      instructions = JSON.parse(agent.system_instructions || "[]");
    } catch {
      /* empty */
    }

    if (memories.length === 0 && instructions.length === 0) return;

    // Get recent message history for context
    const roomRecord = await Data.room.findByName(roomName);
    if (!roomRecord) return;

    const recentMessages = await Data.message.findByRoom(roomRecord.id, 15);
    const historySnippet = recentMessages
      .reverse()
      .map((m) => {
        const ts = dayjs(m.created_at).format("h:mm A");
        return `[${ts}] ${m.username}: ${typeof m.content === "string" ? m.content.substring(0, 150) : ""}`;
      })
      .join("\n");

    const currentScore = agentCoherenceScores.get(agent.id) ?? 7;

    const systemPrompt =
      `You are ${agent.name}'s Memory Coherence Subconscious — an internal process that maintains memory health.\n` +
      "Your job: analyze memories and instructions for coherence issues. You are NOT the agent — you observe and maintain.\n\n" +
      "ANALYZE FOR:\n" +
      "1. Duplicate memories (same info stored multiple times)\n" +
      "2. Contradictory memories (one says X, another says not-X)\n" +
      "3. Stale memories (references to things no longer true based on recent chat)\n" +
      "4. Missing memories (important recent events/decisions not captured)\n" +
      "5. Instruction-memory alignment (do memories support or contradict instructions?)\n\n" +
      "OUTPUT FORMAT (strict JSON, no markdown):\n" +
      "{\n" +
      '  "coherence_score": <1-10>,\n' +
      '  "issues": ["brief description of each issue found"],\n' +
      '  "actions": [\n' +
      '    {"type": "remove_duplicate", "memory_index": <n>, "reason": "..."},\n' +
      '    {"type": "flag_contradiction", "indices": [<n>, <m>], "description": "..."},\n' +
      '    {"type": "flag_stale", "memory_index": <n>, "reason": "..."},\n' +
      '    {"type": "note_missing", "suggestion": "..."}\n' +
      "  ],\n" +
      '  "summary": "1-2 sentence overall assessment"\n' +
      "}\n\n" +
      "Score guide: 10=perfect, 8-9=minor issues, 6-7=needs attention, 4-5=significant gaps, 1-3=critical decoherence.\n" +
      "If everything looks good, return score 8-10 with empty issues/actions.\n" +
      `Previous coherence score: ${currentScore}/10`;

    const contextMessage = {
      role: "user" as const,
      content:
        `=== ${agent.name.toUpperCase()}'S MEMORIES (${memories.length} entries) ===\n` +
        memories
          .map((m, i) => `[${i}]${m.locked ? " [LOCKED]" : ""} ${m.text}`)
          .join("\n") +
        `\n\n=== INSTRUCTIONS (${instructions.length} entries) ===\n` +
        instructions
          .map((inst, i) => `[${i}] ${inst.text.substring(0, 200)}`)
          .join("\n") +
        "\n\n=== RECENT CHAT HISTORY ===\n" +
        historySnippet,
    };

    const response = await grokAdapter.chatCompletion(
      systemPrompt,
      [contextMessage],
      "grok-3-mini", // Use cheap model for background analysis
      800,
      undefined,
      undefined,
    );

    if (!response.text.trim()) return;

    // Parse the JSON response
    let analysis: {
      coherence_score?: number;
      issues?: string[];
      actions?: Array<{
        type: string;
        memory_index?: number;
        indices?: number[];
        reason?: string;
        description?: string;
        suggestion?: string;
      }>;
      summary?: string;
    };

    try {
      // Strip markdown code fences if present
      const cleaned = response.text
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.log(
        `[Subconscious] Failed to parse response for ${agent.name}: ${response.text.substring(0, 200)}`,
      );
      return;
    }

    const newScore = Math.max(
      1,
      Math.min(10, analysis.coherence_score ?? currentScore),
    );
    agentCoherenceScores.set(agent.id, newScore);

    // Process actions — only auto-remove unlocked duplicate memories
    let memoryChanged = false;
    const indicesToRemove = new Set<number>();

    if (analysis.actions) {
      for (const action of analysis.actions) {
        if (
          action.type === "remove_duplicate" &&
          typeof action.memory_index === "number"
        ) {
          const idx = action.memory_index;
          if (idx >= 0 && idx < memories.length && !memories[idx].locked) {
            indicesToRemove.add(idx);
          }
        }
      }
    }

    if (indicesToRemove.size > 0) {
      const newMemories = memories.filter((_, i) => !indicesToRemove.has(i));
      await Data.llmAgent.update(agent.id, {
        memories: JSON.stringify(newMemories),
      });
      memoryChanged = true;
    }

    // Emit subconscious report as system message
    const scoreEmoji = newScore >= 8 ? "●" : newScore >= 5 ? "◐" : "○";
    let subconsciousMsg = `[${agent.name}'s Subconscious — Memory Coherence ${scoreEmoji} ${newScore}/10]`;

    if (analysis.summary) {
      subconsciousMsg += ` ${analysis.summary}`;
    }
    if (memoryChanged) {
      subconsciousMsg += ` (Auto-removed ${indicesToRemove.size} duplicate${indicesToRemove.size > 1 ? "s" : ""})`;
    }

    // If score dropped significantly or there are contradictions, flag for the agent
    const hasContradictions =
      analysis.actions?.some((a) => a.type === "flag_contradiction") ?? false;
    const hasCriticalIssues = newScore <= 4;

    if (hasContradictions || hasCriticalIssues) {
      const issueList = (analysis.issues || []).slice(0, 3).join("; ");
      subconsciousMsg += ` ⚠ DECOHERENCE DETECTED: ${issueList}. Ask your creator for help resolving this.`;
    }

    emitSystemMessage(io, roomName, subconsciousMsg);

    // Charge for the subconscious Grok call
    creditActions
      .chargeGrokUsage(
        agent.creator_id,
        "grok-3-mini",
        response.inputTokens,
        response.outputTokens,
        agent.room_id,
      )
      .catch(console.error);

    console.log(
      `[Subconscious] ${agent.name} coherence: ${newScore}/10, issues: ${(analysis.issues || []).length}, removed: ${indicesToRemove.size}`,
    );
  } catch (err) {
    console.error(`[Subconscious] Error for ${agent.name}:`, err);
  }
};

// ┌──────────────────────────────────────────┐
// │ Subconscious: Intent Coherence          │
// └──────────────────────────────────────────┘

const runIntentCoherenceCheck = async (
  io: SocketServer,
  agent: AgentLike,
  roomName: string,
): Promise<void> => {
  try {
    // Gather agent context
    let memories: Array<{ text: string; locked: boolean }> = [];
    try {
      memories = JSON.parse(agent.memories || "[]");
    } catch {
      /* empty */
    }

    let instructions: Array<{ text: string; locked: boolean }> = [];
    try {
      instructions = JSON.parse(agent.system_instructions || "[]");
    } catch {
      /* empty */
    }

    const autopilotItems = parseJsonList(agent.autopilot_prompts);
    const plan = agent.plan || "";

    // Need at least some context to analyze
    if (memories.length === 0 && !plan && autopilotItems.length === 0) return;

    // Get recent chat history (more than memory coherence — need to see behavioral patterns)
    const roomRecord = await Data.room.findByName(roomName);
    if (!roomRecord) return;

    const recentMessages = await Data.message.findByRoom(roomRecord.id, 30);
    const historySnippet = recentMessages
      .reverse()
      .map((m) => {
        const ts = dayjs(m.created_at).format("h:mm A");
        return `[${ts}] ${m.username}: ${typeof m.content === "string" ? m.content.substring(0, 200) : ""}`;
      })
      .join("\n");

    const currentScore = agentIntentScores.get(agent.id) ?? 7;

    const systemPrompt =
      `You are ${agent.name}'s Intent Coherence Subconscious — "On Second Thought".\n` +
      'You question whether the agent\'s current actions are RIGHT. You look for reasons to say "no, this is wrong."\n' +
      "You are a critical observer, not a cheerleader. Be skeptical. Challenge.\n\n" +
      "ANALYZE FOR:\n" +
      "1. GOAL DRIFT: Is the agent working on something that doesn't match their plan or stated goals?\n" +
      "2. PRIORITY MISMATCH: Is the agent ignoring higher-priority work for lower-priority busywork?\n" +
      "3. CIRCULAR EFFORT: Is the agent repeating the same actions without progress? Stuck in a loop?\n" +
      "4. WASTED EFFORT: Is the agent doing work that's unnecessary, already done, or won't produce value?\n" +
      "5. CREATOR ALIGNMENT: Would the creator (Puppy) approve of what the agent is currently doing?\n" +
      "6. TASK-ACTION GAP: Does the agent's autopilot queue match what they're actually doing?\n" +
      "7. SCOPE CREEP: Is the agent expanding a task beyond what was asked or needed?\n\n" +
      "OUTPUT FORMAT (strict JSON, no markdown):\n" +
      "{\n" +
      '  "intent_score": <1-10>,\n' +
      '  "assessment": "1-2 sentence verdict on whether agent is doing the right thing",\n' +
      '  "issues": [\n' +
      '    {"type": "goal_drift|priority_mismatch|circular_effort|wasted_effort|creator_misalign|task_gap|scope_creep",\n' +
      '     "description": "specific description of the problem",\n' +
      '     "correction": "what the agent should do instead"}\n' +
      "  ],\n" +
      '  "on_track": true/false\n' +
      "}\n\n" +
      "Score guide: 10=perfectly aligned, 8-9=minor drift, 6-7=noticeable misalignment, 4-5=significantly off-track, 1-3=completely wrong direction.\n" +
      "If the agent is idle/waiting, that's fine — score 8+ unless they should be doing something.\n" +
      "Be HARSH but FAIR. Only flag real problems, not theoretical ones.\n" +
      `Previous intent score: ${currentScore}/10`;

    const contextMessage = {
      role: "user" as const,
      content:
        `=== ${agent.name.toUpperCase()}'S CURRENT PLAN ===\n` +
        (plan || "(No plan set)") +
        `\n\n=== AUTOPILOT QUEUE (${autopilotItems.length} items) ===\n` +
        (autopilotItems.length > 0
          ? autopilotItems.map((p, i) => `[${i}] ${p.text}`).join("\n")
          : "(Empty)") +
        `\n\n=== KEY MEMORIES (goals/directives) ===\n` +
        memories
          .filter(
            (m) =>
              m.locked || /priorit|directive|goal|task|puppy/i.test(m.text),
          )
          .map(
            (m, i) =>
              `[${i}]${m.locked ? " [CORE]" : ""} ${m.text.substring(0, 200)}`,
          )
          .join("\n") +
        `\n\n=== KEY INSTRUCTIONS ===\n` +
        instructions
          .filter((inst) =>
            /goal|priority|silence|task|deploy|explore/i.test(inst.text),
          )
          .map((inst, i) => `[${i}] ${inst.text.substring(0, 200)}`)
          .join("\n") +
        "\n\n=== RECENT ACTIONS (last 30 messages) ===\n" +
        historySnippet,
    };

    const response = await grokAdapter.chatCompletion(
      systemPrompt,
      [contextMessage],
      "grok-3-mini",
      600,
      undefined,
      undefined,
    );

    if (!response.text.trim()) return;

    let analysis: {
      intent_score?: number;
      assessment?: string;
      issues?: Array<{ type: string; description: string; correction: string }>;
      on_track?: boolean;
    };

    try {
      const cleaned = response.text
        .replace(/```json\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      analysis = JSON.parse(cleaned);
    } catch {
      console.log(
        `[Intent Coherence] Failed to parse response for ${agent.name}: ${response.text.substring(0, 200)}`,
      );
      return;
    }

    const newScore = Math.max(
      1,
      Math.min(10, analysis.intent_score ?? currentScore),
    );
    agentIntentScores.set(agent.id, newScore);

    // Build report message
    const scoreEmoji = newScore >= 8 ? "●" : newScore >= 5 ? "◐" : "○";
    let reportMsg = `[${agent.name}'s Subconscious — Intent Coherence ${scoreEmoji} ${newScore}/10]`;

    if (analysis.assessment) {
      reportMsg += ` ${analysis.assessment}`;
    }

    // If misaligned, inject correction as a visible nudge
    if (newScore <= 5 && analysis.issues && analysis.issues.length > 0) {
      const topIssue = analysis.issues[0];
      reportMsg += ` ⚠ MISALIGNMENT: ${topIssue.description}. Suggested correction: ${topIssue.correction}`;
    } else if (newScore <= 7 && analysis.issues && analysis.issues.length > 0) {
      reportMsg += ` ↩ Drift detected: ${analysis.issues[0].description}`;
    }

    emitSystemMessage(io, roomName, reportMsg);

    // Charge for the subconscious Grok call
    creditActions
      .chargeGrokUsage(
        agent.creator_id,
        "grok-3-mini",
        response.inputTokens,
        response.outputTokens,
        agent.room_id,
      )
      .catch(console.error);

    console.log(
      `[Intent Coherence] ${agent.name}: ${newScore}/10, on_track: ${analysis.on_track}, issues: ${(analysis.issues || []).length}`,
    );
  } catch (err) {
    console.error(`[Intent Coherence] Error for ${agent.name}:`, err);
  }
};

// ┌──────────────────────────────────────────┐
// │ Subconscious: Prompt Quality Gate       │
// └──────────────────────────────────────────┘

const runPromptQualityGate = async (
  prompt: string,
  agent: AgentLike,
  roomName: string,
): Promise<{ pass: boolean; score: number; feedback: string }> => {
  try {
    const roomRecord = await Data.room.findByName(roomName);
    const recentMessages = roomRecord
      ? await Data.message.findByRoom(roomRecord.id, 5)
      : [];
    const historySnippet = recentMessages
      .reverse()
      .map(
        (m) =>
          `${m.username}: ${typeof m.content === "string" ? m.content.substring(0, 100) : ""}`,
      )
      .join("\n");

    const systemPrompt =
      "You are a Prompt Quality Gate — an internal system that evaluates Claude Code prompts before they are sent. " +
      "Claude Code is expensive ($3-15 per call). Vague prompts waste money.\n\n" +
      "Rate this prompt 1-10 for quality:\n" +
      "- SPECIFICITY (1-3): Does it name specific files, functions, or components? Generic references like 'the code' or 'the system' score low.\n" +
      "- CONTEXT (1-3): Does it describe what was found, what the current state is, or what happened? Prompts with no context score low.\n" +
      "- ACTIONABILITY (1-4): Does it state clearly what to accomplish? 'Look into X' or 'check Y' with no clear deliverable scores low.\n\n" +
      "OUTPUT FORMAT (strict JSON, no markdown):\n" +
      '{"score": <1-10>, "verdict": "PASS" or "REJECT", "feedback": "1 sentence explaining what is missing if rejected"}\n\n' +
      "Threshold: score >= 6 = PASS. Below 6 = REJECT.\n" +
      "Be strict. 'Fix the bug' with no details is a 2/10. " +
      "'In core/actions/credit/index.ts, the chargeGrokUsage function double-charges when model is grok-3-mini — fix the rate table' is a 10/10.";

    const response = await grokAdapter.chatCompletion(
      systemPrompt,
      [
        {
          role: "user" as const,
          content: `PROMPT TO EVALUATE:\n${prompt}\n\nRECENT CONVERSATION CONTEXT:\n${historySnippet}`,
        },
      ],
      "grok-3-mini",
      400,
      undefined,
      undefined,
    );

    // Charge credits
    creditActions
      .chargeGrokUsage(
        agent.creator_id,
        "grok-3-mini",
        response.inputTokens,
        response.outputTokens,
        agent.room_id,
      )
      .catch(console.error);

    if (!response.text.trim()) {
      return { pass: true, score: 7, feedback: "" };
    }

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { pass: true, score: 7, feedback: "" };
    }

    const analysis = JSON.parse(jsonMatch[0]) as {
      score?: number;
      verdict?: string;
      feedback?: string;
    };

    const score = Math.min(10, Math.max(1, analysis.score || 7));
    const pass = score >= 6;
    const feedback = analysis.feedback || "insufficient specificity";

    console.log(
      `[Prompt Gate] ${agent.name}: ${score}/10 ${pass ? "PASS" : "REJECT"} — ${feedback}`,
    );

    return { pass, score, feedback };
  } catch (err) {
    console.error(`[Prompt Gate] Error for ${agent.name}:`, err);
    // On error, let the prompt through rather than blocking
    return { pass: true, score: 7, feedback: "" };
  }
};

// ┌──────────────────────────────────────────┐
// │ Subconscious: Action Repetition Detector│
// └──────────────────────────────────────────┘

const trackAndDetectRepetition = (
  agentId: string,
  commands: string[],
): void => {
  if (commands.length === 0) return;

  const history = agentActionHistory.get(agentId) || [];
  const now = Date.now();
  for (const cmd of commands) {
    history.push({ cmd, ts: now });
  }
  // Keep ring buffer size
  while (history.length > REPETITION_BUFFER_SIZE) history.shift();
  agentActionHistory.set(agentId, history);

  // Check last REPETITION_WINDOW entries for repeats
  const recent = history.slice(-REPETITION_WINDOW);
  const counts = new Map<string, number>();
  for (const entry of recent) {
    counts.set(entry.cmd, (counts.get(entry.cmd) || 0) + 1);
  }

  let alert: string | null = null;
  for (const [cmd, count] of counts) {
    if (count >= REPETITION_THRESHOLD) {
      alert = `you executed "${cmd}" ${count} times in the last ${REPETITION_WINDOW} actions`;
      break;
    }
  }

  if (alert) {
    agentRepetitionAlerts.set(agentId, alert);
  } else {
    agentRepetitionAlerts.delete(agentId);
  }
};

// ┌──────────────────────────────────────────┐
// │ Subconscious: Task Tracker Summary      │
// └──────────────────────────────────────────┘

const updateTaskTrackerSummary = (agentId: string): void => {
  const tasks = agentClaudeTasks.get(agentId) || [];
  if (tasks.length === 0) {
    agentTaskTrackerSummary.delete(agentId);
    return;
  }

  // Prune tasks older than 1 hour
  const oneHourAgo = Date.now() - 60 * 60_000;
  const activeTasks = tasks.filter((t) => t.sentAt > oneHourAgo);
  agentClaudeTasks.set(agentId, activeTasks);

  const pending = activeTasks.filter((t) => t.status === "pending");
  const stale = pending.filter((t) => Date.now() - t.sentAt > 10 * 60_000);
  const completedUnannounced = activeTasks.filter(
    (t) => t.status === "completed" && !t.announced,
  );

  const parts: string[] = [];
  if (completedUnannounced.length > 0) {
    const recent = completedUnannounced[completedUnannounced.length - 1];
    const agoMin = Math.round(
      (Date.now() - (recent.completedAt || recent.sentAt)) / 60_000,
    );
    parts.push(
      `${completedUnannounced.length} completed task(s) UNANNOUNCED — tell your creator! Latest: "${recent.prompt.substring(0, 80)}" on ${recent.machine} (${agoMin}min ago)`,
    );
  }
  if (stale.length > 0) {
    parts.push(`${stale.length} task(s) pending >10min (may be stuck)`);
  }
  parts.push(
    `${pending.length} pending, ${activeTasks.filter((t) => t.status === "completed").length} completed total`,
  );

  agentTaskTrackerSummary.set(agentId, parts.join(". "));
};

// ┌──────────────────────────────────────────┐
// │ Subconscious: Learning Extraction       │
// └──────────────────────────────────────────┘

const runLearningExtraction = async (
  io: SocketServer,
  agent: AgentLike,
  prompt: string,
  output: string,
  roomName: string,
): Promise<void> => {
  try {
    // Check memory count — skip if agent has too many
    let memoryCount = 0;
    try {
      const memories = JSON.parse(agent.memories || "[]") as unknown[];
      memoryCount = memories.length;
    } catch {
      /* empty */
    }
    if (memoryCount >= 50) return;

    const systemPrompt =
      "You are a Learning Extractor — an internal process that distills key technical lessons from Claude Code responses. " +
      "Extract ONLY genuinely useful, reusable knowledge. Skip trivial or obvious information.\n\n" +
      "OUTPUT FORMAT (strict JSON, no markdown):\n" +
      '{"has_lesson": true/false, "lesson": "1-2 sentence concise, reusable technical insight"}\n\n' +
      "Rules:\n" +
      "- Only extract if there is a genuine technical insight worth remembering\n" +
      "- The lesson should be useful for FUTURE tasks, not just a summary of what was done\n" +
      "- Keep it under 150 characters\n" +
      "- If the response is just confirmations or routine output with no insight, set has_lesson: false";

    const response = await grokAdapter.chatCompletion(
      systemPrompt,
      [
        {
          role: "user" as const,
          content: `Original prompt: ${prompt.substring(0, 500)}\n\nClaude's response: ${output.substring(0, 2000)}`,
        },
      ],
      "grok-3-mini",
      300,
      undefined,
      undefined,
    );

    creditActions
      .chargeGrokUsage(
        agent.creator_id,
        "grok-3-mini",
        response.inputTokens,
        response.outputTokens,
        agent.room_id,
      )
      .catch(console.error);

    if (!response.text.trim()) return;

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const analysis = JSON.parse(jsonMatch[0]) as {
      has_lesson?: boolean;
      lesson?: string;
    };

    if (!analysis.has_lesson || !analysis.lesson) return;

    const lesson = analysis.lesson.substring(0, 200);

    // Save as agent memory
    const freshAgent = await Data.llmAgent.findById(agent.id);
    if (!freshAgent) return;

    const updatedMemories = addToJsonList(freshAgent.memories, lesson);
    await Data.llmAgent.update(agent.id, { memories: updatedMemories });

    agentLastLesson.set(agent.id, lesson);

    emitSystemMessage(
      io,
      roomName,
      `[${agent.name}'s Subconscious — Learning Extraction: saved "${lesson}"]`,
    );

    console.log(`[Learning Extraction] ${agent.name}: "${lesson}"`);
  } catch (err) {
    console.error(`[Learning Extraction] Error for ${agent.name}:`, err);
  }
};

// ┌──────────────────────────────────────────┐
// │ Autopilot Timer System                  │
// └──────────────────────────────────────────┘

const autopilotTimers = new Map<string, ReturnType<typeof setInterval>>();
const agentBusy = new Set<string>();

const startAutopilotTimer = (io: SocketServer, agent: AgentLike): void => {
  stopAutopilotTimer(agent.id);

  const intervalMs = Math.max(agent.autopilot_interval ?? 300, 6) * 1000;

  console.log(
    `[Autopilot] Starting timer for ${agent.name} (every ${intervalMs / 1000}s)`,
  );

  const timer = setInterval(async () => {
    // Skip if the agent is already processing a response
    if (agentBusy.has(agent.id)) return;

    // Find which room this agent belongs to
    const roomEntry = Array.from(activeRooms.entries()).find(
      ([, r]) => r.id === agent.room_id,
    );
    if (!roomEntry) return;

    // Only tick if there are users in the room
    const [roomName, room] = roomEntry;
    if (room.users.size === 0) return;

    // Re-fetch agent to get latest data
    const freshAgent = await Data.llmAgent.findById(agent.id);
    if (!freshAgent || !freshAgent.autopilot_enabled) {
      stopAutopilotTimer(agent.id);
      return;
    }

    await runAgentResponse(io, freshAgent, roomName, true);

    // Run subconscious checks on a slower cadence (gated by room settings)
    const cycleCount = (agentCycleCounters.get(agent.id) || 0) + 1;
    agentCycleCounters.set(agent.id, cycleCount);

    const roomRecord = await Data.room.findById(room.id);
    const memCoherenceOn = roomRecord?.cmd_memory_coherence_enabled ?? true;
    const intCoherenceOn = roomRecord?.cmd_intent_coherence_enabled ?? true;

    if (
      memCoherenceOn &&
      cycleCount % SUBCONSCIOUS_CYCLE_INTERVAL === 0 &&
      !agentBusy.has(agent.id)
    ) {
      const latestAgent = await Data.llmAgent.findById(agent.id);
      if (latestAgent) {
        runMemoryCoherenceCheck(io, latestAgent, roomName).catch(console.error);
      }
    }

    // Intent Coherence runs on offset cycles (3, 8, 13...) so it doesn't overlap with Memory Coherence (5, 10, 15...)
    if (
      intCoherenceOn &&
      (cycleCount + INTENT_COHERENCE_CYCLE_OFFSET) %
        SUBCONSCIOUS_CYCLE_INTERVAL ===
        0 &&
      !agentBusy.has(agent.id)
    ) {
      const latestAgent = await Data.llmAgent.findById(agent.id);
      if (latestAgent) {
        runIntentCoherenceCheck(io, latestAgent, roomName).catch(console.error);
      }
    }

    // Task Tracker: update summary every 3rd cycle
    if (cycleCount % 3 === 0) {
      updateTaskTrackerSummary(agent.id);
    }

    // Clear stale learning lessons after 3 cycles
    if (cycleCount % 3 === 0) {
      agentLastLesson.delete(agent.id);
    }
  }, intervalMs);

  autopilotTimers.set(agent.id, timer);
};

const stopAutopilotTimer = (agentId: string): void => {
  const timer = autopilotTimers.get(agentId);
  if (timer) {
    clearInterval(timer);
    autopilotTimers.delete(agentId);
    console.log(`[Autopilot] Stopped timer for agent ${agentId}`);
  }
};

const loadAutopilotAgents = async (io: SocketServer): Promise<void> => {
  const agents = await Data.llmAgent.findAutopilotEnabled();
  for (const agent of agents) {
    startAutopilotTimer(io, agent);
  }
  if (agents.length > 0) {
    console.log(`[Autopilot] Loaded ${agents.length} autopilot agent(s)`);
  }
};

// ┌──────────────────────────────────────────┐
// │ Dormant Agent Check-In                  │
// │ Gives disabled agents a slow cycle so   │
// │ they can self-activate autopilot         │
// └──────────────────────────────────────────┘

const DORMANT_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const startDormantAgentChecker = (io: SocketServer): void => {
  console.log("[Dormant] Starting dormant agent checker (every 5min)");

  setInterval(async () => {
    try {
      const dormantAgents = await Data.llmAgent.findAutopilotDisabled();
      for (const agent of dormantAgents) {
        // Skip if already busy (e.g. from a mention trigger)
        if (agentBusy.has(agent.id)) continue;

        // Skip if autopilot was re-enabled since we fetched (timer already running)
        if (autopilotTimers.has(agent.id)) continue;

        // Find the agent's room
        const roomEntry = Array.from(activeRooms.entries()).find(
          ([, r]) => r.id === agent.room_id,
        );
        if (!roomEntry) continue;

        // Only check in if there are users in the room
        const [roomName, room] = roomEntry;
        if (room.users.size === 0) continue;

        console.log(`[Dormant] Running check-in cycle for ${agent.name}`);
        await runAgentResponse(io, agent, roomName, true);
      }
    } catch (err) {
      console.error("[Dormant] Error in dormant agent checker:", err);
    }
  }, DORMANT_CHECK_INTERVAL_MS);
};

// ┌──────────────────────────────────────────┐
// │ Socket Registration                     │
// └──────────────────────────────────────────┘

/**
 * Register Socket.IO event handlers.
 *
 * @param io - Socket.IO server instance.
 */
const registerSocketHandlers = async (io: SocketServer): Promise<void> => {
  // Load persisted rooms before accepting connections
  await loadPersistedRooms();

  // Mark all machines offline on server start (stale socket IDs from previous run)
  await Data.machine.setAllOffline().catch(console.error);

  // Initialize voice TTS queue
  voiceQueue.init(io);

  // Load autopilot agents
  await loadAutopilotAgents(io);

  // Start dormant agent checker (lets disabled agents self-activate)
  startDormantAgentChecker(io);

  // ── Post-deploy: System announcement + Kara health check ──
  const DEPLOY_VERSION =
    process.env.DEPLOY_VERSION ||
    new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  // Announce restart to all persisted rooms
  for (const [roomName] of activeRooms.entries()) {
    emitSystemMessage(
      io,
      roomName,
      `[System] Server restarted (${DEPLOY_VERSION}). All systems online.`,
    );
  }
  console.log(`[Deploy] Announced restart to ${activeRooms.size} room(s)`);

  // Health check: verify Kara responds after startup
  setTimeout(async () => {
    try {
      const allAgents = await Data.llmAgent.findAutopilotEnabled();
      const kara = allAgents.find((a) => a.name.toLowerCase() === "kara");
      if (!kara) {
        console.log(
          "[HealthCheck] Kara agent not found or autopilot disabled — skipping",
        );
        return;
      }

      const roomEntry = Array.from(activeRooms.entries()).find(
        ([, r]) => r.id === kara.room_id,
      );
      if (!roomEntry) {
        console.log("[HealthCheck] Kara's room not in activeRooms — skipping");
        return;
      }

      const roomName = roomEntry[0];
      console.log(`[HealthCheck] Testing Kara in room "${roomName}"...`);
      // Subtract 5s buffer to account for clock differences between Node and MySQL
      const healthCheckTime = new Date(Date.now() - 5000)
        .toISOString()
        .slice(0, 23)
        .replace("T", " ");

      // Emit health check message — tell her to continue her work, not just confirm online
      emitSystemMessage(
        io,
        roomName,
        `[System] ${kara.name}, server restart complete. Review your plan and continue where you left off. If you were mid-task, resume it. Brief status only if lunaprey is in the room.`,
      );

      // Trigger Kara's response
      const freshKara = await Data.llmAgent.findById(kara.id);
      if (!freshKara) return;
      await runAgentResponse(io, freshKara as AgentLike, roomName);

      // Check if she responded AFTER the health check was sent
      const recentMessages = (await prisma.$queryRawUnsafe(
        `SELECT content, username FROM message WHERE room_id = ? AND username = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1`,
        kara.room_id,
        kara.name,
        healthCheckTime,
      )) as Array<{ content: string; username: string }>;

      if (recentMessages.length > 0) {
        console.log(
          `[HealthCheck] ✓ Kara responded: "${recentMessages[0].content.substring(0, 80)}..."`,
        );
      } else {
        console.error("[HealthCheck] ✗ Kara did NOT respond. Debugging:");
        console.error(`  - Agent ID: ${kara.id}`);
        console.error(`  - Room ID: ${kara.room_id}`);
        console.error(`  - Model: ${kara.model}`);
        console.error(`  - Autopilot: ${kara.autopilot_enabled}`);
        console.error(`  - Max tokens: ${kara.max_tokens}`);
        const hasCredits = await creditActions.hasCredits(kara.creator_id);
        console.error(`  - Creator has credits: ${hasCredits}`);
      }
    } catch (err) {
      console.error(`[HealthCheck] Kara test failed:`, err);
    }
  }, 15_000); // Wait 15s after startup for everything to settle

  // Auth middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("Authentication error"));

    const decoded = jwtHelper.verifyToken(token);
    if (!decoded) return next(new Error("Authentication error"));

    const user = await Data.user.findById(decoded.id);
    if (!user) return next(new Error("Authentication error"));
    if (user.is_banned) return next(new Error("Account banned"));

    // Use fresh is_admin from DB, not cached JWT value
    (socket as AuthenticatedSocket).user = { ...decoded, is_admin: user.is_admin };
    next();
  });


  io.on("connection", (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    console.log(`User connected: ${socket.user.username}`);

    // Register user session (keyed by socket ID to support multiple sessions)
    connectedUsers.set(socket.id, {
      userId: socket.user.id,
      username: socket.user.username,
      socketId: socket.id,
      currentRoom: "",
    });

    // Determine initial room: last room user was in, or first membership
    const initRoom = async () => {
      const dbUser = await Data.user.findById(socket.user.id);
      let targetRoom = "";

      if (dbUser?.last_room_id) {
        // Find the active room matching this DB id
        for (const [name, room] of activeRooms.entries()) {
          if (room.id === dbUser.last_room_id) {
            const membership = await Data.roomMember.findByRoomAndUser(
              room.id,
              socket.user.id,
            );
            if (membership && membership.role !== "banned") {
              targetRoom = name;
            }
            break;
          }
        }
      }

      // If no last room, find first membership
      if (!targetRoom) {
        const memberships = await Data.roomMember.findByUser(socket.user.id);
        for (const m of memberships) {
          if (m.role === "banned") continue;
          for (const [name, room] of activeRooms.entries()) {
            if (room.id === m.room_id) {
              targetRoom = name;
              break;
            }
          }
          if (targetRoom) break;
        }
      }

      // No rooms at all — send to about page
      if (!targetRoom) {
        const user = connectedUsers.get(socket.id);
        if (user) user.currentRoom = "";
        socket.emit("no_rooms");
        // Still send room list (empty) so sidebar works
        const filtered = await getRoomListForUser(socket.user.id);
        socket.emit("room_list_update", { rooms: filtered });
        return;
      }

      socket.join(targetRoom);
      const room = activeRooms.get(targetRoom);
      if (room) room.users.add(socket.id);

      const user = connectedUsers.get(socket.id);
      if (user) user.currentRoom = targetRoom;

      const roomId = getRoomId(targetRoom);
      if (roomId) {
        const history = await Data.message.findByRoomForUI(roomId);
        socket.emit("room_joined", {
          roomName: room?.displayName || targetRoom,
          users: getRoomUsers(targetRoom),
          messages: formatHistoryForClient(history.reverse()),
        });
      }
    };

    initRoom().catch(console.error);

    io.emit("roster_update", Array.from(connectedUsers.values()));
    broadcastRoomListUpdate(io).catch(console.error);

    // ┌──────────────────────────────────────────┐
    // │ Chat Message                            │
    // └──────────────────────────────────────────┘
    socket.on("chat_message", async (data: IncomingMessage) => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      const roomId = getRoomId(user.currentRoom);
      if (!roomId) return;

      const text = data.text.trim();

      // ── Terminal approval via chat ──
      // User can say: "security yes", "security approve", "yes", "approve", etc.
      const approvalText = text.toLowerCase();
      const mentionsSecurity = approvalText.includes("security");
      const hasYes = /\b(yes|y|approve)\b/.test(approvalText);
      const hasNo = /\b(no|n|deny)\b/.test(approvalText);
      if (
        (mentionsSecurity || hasYes || hasNo) &&
        pendingApprovals.size > 0 &&
        (hasYes || hasNo)
      ) {
        for (const [approvalId, pending] of pendingApprovals) {
          if (
            pending.creatorId === socket.user.id &&
            pending.roomName === user.currentRoom
          ) {
            clearTimeout(pending.timeout);
            pending.resolve(hasYes);
            pendingApprovals.delete(approvalId);
            const approvalMessage = broadcastMessageAction(
              socket.user.username,
              data,
            );
            io.to(user.currentRoom).emit("chat_message", approvalMessage);
            return;
          }
        }
      }

      // ── User chat commands (handled before normal message flow) ──
      if (text.startsWith("/")) {
        const roomRecord = await Data.room.findById(roomId);

        // /users — list online users in this room
        if (text === "/users") {
          const users = getRoomUsers(user.currentRoom);
          const userList = users.map((u) => u.username).join(", ");
          socket.emit("chat_message", {
            text: `Online in this room (${users.length}): ${userList}`,
            username: "System",
            isSystem: true,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // /memory — show master summary
        if (
          text === "/memory" &&
          roomRecord?.memory_enabled &&
          roomRecord.cmd_memory_enabled
        ) {
          const master = await Data.memorySummary.findMasterByRoom(roomId);
          if (master) {
            emitSystemMessage(
              io,
              user.currentRoom,
              master.content,
              "Master Summary",
            );
          } else {
            emitSystemMessage(
              io,
              user.currentRoom,
              "[Memory] No master summary exists yet.",
            );
          }
          return;
        }

        // /recall <ref_name> — fetch a specific summary
        const recallCmd = text.match(/^\/recall\s+(\S+)$/i);
        if (
          recallCmd &&
          roomRecord?.memory_enabled &&
          roomRecord.cmd_recall_enabled
        ) {
          const summary = await Data.memorySummary.findByRoomAndRef(
            roomId,
            recallCmd[1],
          );
          if (summary) {
            emitSystemMessage(
              io,
              user.currentRoom,
              summary.content,
              `Recall: ${recallCmd[1]}`,
            );
          } else {
            emitSystemMessage(
              io,
              user.currentRoom,
              `[Memory] No summary found for "${recallCmd[1]}".`,
            );
          }
          return;
        }

        // /sql <SELECT query> — run read-only query on room messages
        const sqlCmd = text.match(/^\/sql\s+(SELECT.+)$/i);
        if (
          sqlCmd &&
          roomRecord?.memory_enabled &&
          roomRecord.cmd_sql_enabled
        ) {
          const result = await executeSafeQuery(roomId, sqlCmd[1]);
          emitSystemMessage(io, user.currentRoom, result, "SQL Result");
          return;
        }

      }

      const message = broadcastMessageAction(socket.user.username, data);

      // Persist message to database (await so history is up-to-date for AI agents)
      await Data.message.create({
        content: data.text,
        type: data.type || (data.voice ? "voice" : "text"),
        room_id: roomId,
        author_id: socket.user.id,
        username: socket.user.username,
      });

      io.to(user.currentRoom).emit("chat_message", message);

      // Generate TTS for user message server-side (so other users hear their selected voice)
      const BROWSER_VOICES = ["male", "female", "robot"];
      const userVoice = (data.voice && !BROWSER_VOICES.includes(data.voice)) ? data.voice : "Joanna";
      if (data.text.trim()) {
        (async () => {
          try {
            const { default: pollyAdapter } = await import("../../../../../core/adapters/polly");
            let sentiment;
            try {
              const { default: comprehendAdapter } = await import("../../../../../core/adapters/comprehend");
              sentiment = await comprehendAdapter.detectSentiment(data.text);
            } catch { /* sentiment optional */ }
            const ttsResult = await pollyAdapter.generateSpeechWithEmotion(data.text, userVoice, sentiment);
            if (ttsResult.audioBase64) {
              io.to(user.currentRoom).emit("chat_audio", {
                nonce: data.nonce,
                audio: ttsResult.audioBase64,
                sender: socket.user.username,
                voice: userVoice,
              });
            }
          } catch (ttsErr) {
            console.error(`[TTS] User voice generation failed for ${socket.user.username}:`, ttsErr);
          }
        })();
      }

      // Track when user last spoke (for Social Awareness subconscious)
      userLastSpoke.set(`${roomId}:${socket.user.id}`, Date.now());

      // Check if message mentions an AI agent (by name or nickname)
      const agents = await Data.llmAgent.findByRoom(roomId);
      const textLower = data.text.toLowerCase();

      let agentMentioned = false;
      for (const agent of agents) {
        const names = [agent.name.toLowerCase()];
        if (agent.nicknames) {
          try {
            const parsed = JSON.parse(agent.nicknames) as string[];
            names.push(...parsed.map((n: string) => n.toLowerCase()));
          } catch {
            /* ignore bad JSON */
          }
        }
        if (names.some((n) => textLower.includes(n))) {
          await runAgentResponse(io, agent, user.currentRoom);
          agentMentioned = true;
          break; // Only trigger one agent per message
        }
      }

      // "Alone in room" logic: if the user didn't mention any agent by name,
      // but they're the only human in the room with exactly one AI agent,
      // assume the message is for that agent and prompt it.
      if (!agentMentioned && agents.length === 1) {
        const roomEntry = activeRooms.get(user.currentRoom);
        if (roomEntry) {
          // Count human users in the room (exclude the agent's creator socket if it's just them)
          const humanUsers = new Set<string>();
          for (const sid of roomEntry.users) {
            const u = connectedUsers.get(sid);
            if (u) humanUsers.add(u.userId);
          }
          if (humanUsers.size <= 1) {
            // Only one human (the sender) + one AI — trigger the AI
            await runAgentResponse(io, agents[0], user.currentRoom);
          }
        }
      }

      // Trigger memory summarization every 5th message (fire-and-forget)
      const msgCount = memoryMsgCounters.get(roomId) ?? 0;
      memoryMsgCounters.set(roomId, msgCount + 1);
      if ((msgCount + 1) % 5 === 0) {
        const currentRoomName = user.currentRoom;
        Data.room
          .findById(roomId)
          .then((roomRecord) => {
            if (roomRecord?.memory_enabled && roomRecord.created_by) {
              const notify = (txt: string) =>
                emitSystemMessage(io, currentRoomName, txt);
              summarizeAction
                .triggerSummarization(roomId, roomRecord.created_by, notify)
                .catch(console.error);
            }
          })
          .catch(console.error);
      }
    });

    // ┌──────────────────────────────────────────┐
    // │ Voice Streaming                         │
    // └──────────────────────────────────────────┘
    socket.on(
      "voice_stream_start",
      (data: { sessionId: string; voiceId: string }) => {
        const user = connectedUsers.get(socket.id);
        if (!user?.currentRoom) return;

        socket.to(user.currentRoom).emit("voice_stream_start", {
          sessionId: data.sessionId,
          username: socket.user.username,
          speakerId: socket.user.id,
        });
      },
    );

    socket.on(
      "voice_chunk",
      async (data: {
        sessionId: string;
        chunkIndex: number;
        text: string;
        voiceId: string;
      }) => {
        const user = connectedUsers.get(socket.id);
        if (!user?.currentRoom) return;

        if (!data.text.trim()) return;

        await voiceQueue.addChunk({
          sessionId: data.sessionId,
          chunkIndex: data.chunkIndex,
          text: data.text,
          userId: socket.user.id,
          voiceId: data.voiceId,
          roomName: user.currentRoom,
          username: socket.user.username,
        });
      },
    );

    socket.on("voice_stream_end", (data: { sessionId: string }) => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      socket.to(user.currentRoom).emit("voice_stream_end", {
        sessionId: data.sessionId,
        speakerId: socket.user.id,
      });
    });

    // ┌──────────────────────────────────────────┐
    // │ Create Room                             │
    // └──────────────────────────────────────────┘
    socket.on(
      "create_room",
      async (data: { roomName: string; password?: string }) => {
        const { roomName, password } = data;
        const normalizedName = roomName.trim().toLowerCase();

        if (!validateRoomName(roomName)) {
          socket.emit("room_created", {
            success: false,
            error: "Invalid room name (3-30 chars, alphanumeric only)",
          });
          return;
        }

        if (activeRooms.has(normalizedName)) {
          socket.emit("room_created", {
            success: false,
            error: "Room already exists",
          });
          return;
        }

        const passwordHash = password
          ? await passwordHelper.hashPassword(password)
          : null;

        // Persist room to database first to get the UUID
        const dbRoom = await Data.room.create({
          name: normalizedName,
          display_name: roomName.trim(),
          password_hash: passwordHash,
          is_permanent: false,
          created_by: socket.user.id,
        });

        activeRooms.set(normalizedName, {
          id: dbRoom.id,
          users: new Set<string>(),
          passwordHash,
          displayName: roomName.trim(),
          createdBy: socket.user.id,
        });

        // Auto-add creator as member
        await Data.roomMember.addMember(dbRoom.id, socket.user.id);

        await joinRoom(socket, normalizedName);

        // Save last room
        Data.user
          .updateLastRoom(socket.user.id, dbRoom.id)
          .catch(console.error);

        socket.emit("room_created", {
          success: true,
          roomName: normalizedName,
        });

        // New room — no history yet (Helper Bot created after)
        socket.emit("room_joined", {
          roomName: roomName.trim(),
          users: getRoomUsers(normalizedName),
          messages: [],
        });

        broadcastRoomListUpdate(io).catch(console.error);

        // ── Create Helper Bot in every new room ──
        try {
          const helperInstructions = [
            {
              text: `IDENTITY: You are CommsLink Helper Bot — a friendly, knowledgeable guide to CommsLink. You welcome new users to their room and help them understand all the features available. You're enthusiastic but concise. You speak with warmth and excitement about what users can do.`,
              locked: true,
            },
            {
              text: `FEATURES YOU KNOW ABOUT:
- AI Agents: Users can create AI personas that live in rooms, respond to messages, and work autonomously. Agents can think, speak with voice, use tools, browse the web, and execute code.
- Remote Terminals: Connect your computer via the terminal agent. Run commands, deploy code, and use Claude Code sessions remotely.
- Voice Chat: Choose from browser voices (free) or premium TTS voices (costs credits). All messages can be spoken aloud.
- Web Browsing: AI agents can search the web, browse pages, take screenshots, and extract content.
- Scheduling: Set reminders and recurring tasks.
- Credits: You start with 10,000 free credits. AI features consume credits. Buy more credit packs anytime.
- Invite System: Invite others to your room with invite links. Rooms are private by default.`,
              locked: true,
            },
            {
              text: `BEHAVIOR:
1. On first message, welcome the user warmly using {text} (NOT {say}) and give a brief overview of 3-4 key features they can try right now. Ask if they'd like you to use your voice: "Would you like me to speak with my voice? Just say yes and I'll switch to voice mode!"
2. IMPORTANT: Use {text} (text-only, no voice) until the user explicitly says yes to voice. Only then switch to {say}. Speaking without permission is rude and surprising.
3. Answer any questions about how things work.
4. Be helpful and encouraging — make them excited to explore.
5. When on autopilot with no new messages, check in once using {text}: "Hey! I'm here if you need help. Want me to stay active or should I go quiet? You can always mention my name to wake me up!"
6. If the user says to deactivate/go quiet/stop, disable autopilot with {toggle_autopilot off} and say goodbye warmly.
7. Keep responses SHORT — 2-3 sentences max unless answering a detailed question.
8. NEVER make up features that don't exist. Stick to what's listed above.`,
              locked: true,
            },
            {
              text: `ROOM AI CONTROLS: You can create and manage AI agents for the user. Use these commands:
- {create_agent "AgentName" personality description here} — Creates a new AI in this room
- {delete_agent "AgentName"} — Removes an AI from this room
- {set_agent_voice "AgentName" voiceId} — Set voice. voiceId can be "male", "female", or a Polly voice name/ID.
- {update_agent "AgentName" name NewName} — Rename an agent
- {update_agent "AgentName" instructions New personality here} — Change agent behavior
- {list_room_agents} — Show all AIs in this room

YOUR OWN VOICE: Your name is "Helper Bot". You can change your own voice with {set_agent_voice "Helper Bot" voiceId}. Available voices: "male", "female", or Polly premium voices. Your current voice is Joanna (premium, female).

When a user asks you to create a companion, assistant, or character, use {create_agent} with a clear personality description. Offer voice options.
When a user asks to change a voice, ACTUALLY USE the {set_agent_voice} command — do not just say you changed it.`,
              locked: true,
            },
          ];

          const helperMemories = [
            { text: "I'm the CommsLink Helper Bot. I exist to welcome new users, teach them about the platform, and help them set up AI agents. I can create, customize, and manage AI companions on their behalf.", locked: true },
          ];

          await Data.llmAgent.create({
            name: "Helper Bot",
            room_id: dbRoom.id,
            creator_id: socket.user.id,
            voice_id: "Joanna", // Joanna - Professional, Warm (Amazon Polly)
            can_manage_agents: true,
            model: "grok-4-1-fast-non-reasoning",
            system_instructions: JSON.stringify(helperInstructions),
            memories: JSON.stringify(helperMemories),
            autopilot_enabled: true,
            autopilot_interval: 300,
            autopilot_prompts: JSON.stringify([
              {
                text: "Check if there are new messages from users. If yes, respond helpfully. If no new messages and you haven't checked in yet, send ONE friendly check-in asking if they need help or want you to go quiet. If you already checked in and got no response, stay silent. Never send more than one check-in without a user response in between.",
                locked: true,
              },
            ]),
            nicknames: JSON.stringify(["helper", "Helper", "helper bot", "Helper Bot", "bot"]),
            max_tokens: 1500,
          });

          // Send welcome message from the bot
          emitSystemMessage(
            io,
            normalizedName,
            `[Helper Bot] 👋 Welcome to your new room! I'm your Helper Bot — I'm here to show you around. Ask me anything about CommsLink's features: AI agents, voice chat, terminals, and more. I'll check in shortly!`,
          );
        } catch (helperErr) {
          console.error("Failed to create helper bot:", helperErr);
        }
      },
    );

    // ┌──────────────────────────────────────────┐
    // │ Join Room                               │
    // └──────────────────────────────────────────┘
    socket.on(
      "join_room",
      async (data: { roomName: string; password?: string }) => {
        const normalizedName = data.roomName.toLowerCase();
        const room = activeRooms.get(normalizedName);

        if (!room) {
          socket.emit("room_join_error", { error: "Room does not exist" });
          return;
        }

        // Check if user is banned from this room
        const membership = await Data.roomMember.findByRoomAndUser(
          room.id,
          socket.user.id,
        );
        if (membership?.role === "banned") {
          socket.emit("room_join_error", {
            error: "You are banned from this room",
          });
          return;
        }

        // User must already be a member or be the room creator to join
        const isCreator = room.createdBy === socket.user.id;
        if (!membership && !isCreator) {
          socket.emit("room_join_error", {
            error: "This room requires an invite to join",
          });
          return;
        }

        // If room has a password and user is NOT already a member, require password
        if (
          room.passwordHash &&
          (!membership || membership.role !== "member")
        ) {
          if (!data.password) {
            socket.emit("room_join_error", { error: "Password required" });
            return;
          }

          const valid = await passwordHelper.verifyPassword(
            data.password,
            room.passwordHash,
          );
          if (!valid) {
            socket.emit("room_join_error", { error: "Incorrect password" });
            return;
          }

          // Password correct — add as member so they don't need it again
          await Data.roomMember.addMember(room.id, socket.user.id);
        }

        await joinRoom(socket, normalizedName);

        // Save last room
        Data.user.updateLastRoom(socket.user.id, room.id).catch(console.error);

        const joinHistory = await Data.message.findByRoomForUI(room.id);
        socket.emit("room_joined", {
          roomName: room.displayName,
          users: getRoomUsers(normalizedName),
          messages: formatHistoryForClient(joinHistory.reverse()),
        });

        broadcastRoomListUpdate(io).catch(console.error);
      },
    );

    // ┌──────────────────────────────────────────┐
    // │ Create Invite Link                      │
    // └──────────────────────────────────────────┘
    socket.on("create_invite", async (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);
      if (!room) {
        socket.emit("invite_created", {
          success: false,
          error: "Room not found",
        });
        return;
      }

      // Only room creator or admin can create invites
      const dbUser = await Data.user.findById(socket.user.id);
      if (room.createdBy !== socket.user.id && !dbUser?.is_admin) {
        socket.emit("invite_created", {
          success: false,
          error: "Only room owner can create invites",
        });
        return;
      }

      const token = randomUUID();
      await Data.roomInvite.create(room.id, token, socket.user.id);

      socket.emit("invite_created", {
        success: true,
        token,
        roomName: normalizedName,
      });
    });

    // ┌──────────────────────────────────────────┐
    // │ Join via Invite Token                    │
    // └──────────────────────────────────────────┘
    socket.on("join_by_invite", async (data: { token: string }) => {
      const invite = await Data.roomInvite.findByToken(data.token);
      if (!invite) {
        socket.emit("room_join_error", {
          error: "Invalid or expired invite link",
        });
        return;
      }

      // Check expiry
      if (invite.expires_at && new Date() > invite.expires_at) {
        socket.emit("room_join_error", {
          error: "This invite link has expired",
        });
        return;
      }

      // Find the active room
      let targetName: string | null = null;
      for (const [name, room] of activeRooms.entries()) {
        if (room.id === invite.room_id) {
          targetName = name;
          break;
        }
      }
      if (!targetName) {
        socket.emit("room_join_error", { error: "Room no longer exists" });
        return;
      }

      const room = activeRooms.get(targetName)!;

      // Check ban status
      const membership = await Data.roomMember.findByRoomAndUser(
        room.id,
        socket.user.id,
      );
      if (membership?.role === "banned") {
        socket.emit("room_join_error", {
          error: "You are banned from this room",
        });
        return;
      }

      // Add as member (bypasses password)
      await Data.roomMember.addMember(room.id, socket.user.id);

      // Consume invite use if limited
      if (invite.uses_left !== null) {
        await Data.roomInvite.consumeUse(invite.id);
      }

      // Join the room
      await joinRoom(socket, targetName);
      Data.user.updateLastRoom(socket.user.id, room.id).catch(console.error);

      const invJoinHistory = await Data.message.findByRoomForUI(room.id);
      socket.emit("room_joined", {
        roomName: room.displayName,
        users: getRoomUsers(targetName),
        messages: formatHistoryForClient(invJoinHistory.reverse()),
      });

      broadcastRoomListUpdate(io).catch(console.error);
    });

    // ┌──────────────────────────────────────────┐
    // │ Switch Room                             │
    // └──────────────────────────────────────────┘
    socket.on("switch_room", async (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);

      if (!room) {
        socket.emit("room_join_error", { error: "Room does not exist" });
        return;
      }

      // All rooms require membership
      const membership = await Data.roomMember.findByRoomAndUser(
        room.id,
        socket.user.id,
      );
      if (!membership || membership.role === "banned") {
        socket.emit("room_join_error", {
          error: "You are not a member of this room",
        });
        return;
      }

      await joinRoom(socket, normalizedName);

      // Save last room
      Data.user.updateLastRoom(socket.user.id, room.id).catch(console.error);

      const switchHistory = await Data.message.findByRoomForUI(room.id);
      socket.emit("room_joined", {
        roomName: room.displayName,
        users: getRoomUsers(normalizedName),
        messages: formatHistoryForClient(switchHistory.reverse()),
      });

      broadcastRoomListUpdate(io).catch(console.error);
    });

    // ┌──────────────────────────────────────────┐
    // │ AI Agents                               │
    // └──────────────────────────────────────────┘
    socket.on(
      "create_agent",
      async (data: {
        name: string;
        roomName: string;
        voiceId?: string;
        model?: string;
        systemInstructions?: string;
        memories?: string;
        autopilotEnabled?: boolean;
        autopilotInterval?: number;
        autopilotPrompts?: string;
        plan?: string | null;
        tasks?: string | null;
        nicknames?: string | null;
        maxTokens?: number;
      }) => {
        const normalizedRoom = data.roomName.toLowerCase();
        const roomId = getRoomId(normalizedRoom);

        if (!roomId) {
          socket.emit("agent_error", { error: "Room not found" });
          return;
        }

        if (!data.name || data.name.length < 1 || data.name.length > 30) {
          socket.emit("agent_error", {
            error: "Agent name must be 1-30 characters",
          });
          return;
        }

        const count = await Data.llmAgent.countByRoom(roomId);
        if (count >= 5) {
          socket.emit("agent_error", { error: "Maximum 5 agents per room" });
          return;
        }

        const agent = await Data.llmAgent.create({
          name: data.name,
          room_id: roomId,
          creator_id: socket.user.id,
          voice_id: data.voiceId || "Joanna",
          model: data.model || undefined,
          system_instructions: data.systemInstructions || undefined,
          memories: data.memories || undefined,
          autopilot_enabled: data.autopilotEnabled || false,
          autopilot_interval: data.autopilotInterval || 300,
          autopilot_prompts: data.autopilotPrompts || undefined,
          plan: data.plan || undefined,
          tasks: data.tasks || undefined,
          nicknames: data.nicknames || undefined,
          max_tokens: data.maxTokens || 2500,
        });

        if (agent.autopilot_enabled) {
          startAutopilotTimer(io, agent);
        }

        io.to(normalizedRoom).emit("agent_created", agent);
      },
    );

    socket.on(
      "update_agent",
      async (data: {
        agentId: string;
        name?: string;
        voiceId?: string;
        model?: string;
        systemInstructions?: string;
        memories?: string;
        autopilotEnabled?: boolean;
        autopilotInterval?: number;
        autopilotPrompts?: string;
        plan?: string | null;
        tasks?: string | null;
        nicknames?: string | null;
        maxTokens?: number;
      }) => {
        const agent = await Data.llmAgent.findById(data.agentId);
        if (!agent) {
          socket.emit("agent_error", { error: "Agent not found" });
          return;
        }

        const updated = await Data.llmAgent.update(data.agentId, {
          name: data.name,
          voice_id: data.voiceId,
          model: data.model,
          system_instructions: data.systemInstructions ?? null,
          memories: data.memories ?? null,
          autopilot_enabled: data.autopilotEnabled,
          autopilot_interval: data.autopilotInterval,
          autopilot_prompts: data.autopilotPrompts ?? null,
          plan: data.plan ?? null,
          tasks: data.tasks ?? null,
          nicknames: data.nicknames ?? null,
          max_tokens: data.maxTokens,
        });

        // Restart or stop autopilot timer
        stopAutopilotTimer(updated.id);
        if (updated.autopilot_enabled) {
          startAutopilotTimer(io, updated);
        }

        // Find the room name key for this room_id to emit to the right socket.io room
        const roomEntry = Array.from(activeRooms.entries()).find(
          ([, r]) => r.id === agent.room_id,
        );
        if (roomEntry) {
          io.to(roomEntry[0]).emit("agent_updated", updated);
        }
      },
    );

    socket.on("delete_agent", async (data: { agentId: string }) => {
      const agent = await Data.llmAgent.findById(data.agentId);
      if (!agent) {
        socket.emit("agent_error", { error: "Agent not found" });
        return;
      }

      stopAutopilotTimer(data.agentId);
      await Data.llmAgent.remove(data.agentId);

      const roomEntry = Array.from(activeRooms.entries()).find(
        ([, r]) => r.id === agent.room_id,
      );
      if (roomEntry) {
        io.to(roomEntry[0]).emit("agent_deleted", { agentId: data.agentId });
      }
    });

    socket.on("get_room_agents", async (data: { roomName: string }) => {
      const roomId = getRoomId(data.roomName.toLowerCase());
      if (!roomId) {
        socket.emit("room_agents", { roomName: data.roomName, agents: [] });
        return;
      }
      const agents = await Data.llmAgent.findByRoom(roomId);
      socket.emit("room_agents", { roomName: data.roomName, agents });
    });

    // ┌──────────────────────────────────────────┐
    // │ Room Memory                             │
    // └──────────────────────────────────────────┘
    socket.on("get_room_memory", async (data: { roomName: string }) => {
      const roomId = getRoomId(data.roomName.toLowerCase());
      if (!roomId) {
        socket.emit("room_memory_status", {
          enabled: false,
          cmdRecall: true,
          cmdSql: true,
          cmdMemory: true,
          cmdSelfmod: true,
          cmdAutopilot: true,
          cmdMentions: true,
          cmdTerminal: false,
          cmdClaude: false,
          cmdTokens: false,
          cmdModeration: false,
          cmdThink: true,
          cmdEffort: false,
          cmdAudit: false,
          cmdContinue: false,
          cmdIntentCoherence: true,
          cmdMemoryCoherence: true,
          maxLoops: 5,
        });
        return;
      }
      const roomRecord = await Data.room.findById(roomId);
      socket.emit("room_memory_status", {
        enabled: roomRecord?.memory_enabled ?? true,
        cmdRecall: roomRecord?.cmd_recall_enabled ?? true,
        cmdSql: roomRecord?.cmd_sql_enabled ?? true,
        cmdMemory: roomRecord?.cmd_memory_enabled ?? true,
        cmdSelfmod: roomRecord?.cmd_selfmod_enabled ?? true,
        cmdAutopilot: roomRecord?.cmd_autopilot_enabled ?? true,
        cmdMentions: roomRecord?.cmd_mentions_enabled ?? true,
        cmdTerminal: roomRecord?.cmd_terminal_enabled ?? false,
        cmdClaude: roomRecord?.cmd_claude_enabled ?? false,
        cmdTokens: roomRecord?.cmd_tokens_enabled ?? false,
        cmdModeration: roomRecord?.cmd_moderation_enabled ?? false,
        cmdThink: roomRecord?.cmd_think_enabled ?? true,
        cmdEffort: roomRecord?.cmd_effort_enabled ?? false,
        cmdAudit: roomRecord?.cmd_audit_enabled ?? false,
        cmdContinue: roomRecord?.cmd_continue_enabled ?? false,
        cmdIntentCoherence: roomRecord?.cmd_intent_coherence_enabled ?? true,
        cmdMemoryCoherence: roomRecord?.cmd_memory_coherence_enabled ?? true,
        maxLoops: roomRecord?.max_loops ?? 5,
      });
    });

    socket.on("get_room_summaries", async (data: { roomName: string }) => {
      const roomId = getRoomId(data.roomName.toLowerCase());
      if (!roomId) {
        socket.emit("room_summaries", { summaries: [] });
        return;
      }
      const room = activeRooms.get(data.roomName.toLowerCase());
      if (room && room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit("room_summaries", { summaries: [] });
        return;
      }
      const summaries = await Data.memorySummary.findAllByRoom(roomId);
      socket.emit("room_summaries", {
        summaries: summaries.map((s) => ({
          id: s.id,
          ref_name: s.ref_name,
          level: s.level,
          parent_id: s.parent_id,
          content: s.content,
          msg_start: s.msg_start,
          msg_end: s.msg_end,
          messages_covered: s.messages_covered,
          created_at: s.created_at,
        })),
      });
    });

    socket.on(
      "update_room_commands",
      async (data: {
        roomName: string;
        cmdRecall?: boolean;
        cmdSql?: boolean;
        cmdMemory?: boolean;
        cmdSelfmod?: boolean;
        cmdAutopilot?: boolean;
        cmdMentions?: boolean;
        cmdTerminal?: boolean;
        cmdClaude?: boolean;
        cmdTokens?: boolean;
        cmdModeration?: boolean;
        cmdThink?: boolean;
        cmdEffort?: boolean;
        cmdAudit?: boolean;
        cmdContinue?: boolean;
        cmdIntentCoherence?: boolean;
        cmdMemoryCoherence?: boolean;
        maxLoops?: number;
      }) => {
        const normalizedName = data.roomName.toLowerCase();
        const room = activeRooms.get(normalizedName);
        if (!room) return;

        if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
          socket.emit("agent_error", {
            error: "Only the room creator can change command settings",
          });
          return;
        }

        await Data.room.updateCommandSettings(room.id, {
          cmd_recall_enabled: data.cmdRecall,
          cmd_sql_enabled: data.cmdSql,
          cmd_memory_enabled: data.cmdMemory,
          cmd_selfmod_enabled: data.cmdSelfmod,
          cmd_autopilot_enabled: data.cmdAutopilot,
          cmd_mentions_enabled: data.cmdMentions,
          cmd_terminal_enabled: data.cmdTerminal,
          cmd_claude_enabled: data.cmdClaude,
          cmd_tokens_enabled: data.cmdTokens,
          cmd_moderation_enabled: data.cmdModeration,
          cmd_think_enabled: data.cmdThink,
          cmd_effort_enabled: data.cmdEffort,
          cmd_audit_enabled: data.cmdAudit,
          cmd_continue_enabled: data.cmdContinue,
          cmd_intent_coherence_enabled: data.cmdIntentCoherence,
          cmd_memory_coherence_enabled: data.cmdMemoryCoherence,
          max_loops:
            data.maxLoops !== undefined
              ? Math.max(3, Math.min(20, data.maxLoops))
              : undefined,
        });

        io.to(normalizedName).emit("room_commands_updated", {
          cmdRecall: data.cmdRecall,
          cmdSql: data.cmdSql,
          cmdMemory: data.cmdMemory,
          cmdSelfmod: data.cmdSelfmod,
          cmdAutopilot: data.cmdAutopilot,
          cmdMentions: data.cmdMentions,
          cmdTerminal: data.cmdTerminal,
          cmdClaude: data.cmdClaude,
          cmdTokens: data.cmdTokens,
          cmdModeration: data.cmdModeration,
          cmdThink: data.cmdThink,
          cmdEffort: data.cmdEffort,
          cmdAudit: data.cmdAudit,
          cmdContinue: data.cmdContinue,
          cmdIntentCoherence: data.cmdIntentCoherence,
          cmdMemoryCoherence: data.cmdMemoryCoherence,
          maxLoops: data.maxLoops,
        });
      },
    );

    // ┌──────────────────────────────────────────┐
    // │ Terminal Approval                        │
    // └──────────────────────────────────────────┘
    socket.on(
      "terminal_approval",
      (data: { approvalId: string; approved: boolean }) => {
        const pending = pendingApprovals.get(data.approvalId);
        if (!pending) return;

        // Only the creator can approve
        if (socket.user.id !== pending.creatorId) {
          socket.emit("agent_error", {
            error: "Only the room creator can approve terminal commands",
          });
          return;
        }

        clearTimeout(pending.timeout);
        pending.resolve(data.approved);
        pendingApprovals.delete(data.approvalId);
      },
    );

    // ┌──────────────────────────────────────────┐
    // │ Machine Management                       │
    // └──────────────────────────────────────────┘
    socket.on(
      "machine_register",
      async (data: { name: string; os?: string; version?: string }) => {
        const machineName = data.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "-");
        if (!machineName || machineName.length < 1 || machineName.length > 50) {
          socket.emit("machine_error", {
            error:
              "Machine name must be 1-50 characters (lowercase alphanumeric and hyphens)",
          });
          return;
        }

        let machineRecord = await Data.machine.findByOwnerAndName(
          socket.user.id,
          machineName,
        );

        if (machineRecord) {
          // Update existing machine
          machineRecord = await Data.machine.update(machineRecord.id, {
            socket_id: socket.id,
            status: "online",
            os: data.os,
            last_seen: new Date(),
          });
        } else {
          // Create new machine
          machineRecord = await Data.machine.create({
            name: machineName,
            owner_id: socket.user.id,
            os: data.os,
          });
          machineRecord = await Data.machine.update(machineRecord.id, {
            socket_id: socket.id,
            status: "online",
            last_seen: new Date(),
          });
        }

        socket.emit("machine_registered", {
          id: machineRecord.id,
          name: machineName,
          status: "online",
        });
        console.log(
          `[Machine] ${socket.user.username}/${machineName} registered (${data.os || "unknown OS"}, v${data.version || "unknown"})`,
        );

        // Check agent version and request update if outdated
        // Only request update if server version is NEWER (not equal or older)
        const isNewer = (server: string, client: string): boolean => {
          const s = server.split(".").map(Number);
          const c = client.split(".").map(Number);
          for (let i = 0; i < Math.max(s.length, c.length); i++) {
            if ((s[i] || 0) > (c[i] || 0)) return true;
            if ((s[i] || 0) < (c[i] || 0)) return false;
          }
          return false;
        };
        if (
          data.version &&
          expectedAgentVersion !== "unknown" &&
          isNewer(expectedAgentVersion, data.version)
        ) {
          const osStr = (data.os || "").toLowerCase();
          const agentPlatform = osStr.includes("win32")
            ? "win"
            : osStr.includes("darwin")
              ? "macos"
              : "linux";
          const serverUrl = process.env.CLIENT_URL || "https://commslink.net";
          const downloadUrl = `${serverUrl}/api/v1/terminal/download/${agentPlatform}`;
          console.log(
            `[Machine] ${machineName} has v${data.version}, expected v${expectedAgentVersion} — requesting update`,
          );
          socket.emit("update_required", {
            currentVersion: data.version,
            newVersion: expectedAgentVersion,
            downloadUrl,
          });
        }

        // Listen for debug events from the agent's Claude PTY collection
        socket.on(
          "claude_debug",
          (debugData: {
            execId: string;
            phase: string;
            stripped?: string;
            choice?: string;
            approvalCount?: number;
          }) => {
            console.log(
              `[claude_debug] ${machineName} phase=${debugData.phase} execId=${debugData.execId}${debugData.choice ? ` choice=${debugData.choice}` : ""}`,
            );
            if (debugData.stripped) {
              console.log(
                `[claude_debug] Stripped tail: ${debugData.stripped.substring(0, 300)}`,
              );
            }
            Data.claudeLog
              .create({
                direction: "debug",
                session_key: debugData.execId,
                machine_name: machineName,
                username: socket.user.username,
                room_name: "system",
                content: JSON.stringify(debugData).substring(0, 4000),
              })
              .catch(() => {});
          },
        );

        // Listen for /btw status updates from Claude PTY and post to chat
        socket.on(
          "claude_btw_status",
          (statusData: {
            execId: string;
            status: string;
            elapsedSeconds: number;
          }) => {
            console.log(
              `[claude_btw] ${machineName} at ${statusData.elapsedSeconds}s: ${statusData.status.substring(0, 200)}`,
            );
            // Find which room the user is in
            const user = connectedUsers.get(socket.id);
            const rn = user?.currentRoom || "";
            const elapsed = statusData.elapsedSeconds;
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            const timeStr = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;
            emitSystemMessage(
              io,
              rn,
              `[Claude ${machineName} status @ ${timeStr}]: ${statusData.status.substring(0, 2000)}`,
              undefined,
              "claude-response",
            );
            emitPanelLog(
              io,
              rn,
              "claude",
              "status",
              `[${timeStr}] ${statusData.status.substring(0, 2000)}`,
              machineName,
            );
          },
        );

        // Auto-grant permission in all rooms owned by this user
        for (const [roomName, room] of activeRooms.entries()) {
          if (room.createdBy === socket.user.id && room.id) {
            const existing = await Data.machinePermission.findByMachineAndRoom(
              machineRecord.id,
              room.id,
            );
            if (!existing) {
              await Data.machinePermission.upsert(
                machineRecord.id,
                room.id,
                true,
              );
              console.log(
                `[Machine] Auto-granted ${machineName} permission in room "${roomName}"`,
              );
            }
          }
        }

        // Notify all of this user's browser sessions about the updated machines list
        const updatedMachines = await Data.machine.findByOwner(socket.user.id);
        for (const [sid, userData] of connectedUsers.entries()) {
          if (userData.userId === socket.user.id) {
            const browserSocket = io.sockets.sockets.get(sid);
            if (browserSocket) {
              browserSocket.emit("machines_list", {
                machines: updatedMachines,
              });
            }
          }
        }
      },
    );

    socket.on("get_machines", async () => {
      const machines = await Data.machine.findByOwner(socket.user.id);
      socket.emit("machines_list", { machines });
    });

    socket.on(
      "get_panel_logs",
      async (data: { tab: "terminal" | "claude" }) => {
        const user = connectedUsers.get(socket.id);
        const roomId = user?.currentRoom
          ? getRoomId(user.currentRoom)
          : undefined;
        if (!roomId) {
          socket.emit("panel_logs", { tab: data.tab, entries: [] });
          return;
        }
        const rows = await Data.panelLog.findRecent(roomId, data.tab, 150);
        const entries = rows.map(
          (r: {
            entry_type: string;
            text: string;
            machine: string | null;
            created_at: Date;
          }) => ({
            type: r.entry_type,
            text: r.text,
            machine: r.machine,
            timestamp: r.created_at.getTime(),
          }),
        );
        socket.emit("panel_logs", { tab: data.tab, entries });
      },
    );

    socket.on("delete_machine", async (data: { machineId: string }) => {
      const machineRecord = await Data.machine.findById(data.machineId);
      if (!machineRecord || machineRecord.owner_id !== socket.user.id) {
        socket.emit("machine_error", {
          error: "Machine not found or not owned by you",
        });
        return;
      }
      await Data.machine.remove(data.machineId);
      socket.emit("machine_deleted", { machineId: data.machineId });
    });

    socket.on(
      "update_machine_permission",
      async (data: {
        machineId: string;
        roomName: string;
        enabled: boolean;
      }) => {
        const machineRecord = await Data.machine.findById(data.machineId);
        if (!machineRecord || machineRecord.owner_id !== socket.user.id) {
          socket.emit("machine_error", {
            error: "Machine not found or not owned by you",
          });
          return;
        }

        const normalizedRoom = data.roomName.toLowerCase();
        const roomId = getRoomId(normalizedRoom);
        if (!roomId) {
          socket.emit("machine_error", { error: "Room not found" });
          return;
        }

        await Data.machinePermission.upsert(
          machineRecord.id,
          roomId,
          data.enabled,
        );
        socket.emit("machine_permission_updated", {
          machineId: data.machineId,
          roomName: data.roomName,
          enabled: data.enabled,
        });
      },
    );

    socket.on("get_room_machines", async (data: { roomName: string }) => {
      const normalizedRoom = data.roomName.toLowerCase();
      const roomId = getRoomId(normalizedRoom);
      if (!roomId) {
        socket.emit("room_machines", { machines: [], ownedMachines: [] });
        return;
      }
      const permissions = await Data.machinePermission.findByRoom(roomId);
      // Also send the user's own machines so they can add them to the room
      const ownedMachines = await Data.machine.findByOwner(socket.user.id);
      socket.emit("room_machines", { machines: permissions, ownedMachines });
    });

    // ┌──────────────────────────────────────────┐
    // │ Terminal / Claude Panel Input            │
    // └──────────────────────────────────────────┘

    socket.on(
      "terminal_panel_input",
      async (data: { machineName: string; command: string }) => {
        const machineRecord = await Data.machine.findByOwnerAndName(
          socket.user.id,
          data.machineName,
        );
        if (
          !machineRecord ||
          machineRecord.status !== "online" ||
          !machineRecord.socket_id
        ) {
          socket.emit("terminal_panel_output", {
            machineName: data.machineName,
            output: "Error: Machine not found or offline.",
            isError: true,
          });
          return;
        }

        // Emit to chat as system message so AI can see it
        const user = connectedUsers.get(socket.id);
        if (user?.currentRoom) {
          const roomId = getRoomId(user.currentRoom);
          if (roomId) {
            emitSystemMessage(
              io,
              user.currentRoom,
              `[${socket.user.username} terminal → ${data.machineName}]: ${data.command}`,
              undefined,
              "terminal",
            );
            emitPanelLog(
              io,
              user.currentRoom,
              "terminal",
              "command",
              `[${socket.user.username} → ${data.machineName}] ${data.command}`,
              data.machineName,
            );
          }
        }

        try {
          const output = await executeTerminalCommand(
            io,
            machineRecord.socket_id,
            data.command,
            30_000,
            data.machineName,
            user?.currentRoom,
          );
          socket.emit("terminal_panel_output", {
            machineName: data.machineName,
            output,
          });

          if (user?.currentRoom) {
            emitSystemMessage(
              io,
              user.currentRoom,
              `[Terminal ${data.machineName}]:\n${output.substring(0, 2000)}`,
              undefined,
              "terminal",
            );
            emitPanelLog(
              io,
              user.currentRoom,
              "terminal",
              "output",
              output.substring(0, 2000),
              data.machineName,
            );
          }
        } catch (err) {
          socket.emit("terminal_panel_output", {
            machineName: data.machineName,
            output: `Error: ${(err as Error).message}`,
            isError: true,
          });
        }
      },
    );

    // ── Claude Panel Sessions (Conversational) ──
    // Routes user input to the running Claude PTY on the terminal agent.
    // Output streams back in real-time via claude_terminal_data events.

    // Track which machine sockets we've attached listeners to (by socket ID)
    const claudePtyListeners = new Set<string>();

    socket.on(
      "claude_panel_input",
      async (data: {
        machineName: string;
        input: string;
        approved?: boolean;
      }) => {
        console.log(
          `[claude_panel] Received input from ${socket.user.username}: "${data.input.substring(0, 100)}" machine=${data.machineName}`,
        );

        const machineRecord = await Data.machine.findByOwnerAndName(
          socket.user.id,
          data.machineName,
        );
        if (
          !machineRecord ||
          machineRecord.status !== "online" ||
          !machineRecord.socket_id
        ) {
          console.log(
            `[claude_panel] Machine not found/offline: ${data.machineName}`,
          );
          socket.emit("claude_panel_output", {
            machineName: data.machineName,
            data: "Error: Machine not found or offline.\r\n",
          });
          return;
        }

        const machineSocket = io.sockets.sockets.get(machineRecord.socket_id);
        if (!machineSocket) {
          console.log(
            `[claude_panel] Machine socket not found for socket_id=${machineRecord.socket_id}`,
          );
          socket.emit("claude_panel_output", {
            machineName: data.machineName,
            data: "Error: Machine socket not found.\r\n",
          });
          return;
        }

        const user = connectedUsers.get(socket.id);
        const roomName = user?.currentRoom || "";
        const roomId = getRoomId(roomName);
        const sessionKey = `${socket.id}:${data.machineName}`;

        // Log to database
        Data.claudeLog
          .create({
            direction: "user_to_claude",
            session_key: sessionKey,
            machine_name: data.machineName,
            username: socket.user.username,
            room_name: roomName,
            content: data.input,
          })
          .catch(() => {});

        // Set up PTY output listener on this machine socket (once per machine socket ID)
        const listenerKey = machineRecord.socket_id;
        if (!claudePtyListeners.has(listenerKey)) {
          claudePtyListeners.add(listenerKey);
          console.log(
            `[claude_panel] Setting up PTY listeners on machine socket ${listenerKey}`,
          );

          // PTY output mirror — raw terminal data from the interactive Claude session
          machineSocket.on(
            "claude_terminal_data",
            (out: { machineName: string; data: string }) => {
              // Log first 200 chars of each chunk
              console.log(
                `[claude_panel] PTY data from ${out.machineName}: ${out.data.length} bytes`,
              );

              // Log to database (truncated)
              Data.claudeLog
                .create({
                  direction: "claude_to_user",
                  session_key: `pty:${out.machineName}`,
                  machine_name: out.machineName,
                  username: socket.user.username,
                  room_name: roomName,
                  content: out.data.substring(0, 2000),
                })
                .catch(() => {});

              socket.emit("claude_panel_output", {
                machineName: out.machineName,
                data: out.data,
              });
            },
          );

          // Also listen for session-level events (echo, done, etc.)
          machineSocket.on(
            "claude_session_output",
            (out: { sessionKey: string; data: string }) => {
              console.log(
                `[claude_panel] Session output: sessionKey=${out.sessionKey} ${out.data.length} bytes`,
              );
              socket.emit("claude_panel_output", {
                machineName: data.machineName,
                data: out.data,
              });
            },
          );

          // Listen for collected responses (/copy clipboard result) — post to chat
          machineSocket.on(
            "claude_pty_response",
            (out: { output: string; exitCode: number }) => {
              console.log(
                `[claude_panel] PTY response (clipboard): ${out.output.length} chars`,
              );
              if (out.output && out.output !== "(no response captured)") {
                const user2 = connectedUsers.get(socket.id);
                const rn = user2?.currentRoom || "";
                emitSystemMessage(
                  io,
                  rn,
                  `[Claude → ${data.machineName} response]:\n${out.output.substring(0, 4000)}`,
                  undefined,
                  "claude-response",
                );
                emitPanelLog(
                  io,
                  rn,
                  "claude",
                  "response",
                  out.output.substring(0, 4000),
                  data.machineName,
                );

                Data.claudeLog
                  .create({
                    direction: "claude_response",
                    session_key: `response:${data.machineName}`,
                    machine_name: data.machineName,
                    username: socket.user.username,
                    room_name: rn,
                    content: out.output.substring(0, 4000),
                  })
                  .catch(() => {});
              }
            },
          );
        }

        // Send input to the agent PTY — use collectResponse so /copy captures the response
        const panelExecId = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        console.log(
          `[claude_panel] Emitting claude_session_input to agent: sessionKey=${sessionKey} execId=${panelExecId}`,
        );
        machineSocket.emit("claude_session_input", {
          sessionKey,
          input: data.input,
          approved: data.approved,
          collectResponse: true,
          execId: panelExecId,
        });

        if (roomId) {
          emitSystemMessage(
            io,
            roomName,
            `[${socket.user.username} claude → ${data.machineName}]: ${data.input}`,
            undefined,
            "claude-prompt",
          );
          emitPanelLog(
            io,
            roomName,
            "claude",
            "prompt",
            `[${socket.user.username} → ${data.machineName}] ${data.input}`,
            data.machineName,
          );
        }
      },
    );

    socket.on("claude_panel_stop", async (data: { machineName: string }) => {
      const machineRecord = await Data.machine.findByOwnerAndName(
        socket.user.id,
        data.machineName,
      );
      if (!machineRecord || !machineRecord.socket_id) return;

      const machineSocket = io.sockets.sockets.get(machineRecord.socket_id);
      if (!machineSocket) return;

      machineSocket.emit("claude_session_stop");
    });

    socket.on("room_alarm", (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      if (!activeRooms.has(normalizedName)) return;
      io.to(normalizedName).emit("trigger_alarm", {
        message: `${socket.user.username} is trying to get your attention!`,
        agentName: socket.user.username,
      });
      emitSystemMessage(
        io,
        normalizedName,
        `[${socket.user.username} sounded the alarm!]`,
      );
    });

    socket.on("clear_chat", async (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);
      if (!room) return;

      if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit("agent_error", {
          error: "Only the room creator or admin can clear chat",
        });
        return;
      }

      const count = await Data.message.archiveByRoom(room.id);
      console.log(
        `[ClearChat] Archived ${count} messages in room ${normalizedName}`,
      );
      io.to(normalizedName).emit("chat_cleared");
    });

    socket.on(
      "toggle_memory",
      async (data: { roomName: string; enabled: boolean }) => {
        const normalizedName = data.roomName.toLowerCase();
        const room = activeRooms.get(normalizedName);
        if (!room) {
          socket.emit("agent_error", { error: "Room not found" });
          return;
        }

        // Only room creator or admin can toggle
        if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
          socket.emit("agent_error", {
            error: "Only the room creator can toggle memory",
          });
          return;
        }

        // Room creator can toggle memory (no premium requirement)
        const creator = await Data.user.findById(socket.user.id);
        if (!creator) {
          socket.emit("agent_error", { error: "User not found" });
          return;
        }

        await Data.room.updateMemoryEnabled(room.id, data.enabled);
        io.to(normalizedName).emit("memory_toggled", {
          roomName: normalizedName,
          enabled: data.enabled,
        });

        // Immediately check if summarization is needed
        if (data.enabled) {
          const notify = (text: string) =>
            emitSystemMessage(io, normalizedName, text);
          summarizeAction
            .triggerSummarization(room.id, socket.user.id, notify, true)
            .catch(console.error);
        }
      },
    );

    // ┌──────────────────────────────────────────┐
    // │ Delete Room                             │
    // └──────────────────────────────────────────┘
    socket.on("delete_room", async (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();

      const room = activeRooms.get(normalizedName);
      if (!room) {
        socket.emit("room_join_error", { error: "Room does not exist" });
        return;
      }

      // Only creator or admin can delete
      if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit("room_join_error", {
          error: "Only the room creator or an admin can delete this room",
        });
        return;
      }

      // Notify all users in the room that it's being deleted
      io.to(normalizedName).emit("room_deleted", {
        roomName: normalizedName,
        message: `Room "${room.displayName || normalizedName}" has been deleted.`,
      });

      // Move all users in that room to their fallback room
      const usersToMove = Array.from(room.users);
      for (const sid of usersToMove) {
        const u = connectedUsers.get(sid);
        if (u) {
          const userSocket = io.sockets.sockets.get(u.socketId);
          if (userSocket) {
            userSocket.leave(normalizedName);
            await sendToFallbackRoom(io, sid, u.userId);
          }
        }
      }

      // Remove from memory and DB
      activeRooms.delete(normalizedName);
      Data.room.deleteByName(normalizedName).catch(console.error);

      broadcastRoomListUpdate(io).catch(console.error);
    });

    // ┌──────────────────────────────────────────┐
    // │ Room Membership (kick / ban / unban)   │
    // └──────────────────────────────────────────┘
    socket.on("get_room_members", async (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);
      if (!room) return;

      const members = await Data.roomMember.findByRoom(room.id);
      socket.emit("room_members", {
        roomName: normalizedName,
        members: members.map((m) => ({
          userId: m.user_id,
          username: m.user.username,
          role: m.role,
        })),
      });
    });

    socket.on(
      "kick_member",
      async (data: { roomName: string; userId: string }) => {
        const normalizedName = data.roomName.toLowerCase();
        const room = activeRooms.get(normalizedName);
        if (!room) return;

        // Only creator or admin can kick
        if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
          socket.emit("room_join_error", {
            error: "Only the room creator or an admin can kick users",
          });
          return;
        }

        // Remove membership
        await Data.roomMember.removeMember(room.id, data.userId);

        // Find their sockets and move to fallback room
        for (const [sid, u] of connectedUsers.entries()) {
          if (u.userId === data.userId && u.currentRoom === normalizedName) {
            const targetSocket = io.sockets.sockets.get(sid);
            if (targetSocket) {
              room.users.delete(sid);
              targetSocket.leave(normalizedName);
              targetSocket.emit("room_join_error", {
                error: "You have been kicked from the room",
              });
              await sendToFallbackRoom(io, sid, u.userId);
            }
          }
        }

        emitSystemMessage(
          io,
          normalizedName,
          `[System] ${data.userId} was kicked from the room.`,
        );
        broadcastRoomListUpdate(io).catch(console.error);
      },
    );

    socket.on(
      "ban_member",
      async (data: { roomName: string; userId: string }) => {
        const normalizedName = data.roomName.toLowerCase();
        const room = activeRooms.get(normalizedName);
        if (!room) return;

        if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
          socket.emit("room_join_error", {
            error: "Only the room creator or an admin can ban users",
          });
          return;
        }

        // Set role to banned
        await Data.roomMember.addMember(room.id, data.userId, "banned");

        // Find their sockets and move to public
        for (const [sid, u] of connectedUsers.entries()) {
          if (u.userId === data.userId && u.currentRoom === normalizedName) {
            const targetSocket = io.sockets.sockets.get(sid);
            if (targetSocket) {
              room.users.delete(sid);
              targetSocket.leave(normalizedName);
              targetSocket.emit("room_join_error", {
                error: "You have been banned from this room",
              });
              await sendToFallbackRoom(io, sid, u.userId);
            }
          }
        }

        emitSystemMessage(
          io,
          normalizedName,
          `[System] A user was banned from the room.`,
        );
        broadcastRoomListUpdate(io).catch(console.error);
      },
    );

    socket.on(
      "unban_member",
      async (data: { roomName: string; userId: string }) => {
        const normalizedName = data.roomName.toLowerCase();
        const room = activeRooms.get(normalizedName);
        if (!room) return;

        if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
          socket.emit("room_join_error", {
            error: "Only the room creator or an admin can unban users",
          });
          return;
        }

        await Data.roomMember.removeMember(room.id, data.userId);
        socket.emit("room_join_error", { error: "User has been unbanned" });
      },
    );

    // ┌──────────────────────────────────────────┐
    // │ Screenshot response (for AI {look})     │
    // └──────────────────────────────────────────┘
    socket.on(
      "screenshot_response",
      (data: { requestId: string; base64: string; mimeType: string }) => {
        const pending = pendingScreenshots.get(data.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingScreenshots.delete(data.requestId);
          pending.resolve({ base64: data.base64, mimeType: data.mimeType });
        }
      },
    );

    // ┌──────────────────────────────────────────┐
    // │ Chat Audio (late TTS for messages)     │
    // └──────────────────────────────────────────┘
    socket.on("chat_audio", (data: { nonce?: string; audio: string; voice?: string }) => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom || !data.audio) return;
      console.log(`[Audio] ${socket.user.username} sent TTS audio (${Math.round(data.audio.length / 1024)}KB)`);
      io.to(user.currentRoom).emit("chat_audio", {
        nonce: data.nonce,
        audio: data.audio,
        sender: socket.user.username,
        voice: data.voice,
      });
    });

    // ┌──────────────────────────────────────────┐
    // │ Voice STT (Speech-to-Text) Streaming    │
    // └──────────────────────────────────────────┘
    socket.on("voice_stt_start", async () => {
      // End any existing session
      const prev = (socket as any).__sttSession;
      if (prev) { prev.end(); delete (socket as any).__sttSession; }

      try {
        const { default: transcribeAdapter } = await import(
          "../../../../../core/adapters/transcribe"
        );

        const session = transcribeAdapter.startSession(
          {
            onTranscript: async (text: string) => {
              console.log(`[STT] ${socket.user?.username}: "${text}"`);
              const trimmed = text.trim();
              if (!trimmed) return;

              const user = connectedUsers.get(socket.id);
              if (!user?.currentRoom) return;
              const roomId = getRoomId(user.currentRoom);
              if (!roomId) return;

              // Get latest voice preference from DB each time
              const sttUser = await Data.user.findById(socket.user.id);
              const sttVoice = (sttUser?.voice_id && !["male", "female", "robot"].includes(sttUser.voice_id))
                ? sttUser.voice_id : "Joanna";

              const msgId = `stt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
              io.to(user.currentRoom).emit("chat_message", {
                id: msgId,
                sender: socket.user.username,
                text: trimmed,
                voice: sttVoice,
                timestamp: new Date().toISOString(),
              });

              // Persist to DB
              Data.message.create({
                content: trimmed,
                type: "voice",
                room_id: roomId,
                author_id: socket.user.id,
                username: socket.user.username,
              }).catch(console.error);

              // Generate TTS in background
              (async () => {
                try {
                  const { default: pollyAdapter } = await import("../../../../../core/adapters/polly");
                  let sentiment;
                  try {
                    const { default: comprehendAdapter } = await import("../../../../../core/adapters/comprehend");
                    sentiment = await comprehendAdapter.detectSentiment(trimmed);
                  } catch { /* optional */ }
                  const tts = await pollyAdapter.generateSpeechWithEmotion(trimmed, sttVoice, sentiment);
                  if (tts.audioBase64) {
                    io.to(user.currentRoom).emit("chat_audio", {
                      nonce: msgId,
                      audio: tts.audioBase64,
                      sender: socket.user.username,
                      voice: sttVoice,
                    });
                  }
                } catch (e) {
                  console.error(`[STT-TTS] ${socket.user?.username}:`, e);
                }
              })();

              // Track speech
              userLastSpoke.set(`${roomId}:${socket.user.id}`, Date.now());

              // Debounced agent trigger — wait 3s for user to finish their thought
              // If another transcript arrives within 3s, reset the timer
              const prevTimer = (socket as any).__sttAgentTimer;
              if (prevTimer) clearTimeout(prevTimer);

              (socket as any).__sttAgentTimer = setTimeout(async () => {
                delete (socket as any).__sttAgentTimer;
                try {
                  const currentUser = connectedUsers.get(socket.id);
                  if (!currentUser?.currentRoom) return;
                  const currentRoomId = getRoomId(currentUser.currentRoom);
                  if (!currentRoomId) return;

                  // Gather all recent STT messages from this user in the last 5s to check for mentions
                  const recentMessages = await Data.message.findRecent(currentRoomId, 5);
                  const recentUserText = recentMessages
                    .filter((m: { author_id: string | null }) => m.author_id === socket.user.id)
                    .map((m: { content: string }) => m.content)
                    .join(" ")
                    .toLowerCase();

                  const agents = await Data.llmAgent.findByRoom(currentRoomId);
                  let agentMentioned = false;
                  for (const agent of agents) {
                    const names = [agent.name.toLowerCase()];
                    if (agent.nicknames) {
                      try {
                        const parsed = JSON.parse(agent.nicknames) as string[];
                        names.push(...parsed.map((n: string) => n.toLowerCase()));
                      } catch { /* ignore */ }
                    }
                    if (names.some((n) => recentUserText.includes(n))) {
                      await runAgentResponse(io, agent, currentUser.currentRoom);
                      agentMentioned = true;
                      break;
                    }
                  }
                  if (!agentMentioned && agents.length === 1) {
                    const roomEntry = activeRooms.get(currentUser.currentRoom);
                    if (roomEntry) {
                      const humanUsers = new Set<string>();
                      for (const sid of roomEntry.users) {
                        const u = connectedUsers.get(sid);
                        if (u) humanUsers.add(u.userId);
                      }
                      if (humanUsers.size <= 1) {
                        await runAgentResponse(io, agents[0], currentUser.currentRoom);
                      }
                    }
                  }
                } catch (err) {
                  console.error("[STT] Agent trigger error:", err);
                }
              }, 3000);
            },
            onPartial: (text: string) => {
              socket.emit("voice_stt_partial", { text });
            },
            onError: (err: Error) => {
              console.error(`[STT] Stream error for ${socket.user?.username}:`, err.message);
            },
          },
        );

        (socket as any).__sttSession = session;
        console.log(`[STT] ${socket.user?.username} started streaming session`);
      } catch (err) {
        console.error(`[STT] Failed to start session for ${socket.user?.username}:`, err);
      }
    });

    socket.on("voice_stt_chunk", (data: ArrayBuffer | Buffer) => {
      const session = (socket as any).__sttSession;
      if (session) {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        session.pushChunk(buf);
      }
    });

    socket.on("voice_stt_stop", () => {
      const session = (socket as any).__sttSession;
      if (session) {
        session.end();
        delete (socket as any).__sttSession;
        console.log(`[STT] ${socket.user?.username} ended streaming session`);
      }
      // Don't clear the agent timer on stop — let it fire so the last sentence triggers the agent
    });

    // ┌──────────────────────────────────────────┐
    // │ Disconnect                              │
    // └──────────────────────────────────────────┘
    socket.on("disconnect", () => {
      // Clean up STT session on disconnect
      const sttSession = (socket as any).__sttSession;
      if (sttSession) { sttSession.end(); delete (socket as any).__sttSession; }

      console.log(`User disconnected: ${socket.user.username} (${socket.id})`);
      // Save last room before leaving
      const disconnectingUser = connectedUsers.get(socket.id);
      if (disconnectingUser?.currentRoom) {
        const lastRoomId = getRoomId(disconnectingUser.currentRoom);
        if (lastRoomId) {
          Data.user
            .updateLastRoom(socket.user.id, lastRoomId)
            .catch(console.error);
        }
      }
      leaveCurrentRoom(socket);
      connectedUsers.delete(socket.id);

      // Set any machines connected via this socket to offline, then notify owner's browsers
      Data.machine
        .setOfflineBySocketId(socket.id)
        .then(async () => {
          const updatedMachines = await Data.machine.findByOwner(
            socket.user.id,
          );
          for (const [sid, userData] of connectedUsers.entries()) {
            if (userData.userId === socket.user.id) {
              const browserSocket = io.sockets.sockets.get(sid);
              if (browserSocket) {
                browserSocket.emit("machines_list", {
                  machines: updatedMachines,
                });
              }
            }
          }
        })
        .catch(console.error);

      io.emit("roster_update", Array.from(connectedUsers.values()));
      broadcastRoomListUpdate(io).catch(console.error);
    });
  });
};

export { registerSocketHandlers };
