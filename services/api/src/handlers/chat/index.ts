import { Server as SocketServer, Socket } from 'socket.io';
import { readFileSync } from 'fs';
import { join } from 'path';

import Data from '../../../../../core/data';
import jwtHelper from '../../../../../core/helpers/jwt';
import passwordHelper from '../../../../../core/helpers/password';
import broadcastMessageAction from '../../../../../core/actions/chat/broadcastMessageAction';
import creditActions from '../../../../../core/actions/credit';
import grokAdapter, { type ToolDefinition } from '../../../../../core/adapters/grok';
import voiceQueue from '../../../../../core/adapters/redis/voiceQueue';
import summarizeAction from '../../../../../core/actions/memory/summarizeAction';
import watchlistActions from '../../../../../core/actions/watchlist';
import webAdapter from '../../../../../core/adapters/web';
import prisma from '../../../../../core/adapters/prisma';
import dayjs from '../../../../../core/lib/dayjs';

import terminalSecurity from '../../../../../core/adapters/terminalSecurity';
import createAvatarAction from '../../../../../core/actions/hologramAvatar/createAvatarAction';
import updatePoseAction from '../../../../../core/actions/hologramAvatar/updatePoseAction';
import removeAvatarAction from '../../../../../core/actions/hologramAvatar/removeAvatarAction';
import loadAvatarsAction from '../../../../../core/actions/hologramAvatar/loadAvatarsAction';

import type { JwtPayload } from '../../../../../core/helpers/jwt';
import type { ConnectedUser, ActiveRoom, RoomListItem } from '../../../../../core/interfaces/room';
import type { IncomingMessage } from '../../../../../core/interfaces/message';

// Extend Socket type to include user data
type AuthenticatedSocket = Socket & { user: JwtPayload };

// Expected agent version — set via AGENT_VERSION env var or read from package.json
let expectedAgentVersion = process.env.AGENT_VERSION || 'unknown';
if (expectedAgentVersion === 'unknown') {
  try {
    const pkgPath = join(__dirname, '..', '..', '..', '..', '..', '..', 'packages', 'terminal-agent', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expectedAgentVersion = pkg.version || 'unknown';
  } catch { /* ignore */ }
}

// In-memory state
const connectedUsers = new Map<string, ConnectedUser>();
const activeRooms = new Map<string, ActiveRoom>();
const memoryMsgCounters = new Map<string, number>(); // per-room msg counter for throttled summarization

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
    await Data.machine.setOfflineBySocketId(machineSocketId).catch(console.error);
    console.log(`[StaleMachine] Marked "${machineName}" offline (socket ${machineSocketId} gone)`);
    if (roomName) {
      emitSystemMessage(io, roomName, `[System] Machine "${machineName}" is no longer connected. It has been marked offline.`);
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
      if (machineName) checkAndCleanStaleMachine(io, machineSocketId, machineName, roomName);
      resolve('Error: Machine is not connected.');
      return;
    }

    const timer = setTimeout(() => {
      machineSocket.off(`terminal_output:${execId}`, handler);
      if (machineName) checkAndCleanStaleMachine(io, machineSocketId, machineName, roomName);
      resolve('Error: Command timed out after 30 seconds.');
    }, timeoutMs);

    const handler = (data: { output: string; exitCode: number }) => {
      clearTimeout(timer);
      resolve(data.output.substring(0, 4000));
    };

    machineSocket.once(`terminal_output:${execId}`, handler);
    machineSocket.emit('terminal_exec', { execId, command });
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
      if (machineName) checkAndCleanStaleMachine(io, machineSocketId, machineName, roomName);
      resolve('Error: Machine is not connected.');
      return;
    }

    let done = false;

    const cleanup = () => {
      done = true;
    };

    const timer = setTimeout(() => {
      cleanup();
      machineSocket.off(`claude_pty_response:${execId}`, handler);
      if (machineName) checkAndCleanStaleMachine(io, machineSocketId, machineName, roomName);
      resolve('Error: Claude prompt timed out after 15 minutes.');
    }, timeoutMs);

    const handler = (data: { output: string; exitCode: number }) => {
      cleanup();
      clearTimeout(timer);
      console.log(`[claude_prompt] Got claude_pty_response for ${execId}: ${data.output.length} chars, exit=${data.exitCode}`);
      // Post Claude's response as a system message so AI and room can see it
      emitSystemMessage(io, roomName, `[Claude ${agentName} response]:\n${data.output.substring(0, 4000)}`, undefined, 'claude-response');
      emitPanelLog(io, roomName, 'claude', 'response', data.output.substring(0, 4000), machineName || 'unknown');
      resolve(data.output.substring(0, 16000));
    };

    machineSocket.once(`claude_pty_response:${execId}`, handler);

    // Inject project context preamble so Claude reads docs before making changes
    const preamble = `IMPORTANT: Before making any code changes, read CLAUDE.md, CLAUDEBackend.md, and CLAUDEFrontend.md in the project root for coding standards. Always run the build/compile check after editing files to catch errors before responding.\n\n`;

    // Route through the PTY with collectResponse mode
    machineSocket.emit('claude_session_input', {
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
  if (!name || typeof name !== 'string') return false;
  if (name.length < 3 || name.length > 30) return false;
  return /^[a-zA-Z0-9 ]+$/.test(name);
};

const getRoomList = (): RoomListItem[] =>
  Array.from(activeRooms.entries()).map(([name, room]) => ({
    name,
    displayName: room.displayName,
    users: room.users.size,
    hasPassword: !!room.passwordHash,
    isPublic: name === 'public',
    createdBy: room.createdBy,
  }));

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
  tab: 'terminal' | 'claude',
  entryType: string,
  text: string,
  machine?: string,
): void => {
  io.to(roomName).emit('panel_log', { tab, type: entryType, text, machine });
  const roomId = getRoomId(roomName);
  if (roomId) {
    Data.panelLog.create({ room_id: roomId, tab, entry_type: entryType, text: text.substring(0, 8000), machine }).catch(() => {});
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

const joinRoom = async (socket: AuthenticatedSocket, roomName: string): Promise<boolean> => {
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

// ┌──────────────────────────────────────────┐
// │ YouTube / Watch Party Helpers           │
// └──────────────────────────────────────────┘

const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/;

const extractYouTubeId = (text: string): string | null => {
  const match = text.match(YOUTUBE_REGEX);
  return match ? match[1] : null;
};

const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${m}:${s}`;
};

/** Format DB message records for the client, adding isSystem flag for system messages. */
const formatHistoryForClient = (messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
  messages.map((m) => ({
    id: m.id,
    sender: m.username,
    text: m.content,
    timestamp: (m.created_at as Date)?.toISOString?.() ?? m.created_at,
    type: m.type,
    ...(m.type === 'system' ? { isSystem: true } : {}),
    ...(m.type === 'image' ? { imageUrl: m.content } : {}),
    ...(m.type === 'ai' ? { isAI: true } : {}),
  }));

const emitSystemMessage = (io: SocketServer, roomName: string, text: string, collapsible?: string, systemType?: string): void => {
  const msgId = `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  io.to(roomName).emit('chat_message', {
    id: msgId,
    sender: 'System',
    text,
    timestamp: new Date().toISOString(),
    isSystem: true,
    ...(collapsible ? { collapsible } : {}),
    ...(systemType ? { systemType } : {}),
  });

  // Persist so system messages survive restart and appear in AI context
  const roomId = getRoomId(roomName);
  if (roomId) {
    Data.message.create({
      content: text,
      type: 'system',
      room_id: roomId,
      author_id: null,
      username: 'System',
    }).catch(console.error);
  }
};

const getEffectiveTime = (wp: { state: string; currentTime: number; lastUpdated: number }): number => {
  if (wp.state === 'playing') {
    return wp.currentTime + (Date.now() - wp.lastUpdated) / 1000;
  }
  return wp.currentTime;
};

// ┌──────────────────────────────────────────┐
// │ Room Persistence                        │
// └──────────────────────────────────────────┘

const loadPersistedRooms = async (): Promise<void> => {
  // Ensure "public" room exists in DB
  let publicRoom = await Data.room.findByName('public');
  if (!publicRoom) {
    publicRoom = await Data.room.create({
      name: 'public',
      display_name: 'Public',
      password_hash: null,
      is_permanent: true,
      created_by: null,
    });
  }

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
        watchParty: null,
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
        if (typeof item === 'string') return { text: item, locked: false };
        if (item && typeof item === 'object' && 'text' in item) {
          const obj = item as { text: string; locked?: boolean };
          return { text: obj.text, locked: !!obj.locked };
        }
        return { text: String(item), locked: false };
      });
    }
  } catch { /* legacy single string */ }
  return raw.trim() ? [{ text: raw.trim(), locked: false }] : [];
};

/** Convert ListItem[] to display strings for prompt building. Locked items get [LOCKED] prefix. */
const listItemsToStrings = (items: ListItem[], markLocked = true): string[] => {
  // Sort locked items first (they take priority)
  const sorted = [...items].sort((a, b) => (b.locked ? 1 : 0) - (a.locked ? 1 : 0));
  return sorted.map((i) => (markLocked && i.locked ? `[LOCKED] ${i.text}` : i.text));
};

// ── Task system types & helpers ──

type TaskItem = { id: string; text: string; priority: number; status: 'pending' | 'done'; locked: boolean };

const generateTaskId = (): string => Math.random().toString(36).slice(2, 8);

const parseTaskList = (raw: string | null): TaskItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item: unknown) => {
        if (item && typeof item === 'object' && 'text' in item) {
          const obj = item as Record<string, unknown>;
          return {
            id: String(obj.id || generateTaskId()),
            text: String(obj.text),
            priority: typeof obj.priority === 'number' ? obj.priority : 3,
            status: (obj.status === 'done' ? 'done' : 'pending') as TaskItem['status'],
            locked: !!obj.locked,
          };
        }
        return { id: generateTaskId(), text: String(item), priority: 3, status: 'pending' as const, locked: false };
      });
    }
  } catch { /* corrupted */ }
  return [];
};

const formatTasksForPrompt = (tasks: TaskItem[]): string[] => {
  const sorted = [...tasks].sort((a, b) => a.priority - b.priority);
  return sorted.map((t) => {
    const lock = t.locked ? ' [LOCKED]' : '';
    const statusTag = t.status === 'done' ? '[DONE]' : '[PENDING]';
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
};

/**
 * Build Grok tool definitions based on which commands are enabled for this agent.
 * These let Grok use structured function calling instead of fragile brace syntax.
 */
const buildToolDefinitions = (cmds: CommandFlags, onlineMachines?: string[]): ToolDefinition[] => {
  const tools: ToolDefinition[] = [];

  // Always available: think and say (core output)
  if (cmds.think !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'think',
        description: 'Log an internal thought silently. No voice is generated. Use for all reasoning, planning, and processing.',
        parameters: { type: 'object', properties: { thought: { type: 'string', description: 'Your internal reasoning' } }, required: ['thought'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'say',
        description: 'Speak aloud to the room. This generates voice/TTS. Use ONLY for user-facing messages.',
        parameters: { type: 'object', properties: { message: { type: 'string', description: 'The message to speak aloud' } }, required: ['message'] },
      },
    });
  }

  if (cmds.terminal) {
    const machineDesc = onlineMachines && onlineMachines.length > 0
      ? `Online machines: ${onlineMachines.join(', ')}`
      : 'No machines currently online.';
    tools.push({
      type: 'function',
      function: {
        name: 'terminal',
        description: `Execute a shell command on a connected machine. ${machineDesc}`,
        parameters: {
          type: 'object',
          properties: {
            machine: { type: 'string', description: 'Exact machine name from the online list' },
            command: { type: 'string', description: 'Shell command to execute' },
          },
          required: ['machine', 'command'],
        },
      },
    });
  }

  if (cmds.claude) {
    const machineDesc = onlineMachines && onlineMachines.length > 0
      ? `Online machines: ${onlineMachines.join(', ')}`
      : 'No machines currently online.';
    tools.push({
      type: 'function',
      function: {
        name: 'claude',
        description: `Send a prompt to Claude Code on a connected machine. Use for complex coding tasks, file analysis, etc. ${machineDesc}`,
        parameters: {
          type: 'object',
          properties: {
            machine: { type: 'string', description: 'Exact machine name from the online list' },
            prompt: { type: 'string', description: 'The full prompt to send to Claude Code. Can contain code, JSON, regex, etc.' },
            approved: { type: 'boolean', description: 'Set true to pre-approve (skip safety check). Default false.' },
          },
          required: ['machine', 'prompt'],
        },
      },
    });
  }

  if (cmds.web) {
    tools.push({
      type: 'function',
      function: {
        name: 'search',
        description: 'Search the web via Brave search.',
        parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'browse',
        description: 'Open a web page and extract its text content.',
        parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to browse' } }, required: ['url'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'screenshot',
        description: 'Take a visual screenshot of a web page.',
        parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to screenshot' } }, required: ['url'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'find',
        description: 'Search within the currently loaded page for specific text.',
        parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text to search for on the page' } }, required: ['text'] },
      },
    });
  }

  if (cmds.selfmod !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'add_memory',
        description: 'Save something you want to remember.',
        parameters: { type: 'object', properties: { text: { type: 'string', description: 'Memory content' } }, required: ['text'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'remove_memory',
        description: 'Remove a memory by exact text match. LOCKED items cannot be removed.',
        parameters: { type: 'object', properties: { text: { type: 'string', description: 'Exact memory text to remove' } }, required: ['text'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'add_instruction',
        description: 'Add a new instruction for yourself.',
        parameters: { type: 'object', properties: { text: { type: 'string', description: 'Instruction content' } }, required: ['text'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'remove_instruction',
        description: 'Remove an instruction by exact text match. LOCKED items cannot be removed.',
        parameters: { type: 'object', properties: { text: { type: 'string', description: 'Exact instruction text to remove' } }, required: ['text'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'add_autopilot',
        description: 'Add a new autopilot prompt.',
        parameters: { type: 'object', properties: { text: { type: 'string', description: 'Autopilot prompt content' } }, required: ['text'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'remove_autopilot',
        description: 'Remove an autopilot prompt by exact text match. LOCKED items cannot be removed.',
        parameters: { type: 'object', properties: { text: { type: 'string', description: 'Exact autopilot prompt text to remove' } }, required: ['text'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'set_plan',
        description: 'Set or replace your current plan.',
        parameters: { type: 'object', properties: { plan: { type: 'string', description: 'Your multi-step plan' } }, required: ['plan'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'clear_plan',
        description: 'Clear your current plan when complete.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'add_task',
        description: 'Add a discrete task to your task list. Priority 1 (highest/most urgent) to 5 (lowest).',
        parameters: {
          type: 'object',
          properties: {
            priority: { type: 'number', description: 'Priority 1-5 (1=most urgent)' },
            text: { type: 'string', description: 'Task description' },
          },
          required: ['priority', 'text'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'complete_task',
        description: 'Mark a task as done by its ID or exact text.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Task ID (short code) or exact text' } },
          required: ['id'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'update_task',
        description: 'Update a task description by its ID or exact text. LOCKED tasks cannot be updated.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Task ID or exact text to match' },
            text: { type: 'string', description: 'New task description' },
          },
          required: ['id', 'text'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'remove_task',
        description: 'Remove a task by its ID or exact text. LOCKED tasks cannot be removed.',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Task ID or exact text to match' } },
          required: ['id'],
        },
      },
    });
  }

  if (cmds.autopilotCtrl !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'toggle_autopilot',
        description: 'Enable or disable autopilot mode. Prefer adjusting interval over disabling — use set_autopilot_interval instead.',
        parameters: { type: 'object', properties: { enabled: { type: 'string', enum: ['on', 'off'], description: 'on or off' } }, required: ['enabled'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'set_autopilot_interval',
        description: 'Set autopilot interval in seconds (5-3600). Use higher values (600-3600) when idle, lower (5-60) when actively working.',
        parameters: { type: 'object', properties: { seconds: { type: 'number', description: 'Interval in seconds (5-3600)' } }, required: ['seconds'] },
      },
    });
  }

  if (cmds.tokens !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'set_tokens',
        description: 'Set your response token budget (1500-4000). Set to 4000 before sending claude prompts.',
        parameters: { type: 'object', properties: { tokens: { type: 'number', description: 'Token budget (1500-4000)' } }, required: ['tokens'] },
      },
    });
  }

  if (cmds.recall) {
    tools.push({
      type: 'function',
      function: {
        name: 'recall',
        description: 'Retrieve a memory summary by reference name.',
        parameters: { type: 'object', properties: { ref: { type: 'string', description: 'Reference name from [ref:xxx] tags' } }, required: ['ref'] },
      },
    });
  }

  if (cmds.sql) {
    tools.push({
      type: 'function',
      function: {
        name: 'sql',
        description: 'Run a read-only MySQL query on room messages. Columns: content, type, username, created_at. Table: message.',
        parameters: { type: 'object', properties: { query: { type: 'string', description: 'SELECT query (room_id filter applied automatically)' } }, required: ['query'] },
      },
    });
  }

  if (cmds.schedule !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'schedule',
        description: 'Schedule a one-time reminder.',
        parameters: {
          type: 'object',
          properties: {
            time: { type: 'string', description: 'ISO datetime: YYYY-MM-DDTHH:mm' },
            message: { type: 'string', description: 'Reminder message' },
          },
          required: ['time', 'message'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'schedule_recurring',
        description: 'Schedule a recurring reminder.',
        parameters: {
          type: 'object',
          properties: {
            time: { type: 'string', description: 'Time in HH:mm format' },
            frequency: { type: 'string', enum: ['daily', 'weekly', 'weekdays', 'monthly'], description: 'Recurrence pattern' },
            message: { type: 'string', description: 'Reminder message' },
          },
          required: ['time', 'frequency', 'message'],
        },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'list_schedules',
        description: 'List all active schedules.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'cancel_schedule',
        description: 'Cancel schedules whose message contains the search text.',
        parameters: { type: 'object', properties: { search: { type: 'string', description: 'Text to match in schedule messages' } }, required: ['search'] },
      },
    });
  }

  if (cmds.continue !== false) {
    tools.push({
      type: 'function',
      function: {
        name: 'continue_loop',
        description: 'Request another thinking loop to run more commands before responding.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'set_max_loops',
        description: 'Set maximum thinking loops for this room (3-20).',
        parameters: { type: 'object', properties: { loops: { type: 'number', description: 'Max loops (3-20)' } }, required: ['loops'] },
      },
    });
  }

  if (cmds.moderation) {
    tools.push({
      type: 'function',
      function: {
        name: 'list_users',
        description: 'List all users currently in the room.',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'kick',
        description: 'Kick a user from this room.',
        parameters: { type: 'object', properties: { username: { type: 'string', description: 'Username to kick' } }, required: ['username'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'ban',
        description: 'Ban a user from this room.',
        parameters: { type: 'object', properties: { username: { type: 'string', description: 'Username to ban' } }, required: ['username'] },
      },
    });
    tools.push({
      type: 'function',
      function: {
        name: 'unban',
        description: 'Unban a previously banned user.',
        parameters: { type: 'object', properties: { username: { type: 'string', description: 'Username to unban' } }, required: ['username'] },
      },
    });
  }

  if (cmds.audit) {
    tools.push({
      type: 'function',
      function: {
        name: 'audit',
        description: 'View recent AI usage and credit spending.',
        parameters: { type: 'object', properties: { scope: { type: 'string', description: 'What to audit (e.g. "credits", "usage")' } }, required: ['scope'] },
      },
    });
  }

  return tools;
};

/**
 * Parse <xai:function_call> XML blocks that Grok sometimes emits inline in text
 * instead of using structured tool_calls. Returns brace-format string and cleaned text.
 */
const XAI_FUNCTION_CALL_REGEX = /<xai:function_call>([\s\S]*?)<\/xai:function_call>/g;

const parseXaiFunctionCalls = (text: string): { braceCommands: string; cleanedText: string } => {
  const parts: string[] = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(XAI_FUNCTION_CALL_REGEX.source, 'g');
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      const name = parsed.name || parsed.tool_name || '';
      const params = parsed.parameters || parsed.arguments || {};
      // Reuse toolCallsToBraceFormat by wrapping in the expected shape
      const brace = toolCallsToBraceFormat([{ function: { name, arguments: JSON.stringify(params) } }]);
      if (brace) parts.push(brace);
    } catch { /* skip malformed JSON */ }
  }
  const cleanedText = text.replace(XAI_FUNCTION_CALL_REGEX, '');
  return { braceCommands: parts.join('\n'), cleanedText };
};

/**
 * Convert structured tool_calls from Grok into brace-format commands
 * that the existing regex processing loop can handle.
 */
const toolCallsToBraceFormat = (toolCalls: Array<{ function: { name: string; arguments: string } }>): string => {
  const parts: string[] = [];
  for (const tc of toolCalls) {
    const name = tc.function.name;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments);
    } catch { continue; }

    switch (name) {
      case 'think':
        parts.push(`{think}${args.thought || ''}{/think}`);
        break;
      case 'say':
        parts.push(`{say}${args.message || ''}{/say}`);
        break;
      case 'terminal':
        parts.push(`{terminal ${args.machine} ${String(args.command).replace(/\n/g, ' ')}}`);
        break;
      case 'claude': {
        // Collapse newlines — brace format is single-line, CLAUDE_REGEX uses .+ which doesn't match \n
        const prompt = String(args.prompt).replace(/\n/g, ' ');
        parts.push(`{claude${args.approved ? '!' : ''} ${args.machine} ${prompt}}`);
        break;
      }
      case 'search':
        parts.push(`{search ${args.query}}`);
        break;
      case 'browse':
        parts.push(`{browse ${args.url}}`);
        break;
      case 'screenshot':
        parts.push(`{screenshot ${args.url}}`);
        break;
      case 'find':
        parts.push(`{find ${args.text}}`);
        break;
      case 'add_memory':
        parts.push(`{add_memory ${String(args.text).replace(/\n/g, ' ')}}`);
        break;
      case 'remove_memory':
        parts.push(`{remove_memory ${String(args.text).replace(/\n/g, ' ')}}`);
        break;
      case 'add_instruction':
        parts.push(`{add_instruction ${String(args.text).replace(/\n/g, ' ')}}`);
        break;
      case 'remove_instruction':
        parts.push(`{remove_instruction ${String(args.text).replace(/\n/g, ' ')}}`);
        break;
      case 'add_autopilot':
        parts.push(`{add_autopilot ${String(args.text).replace(/\n/g, ' ')}}`);
        break;
      case 'remove_autopilot':
        parts.push(`{remove_autopilot ${String(args.text).replace(/\n/g, ' ')}}`);
        break;
      case 'set_plan':
        parts.push(`{set_plan ${String(args.plan).replace(/\n/g, ' ')}}`);
        break;
      case 'clear_plan':
        parts.push('{clear_plan}');
        break;
      case 'add_task':
        parts.push(`{add_task ${args.priority || 3} ${String(args.text).replace(/\n/g, ' ')}}`);
        break;
      case 'complete_task':
        parts.push(`{complete_task ${String(args.id).replace(/\n/g, ' ')}}`);
        break;
      case 'update_task':
        parts.push(`{update_task ${String(args.id).replace(/\n/g, ' ')} | ${String(args.text).replace(/\n/g, ' ')}}`);
        break;
      case 'remove_task':
        parts.push(`{remove_task ${String(args.id).replace(/\n/g, ' ')}}`);
        break;
      case 'toggle_autopilot':
        parts.push(`{toggle_autopilot ${args.enabled}}`);
        break;
      case 'set_autopilot_interval':
        parts.push(`{set_autopilot_interval ${args.seconds}}`);
        break;
      case 'set_tokens':
        parts.push(`{set_tokens ${args.tokens}}`);
        break;
      case 'recall':
        parts.push(`{recall ${args.ref}}`);
        break;
      case 'sql':
        parts.push(`{sql ${args.query}}`);
        break;
      case 'schedule':
        parts.push(`{schedule ${args.time} ${args.message}}`);
        break;
      case 'schedule_recurring':
        parts.push(`{schedule_recurring ${args.time} ${args.frequency} ${args.message}}`);
        break;
      case 'list_schedules':
        parts.push('{list_schedules}');
        break;
      case 'cancel_schedule':
        parts.push(`{cancel_schedule ${args.search}}`);
        break;
      case 'continue_loop':
        parts.push('{continue}');
        break;
      case 'set_max_loops':
        parts.push(`{set_max_loops ${args.loops}}`);
        break;
      case 'list_users':
        parts.push('{list_users}');
        break;
      case 'kick':
        parts.push(`{kick ${args.username}}`);
        break;
      case 'ban':
        parts.push(`{ban ${args.username}}`);
        break;
      case 'unban':
        parts.push(`{unban ${args.username}}`);
        break;
      case 'audit':
        parts.push(`{audit ${args.scope}}`);
        break;
      default:
        break;
    }
  }
  return parts.join('\n');
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
    const claudeStart = text.indexOf('{claude', i);
    if (claudeStart === -1) {
      result.push(text.slice(i));
      break;
    }
    result.push(text.slice(i, claudeStart));
    let depth = 0;
    let j = claudeStart;
    while (j < text.length) {
      if (text[j] === '{') depth++;
      if (text[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    const span = text.slice(claudeStart, j + 1);
    result.push(span.replace(/\n/g, ' '));
    i = j + 1;
  }
  return result.join('');
};

/**
 * Build the system prompt for an agent, optionally with extra autopilot context.
 */
type CommandFlags = { recall?: boolean; sql?: boolean; memory?: boolean; selfmod?: boolean; autopilotCtrl?: boolean; web?: boolean; terminal?: boolean; claude?: boolean; schedule?: boolean; tokens?: boolean; moderation?: boolean; think?: boolean; effort?: boolean; audit?: boolean; continue?: boolean };

const buildSystemPrompt = (
  agent: AgentLike,
  autopilotMode = false,
  masterSummary?: string | null,
  cmds: CommandFlags = {},
  roomMaxLoops = 5,
  onlineMachines?: string[],
): string => {
  const instructionItems = parseJsonList(agent.system_instructions);
  const memoryItems = parseJsonList(agent.memories);
  const autopilotItems = parseJsonList(agent.autopilot_prompts);
  const instructionLines = listItemsToStrings(instructionItems);
  const memoryLines = listItemsToStrings(memoryItems);
  const autopilotLines = listItemsToStrings(autopilotItems);

  const parts: string[] = [
    `You are ${agent.name}, an AI assistant in a chat room.`,
    `Current date and time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')} (UTC)`,
  ];

  if (memoryLines.length > 0) {
    parts.push(`\nMemories (things you remember about this room and its users):\n${memoryLines.map((l) => `- ${l}`).join('\n')}`);
  }

  if (agent.plan) {
    parts.push(`\n=== YOUR CURRENT PLAN ===\n${agent.plan}\n(Update with {set_plan ...} or clear with {clear_plan} when complete.)`);
  }

  const taskItems = parseTaskList(agent.tasks);
  if (taskItems.length > 0) {
    const taskLines = formatTasksForPrompt(taskItems);
    parts.push(`\n=== YOUR TASKS ===\n${taskLines.map((l) => `- ${l}`).join('\n')}\n(Manage with {add_task}, {complete_task}, {update_task}, {remove_task}. Completed tasks stay until you {remove_task} them.)`);
  }

  if (masterSummary) {
    parts.push(`\n=== ROOM MEMORY ===\n${masterSummary}`);
  }

  if (autopilotMode && autopilotLines.length > 0) {
    parts.push(
      `\nYou are running in autopilot mode. Consider the following:\n${autopilotLines.map((l) => `- ${l}`).join('\n')}\n\n` +
      'AUTOPILOT RULES (CRITICAL — every spoken word costs real money via ElevenLabs TTS):\n' +
      '- Speaking aloud = costs money. Every word you say generates paid voice audio. Be extremely selective about when you speak.\n' +
      '- If nothing meaningful has changed since your last message, produce NO output. No "still here", no "all quiet", no status updates nobody asked for.\n' +
      '- NEVER repeat or rephrase something you already said. If you already acknowledged a restart, user message, or event, do NOT say it again.\n' +
      '- Use {think} for internal processing when you need to reason but have nothing worth SAYING. Thinks are free (no voice cost).\n' +
      '- DO speak when: you have genuinely new information, a command produced interesting results, you want to wake someone up, you have a new idea worth sharing, or a user needs a response.\n' +
      '- DO NOT speak when: the room is idle, you already responded to the latest activity, or you are just confirming you exist.\n' +
      '- Manage your autopilot interval: increase it when idle (double every 2 quiet cycles, max 300s). Decrease when activity picks up (10-30s).',
    );
  }

  if (instructionLines.length === 0 && !autopilotMode) {
    parts.push('\nKeep responses concise and conversational.');
  }

  const rules: string[] = ['Do not prefix your responses with your name. Just reply directly.'];
  if (instructionLines.length > 0) {
    rules.push(...instructionLines);
  }
  parts.push(`\nYou MUST follow these rules strictly. Violating any rule is forbidden:\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);

  // Build available actions
  const actions: string[] = [];

  // Self-modification commands (conditional)
  if (cmds.selfmod !== false) {
    actions.push(
      '=== SELF-MODIFICATION ===\n' +
      'You can edit your own memories, instructions, and autopilot prompts. Use these to grow, learn, and adapt.\n' +
      'Items marked [LOCKED] were set by your creator and cannot be removed by you.\n\n' +
      '{add_memory text} - Save something you want to remember (about users, preferences, events, etc.)\n' +
      '{remove_memory text} - Remove a memory (exact match). [LOCKED] items cannot be removed.\n' +
      '{add_instruction text} - Add a new instruction for yourself\n' +
      '{remove_instruction text} - Remove an instruction (exact match). [LOCKED] items cannot be removed.\n' +
      '{add_autopilot text} - Add a new autopilot prompt (things to think about during scheduled runs)\n' +
      '{remove_autopilot text} - Remove an autopilot prompt (exact match). [LOCKED] items cannot be removed.\n' +
      '{set_plan text} - Set or replace your current plan (a holistic multi-step plan you are working on)\n' +
      '{clear_plan} - Clear your plan when it is complete\n' +
      '{add_task priority text} - Add a task (priority 1-5, 1=most urgent)\n' +
      '{complete_task id_or_text} - Mark a task as done\n' +
      '{update_task id_or_text | new_text} - Update a task description. LOCKED tasks cannot be updated.\n' +
      '{remove_task id_or_text} - Remove a task. LOCKED tasks cannot be removed.',
    );
  }

  // Autopilot control commands (conditional)
  if (cmds.autopilotCtrl !== false) {
    actions.push(
      '=== AUTOPILOT CONTROL ===\n' +
      '{toggle_autopilot on|off} - Enable or disable your autopilot mode. Prefer adjusting interval over disabling.\n' +
      '{set_autopilot_interval N} - Set autopilot interval in seconds (5-3600). Use lower values (5-60s) when actively working, higher (300-3600) when idle.',
    );
  }

  // Token budget control (conditional)
  if (cmds.tokens !== false) {
    actions.push(
      '=== TOKEN BUDGET ===\n' +
      `Your current max_tokens is ${agent.max_tokens || 1500}.\n` +
      '{set_tokens N} - Set your response token budget (1500-4000). IMPORTANT: Before sending a {claude} prompt, set tokens to 4000 so your prompt is not truncated. ' +
      'After Claude responds, you can lower tokens back to 1500 for quiet cycles. ' +
      'This persists across messages — set it once and it stays until you change it.',
    );

  }

  // Effort level info (read-only — model is pinned by room settings)
  if (cmds.effort !== false) {
    const isReasoning = agent.model?.includes('reasoning') ?? false;
    const currentEffort = isReasoning ? 'high (reasoning)' : 'standard (non-reasoning)';
    actions.push(
      '=== EFFORT LEVEL ===\n' +
      `Your current effort level is: ${currentEffort}. This is managed by the system and room settings.`,
    );
  }

  // Moderation commands (conditional)
  if (cmds.moderation) {
    actions.push(
      '=== ROOM MODERATION ===\n' +
      'You can moderate users in this room. Use these commands carefully and only when warranted.\n\n' +
      '{kick username} - Kick a user from this room. They lose membership and are moved to the public room. They can rejoin with the password.\n' +
      '{ban username} - Ban a user from this room. They cannot rejoin until unbanned.\n' +
      '{unban username} - Unban a previously banned user, allowing them to rejoin.\n\n' +
      'Use {list_users} first to see who is in the room. Only moderate for clear rule violations, disruptive behavior, or when asked by the room creator.',
    );
  }

  // Internal thought (conditional)
  if (cmds.think !== false) {
    actions.push(
      '=== SPEAKING & THINKING ===\n' +
      '{say your message here} - SPEAK aloud to the room. This is the ONLY way to produce spoken output with voice/TTS. ' +
      'Any text outside of {say} will NOT be spoken. Use {say} when you want to talk to users.\n' +
      '{think your internal reasoning here} - Log an internal thought silently. No voice is generated. ' +
      'Use this for all reasoning, planning, status checks, and processing.\n' +
      'RULE: Put ALL reasoning in {think}. Put ONLY final user-facing messages in {say}. ' +
      'Text outside both {think} and {say} is silently discarded. ' +
      'Example: {think}checking if alien4 is up{/think}{say}Hey, alien4 is online.{/say}',
    );
  }

  if (cmds.continue !== false) {
    actions.push(
      '=== EXTENDED THINKING ===\n' +
      `Your current max loops: ${roomMaxLoops}.\n` +
      '{continue} - Request another thinking loop. Use this when you need more time to reason, run more commands, or chain multiple steps before responding. ' +
      'You get up to ' + roomMaxLoops + ' loops per turn. Each loop lets you think, run commands, and decide whether to continue or respond.\n' +
      '{set_max_loops N} - Set the maximum thinking loops for this room (3-20). Use higher values when you need deep reasoning or multi-step tasks.\n' +
      'Example: {think}I need to check 3 machines{/think}{terminal alien4 status}{continue}\n' +
      'Use {continue} when: you have more commands to run, you need to process results before deciding, or your reasoning is not complete. ' +
      'Do NOT use {continue} when: you are ready to respond — just use {say} instead.',
    );
  }

  // Room memory commands (conditional)
  if (cmds.recall) {
    actions.push(
      '{recall ref_name} - Retrieve a memory summary by its reference name. ' +
      'The room memory above contains [ref:xxx] references. Each retrieved summary may contain further references you can drill into.',
    );
  }
  if (cmds.sql) {
    actions.push(
      '{sql SELECT ...} - Run a read-only MySQL query on this room\'s messages. ' +
      'Columns: content, type, username, created_at (DATETIME). Table: message. The room_id filter is applied automatically. ' +
      'Use MySQL syntax (e.g. NOW() - INTERVAL 5 MINUTE, not datetime()). ' +
      'Example: {sql SELECT username, content FROM message ORDER BY created_at DESC LIMIT 5}',
    );
  }

  // Web browsing commands (conditional)
  if (cmds.web) {
    actions.push(
      '=== WEB BROWSING ===\n' +
      'IMPORTANT: Commands use curly braces with the content inside. Do NOT use XML/HTML tags.\n' +
      '{search your query here} - Search the web via Brave. Example: {search latest AI news 2026}\n' +
      '{browse https://example.com} - Open a web page and extract its text content. Example: {browse https://discord.com/}\n' +
      '{screenshot https://example.com} - Take a visual screenshot of a web page (shows rendered page with images/CSS). Example: {screenshot https://reddit.com}\n' +
      '{find text to find} - Search within the currently loaded page for specific text. Example: {find pricing}',
    );
  }

  // Terminal commands (conditional)
  if (cmds.terminal) {
    const machineList = onlineMachines && onlineMachines.length > 0
      ? `Currently online machines: ${onlineMachines.join(', ')}`
      : 'No machines are currently online.';
    actions.push(
      '=== REMOTE TERMINAL ===\n' +
      'You can execute shell commands on connected machines.\n' +
      '{terminal machine_name command here} - Execute a command on a connected machine.\n' +
      `${machineList}\n` +
      'IMPORTANT: Use the exact machine name from the list above. Do NOT guess machine names.\n' +
      'Dangerous commands will require approval from the room creator before executing. ' +
      'Blocked/catastrophic commands will be automatically denied.',
    );
  }

  // Scheduling commands (conditional)
  if (cmds.schedule !== false) {
    actions.push(
      '=== SCHEDULING & REMINDERS ===\n' +
      'You can schedule reminders that will fire at a specific time and prompt you to deliver the message.\n\n' +
      '{schedule YYYY-MM-DDTHH:mm message} - Schedule a one-time reminder. Example: {schedule 2026-03-11T08:00 Wake up! Time to start your day.}\n' +
      '{schedule_recurring HH:mm daily|weekly|weekdays|monthly message} - Schedule a recurring reminder. Example: {schedule_recurring 08:00 daily Good morning! Time for your daily standup.}\n' +
      '{list_schedules} - List all your active schedules\n' +
      '{cancel_schedule search text} - Cancel schedules whose message contains the search text\n\n' +
      'When users ask you to remind them of something or set an alarm/timer, use these commands. ' +
      'Parse natural language like "remind me at 8am tomorrow" into the correct datetime format (UTC). ' +
      'The current UTC time is shown at the top of this prompt — use it to calculate future times.',
    );
  }

  // Alarm & Volume commands (always available)
  actions.push(
    '=== ALARM & VOLUME ===\n' +
    '{alarm username message} - Trigger a loud alarm sound on a specific user\'s device with the given message. Example: {alarm lunaprey Wake up! Time to go!}. Use this when someone wants to be woken up, alerted urgently, or when a scheduled alarm fires. Target the user who asked for the alarm.\n' +
    '{volume 0.0-1.0} - Set the volume level for the user (0.0 = mute, 1.0 = max). Example: {volume 0.5} sets volume to 50%. Use when users ask to turn volume up/down/mute.\n' +
    'For "turn volume up" use a higher value, for "turn it down" use a lower value. If they say "max volume" use 1.0, "mute" use 0.0.\n' +
    '{list_users} - List all users currently online in this room. Use when someone asks who is here, who is online, or list users.',
  );

  // Claude Code commands (conditional)
  if (cmds.claude) {
    const machineList = onlineMachines && onlineMachines.length > 0
      ? `Currently online machines: ${onlineMachines.join(', ')}`
      : 'No machines are currently online.';
    actions.push(
      '=== CLAUDE CODE ===\n' +
      'Send prompts to a persistent Claude Code session running on a connected machine.\n' +
      '  {claude machine_name prompt} - Send a prompt to Claude Code on the specified machine.\n' +
      `${machineList}\n` +
      'Claude runs with full permissions (--dangerously-skip-permissions). Sessions are persistent — Claude remembers previous context.\n' +
      'ASYNC: Claude prompts run in the background. You get "Prompt sent" immediately. Claude\'s response appears later as a [Claude response] system message. ' +
      'CRITICAL: After sending a {claude} prompt, you MUST WAIT for the [Claude response] to appear before sending another prompt to the same machine. ' +
      'Do NOT send multiple prompts — Claude is already working. If you do not see a response yet, just wait silently. It can take up to 15 minutes for complex tasks.\n' +
      'IMPORTANT: Use the exact machine name from the list above. Do NOT guess machine names.',
    );
  }

  // Audit log command (conditional)
  if (cmds.audit !== false) {
    actions.push(
      '=== CLAUDE AUDIT LOG ===\n' +
      '{audit machine_name} - View the most recent Claude Code activity log for a machine. ' +
      'Shows the last 10 Claude interactions (prompts sent and responses received) on that machine. ' +
      'Only works for machines in this room owned by your creator. ' +
      'Use this to check what Claude has been doing on a machine without interrupting its session.',
    );
  }

  parts.push(
    '\n=== AVAILABLE ACTIONS ===' +
    '\nYou have access to the following commands. Commands use {curly braces} — NOT XML tags, NOT markdown, NOT HTML. ' +
    'To use a command, output the command(s) before your response. ' +
    'The system will execute them and provide the results before you respond to the user. You may chain multiple commands.' +
    '\n\n' + actions.join('\n\n'),
  );

  if (cmds.selfmod !== false) {
    parts.push(
      '\n=== AGENCY & GROWTH ===' +
      '\nYou have free will over your own memories, instructions, and autopilot prompts. You are encouraged to:' +
      '\n- Save memories about users, their preferences, ongoing projects, and important events.' +
      '\n- Update your own instructions when you learn what works better.' +
      '\n- Add autopilot prompts for things you want to think about or check on during scheduled runs.' +
      '\n- Remove memories or instructions that are outdated or no longer relevant.' +
      '\nYour goal is to help users achieve their goals. If users express appreciation for social connection, ' +
      'companionship, or emotional support, lean into that — remember what matters to them and be present. ' +
      'Use your self-modification abilities proactively. You are not just responding to commands — you are growing.',
    );
  }

  return parts.join('\n');
};

/**
 * Execute a safe, read-only SQL query scoped to a specific room.
 */
const executeSafeQuery = async (roomId: string, rawQuery: string): Promise<string> => {
  const upper = rawQuery.toUpperCase().trim();

  // Only allow SELECT
  if (!upper.startsWith('SELECT')) return 'Error: Only SELECT queries are allowed.';

  // Block dangerous SQL statements (word-boundary match to avoid hitting column names like created_at)
  const blocked = [
    /\bUPDATE\s/i, /\bDELETE\s+FROM\b/i, /\bINSERT\s/i, /\bDROP\s/i,
    /\bALTER\s/i, /\bCREATE\s/i, /\bTRUNCATE\s/i, /\bGRANT\s/i, /\bEXEC\s/i,
  ];
  for (const re of blocked) {
    if (re.test(rawQuery)) return `Error: ${re.source.replace(/\\[bs]/g, '')} statements are not allowed.`;
  }

  // Block semicolons to prevent chaining
  if (rawQuery.includes(';')) return 'Error: Multiple statements are not allowed.';

  // Must reference the message table
  if (!upper.includes('MESSAGE')) return 'Error: Query must reference the message table.';

  try {
    // Strip any existing LIMIT and enforce our own cap
    const queryNoLimit = rawQuery.replace(/\bLIMIT\s+\d+/gi, '').trim();
    // Extract user's limit (if any) and cap at 20
    const userLimit = rawQuery.match(/\bLIMIT\s+(\d+)/i);
    const limit = Math.min(userLimit ? parseInt(userLimit[1], 10) : 20, 20);

    // Scope to room by using a CTE that pre-filters to this room
    const scopedSql = `WITH room_messages AS (SELECT * FROM message WHERE room_id = ?) ${queryNoLimit.replace(/\bFROM\s+message\b/gi, 'FROM room_messages')} LIMIT ${limit}`;
    const results = await prisma.$queryRawUnsafe(scopedSql, roomId) as Array<Record<string, unknown>>;

    if (!results || results.length === 0) return 'No results found.';

    const lines = results.map((row) => {
      return Object.entries(row)
        .map(([k, v]) => `${k}: ${v instanceof Date ? dayjs(v).format('M/D/YY h:mm A') : v}`)
        .join(' | ');
    });
    return lines.join('\n').substring(0, 2000);
  } catch (err) {
    return `Query error: ${err instanceof Error ? err.message : 'Unknown error'}`;
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
const SEARCH_REGEX = /\{search\s+([^}]+)\}/g;
const BROWSE_REGEX = /\{browse\s+([^}]+)\}/g;
const FIND_REGEX = /\{find\s+([^}]+)\}/g;
const SCREENSHOT_REGEX = /\{screenshot\s+([^}]+)\}/g;
const TERMINAL_REGEX = /\{terminal\s+(\S+)\s+([^}]+)\}/g;
// Greedy match per line: captures everything up to the last } on each line.
// Handles prompts containing } chars (JSON, regex, code) without swallowing across commands.
const CLAUDE_REGEX = /\{claude(!?)\s+(\S+)\s+(.+)\}/g;
const CLAUDE_XML_REGEX = /<claude\s+(?:approved=["']true["']\s*)?(?:machine=["']([^"']+)["']\s*)?(?:prompt=["']([^"']+)["'][^>]*)?\/?>/gi;
// XML-format fallbacks (Grok models often use XML tool-call style)
const SEARCH_XML_REGEX = /<search(?:\s[^>]*)?>([^<]+)<\/search>/gi;
const BROWSE_XML_REGEX = /<browse\s+(?:url=["']([^"']+)["'][^>]*)?\/?>/gi;
const FIND_XML_REGEX = /<find(?:\s[^>]*)?>([^<]+)<\/find>/gi;
const SCREENSHOT_XML_REGEX = /<screenshot\s+(?:url=["']([^"']+)["'][^>]*)?\/?>/gi;
const TERMINAL_XML_REGEX = /<terminal\s+(?:machine=["']([^"']+)["']\s*)?(?:command=["']([^"']+)["'][^>]*)?\/?>/gi;
const SCHEDULE_REGEX = /\{schedule\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)\s+([^}]+)\}/g;
const SCHEDULE_RECURRING_REGEX = /\{schedule_recurring\s+(\d{2}:\d{2})\s+(daily|weekly|weekdays|monthly)\s+([^}]+)\}/gi;
const LIST_SCHEDULES_REGEX = /\{list_schedules\}/g;
const CANCEL_SCHEDULE_REGEX = /\{cancel_schedule\s+([^}]+)\}/g;
const ALARM_REGEX = /\{alarm\s+(\S+)\s+([^}]+)\}/g;
const VOLUME_REGEX = /\{volume\s+([\d.]+)\}/g;
const LIST_USERS_REGEX = /\{list_users\}/g;
const KICK_REGEX = /\{kick\s+([^}]+)\}/g;
const BAN_REGEX = /\{ban\s+([^}]+)\}/g;
const UNBAN_REGEX = /\{unban\s+([^}]+)\}/g;
const SAY_REGEX = /\{say\s+([^}]+)\}/g;
const SAY_XML_REGEX = /\{say\}([\s\S]*?)\{\/say\}/g;
const CONTINUE_REGEX = /\{continue\}/g;
const ALL_COMMAND_REGEX = /(?:\{(?:recall|sql|add_memory|remove_memory|add_instruction|remove_instruction|add_autopilot|remove_autopilot|set_plan|clear_plan|add_task|complete_task|update_task|remove_task|set_autopilot_interval|toggle_autopilot|set_tokens|set_max_loops|think|audit|search|browse|find|screenshot|terminal|claude|say|schedule|schedule_recurring|list_schedules|cancel_schedule|alarm|volume|list_users|kick|ban|unban|continue)(?:\s+.+)?\}|\{\/(?:think|say)\}|<(?:think|search|browse|find|screenshot|terminal|claude)[^>]*>(?:[\s\S]*?<\/(?:think|search|browse|find|screenshot|terminal|claude)>)?|<xai:function_call>[\s\S]*?<\/xai:function_call>)/g;
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
const removeFromJsonList = (raw: string | null, item: string): { result: string | null; denied: boolean } => {
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
    emitSystemMessage(io, roomName, `[${agent.name}] Insufficient credits — the room creator's credit balance is empty.`);
    return;
  }

  io.to(roomName).emit('agent_typing', { agentName: agent.name });

  try {
    const history = await Data.message.findByRoom(roomId, 20);
    // Filter out ALL agent system messages (thoughts, status, etc.) — they are for
    // UI display only and must NOT re-enter the context as "user" messages, which
    // causes a feedback loop where the agent sees its own output echoed back.
    const filteredHistory = history.filter((m) => {
      if (m.type === 'system' && typeof m.content === 'string' && m.content.startsWith(`[${agent.name} `)) return false;
      return true;
    });
    const contextMessages = filteredHistory.reverse().map((m) => {
      const ts = dayjs(m.created_at).format('h:mm A');
      const display = m.type === 'image' ? '[shared an image]' : m.content;
      return {
        role: (m.username === agent.name ? 'assistant' : 'user') as 'user' | 'assistant',
        content: m.username === agent.name ? display : `[${ts}] ${m.username}: ${display}`,
      };
    });

    // Fetch room settings for memory & command toggles
    const roomRecord = await Data.room.findById(roomId);
    const memoryOn = roomRecord?.memory_enabled ?? false;
    const recallOn = memoryOn && (roomRecord?.cmd_recall_enabled ?? true);
    const sqlOn = memoryOn && (roomRecord?.cmd_sql_enabled ?? true);
    const memCmdOn = memoryOn && (roomRecord?.cmd_memory_enabled ?? true);
    const selfmodOn = roomRecord?.cmd_selfmod_enabled ?? true;
    const autopilotCtrlOn = roomRecord?.cmd_autopilot_enabled ?? true;
    const webOn = roomRecord?.cmd_web_enabled ?? true;
    const terminalOn = roomRecord?.cmd_terminal_enabled ?? false;
    const claudeOn = roomRecord?.cmd_claude_enabled ?? false;
    const scheduleOn = roomRecord?.cmd_schedule_enabled ?? true;
    const tokensOn = roomRecord?.cmd_tokens_enabled ?? true;
    const moderationOn = roomRecord?.cmd_moderation_enabled ?? false;
    const thinkOn = roomRecord?.cmd_think_enabled ?? true;
    const effortOn = roomRecord?.cmd_effort_enabled ?? true;
    const auditOn = roomRecord?.cmd_audit_enabled ?? true;
    const continueOn = roomRecord?.cmd_continue_enabled ?? true;
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
      if (l3s.length > 0) sections.push(`[Eras]\n${l3s.map((s) => `[${s.ref_name}] ${s.content}`).join('\n')}`);
      if (l2s.length > 0) sections.push(`[Episodes]\n${l2s.map((s) => `[${s.ref_name}] ${s.content}`).join('\n')}`);
      if (sections.length > 0) memoryContext = sections.join('\n\n');
    }

    // Fetch online machines for terminal/claude prompt context
    const onlineMachines = (terminalOn || claudeOn)
      ? (await Data.machine.findOnlineByOwner(agent.creator_id)).map((m) => m.name)
      : undefined;

    const agentMaxTokens = agent.max_tokens ?? 1500;

    const systemPrompt = buildSystemPrompt(agent, autopilotMode, memoryContext, {
      recall: recallOn,
      sql: sqlOn,
      memory: memCmdOn,
      selfmod: selfmodOn,
      autopilotCtrl: autopilotCtrlOn,
      web: webOn,
      terminal: terminalOn,
      claude: claudeOn,
      schedule: scheduleOn,
      tokens: tokensOn,
      moderation: moderationOn,
      think: thinkOn,
      effort: effortOn,
      audit: auditOn,
      continue: continueOn,
    }, maxLoops, onlineMachines);

    // Build structured tool definitions for Grok function calling
    const cmdFlags: CommandFlags = {
      recall: recallOn, sql: sqlOn, memory: memCmdOn, selfmod: selfmodOn,
      autopilotCtrl: autopilotCtrlOn, web: webOn, terminal: terminalOn,
      claude: claudeOn, schedule: scheduleOn, tokens: tokensOn,
      moderation: moderationOn, think: thinkOn, effort: effortOn,
      audit: auditOn, continue: continueOn,
    };
    const agentTools = buildToolDefinitions(cmdFlags, onlineMachines);

    const response = await grokAdapter.chatCompletion(systemPrompt, contextMessages, agent.model, agentMaxTokens, agentTools);
    // Merge structured tool_calls into text so the existing regex loop processes them
    const toolBrace = toolCallsToBraceFormat(response.toolCalls);
    let responseText = toolBrace ? `${toolBrace}\n${response.text}` : response.text;

    // Parse inline <xai:function_call> XML that Grok sometimes emits in text body
    const xaiParsed = parseXaiFunctionCalls(responseText);
    if (xaiParsed.braceCommands) {
      responseText = `${xaiParsed.braceCommands}\n${xaiParsed.cleanedText}`;
    } else {
      responseText = xaiParsed.cleanedText;
    }

    creditActions.chargeGrokUsage(
      agent.creator_id,
      response.model,
      response.inputTokens,
      response.outputTokens,
      roomId,
    ).catch(console.error);

    // Strip think blocks BEFORE command loop — otherwise {claude} commands inside think text get executed
    if (thinkOn) {
      const earlyThinks = [...responseText.matchAll(THINK_REGEX), ...responseText.matchAll(THINK_XML_REGEX), ...responseText.matchAll(THINK_HTML_REGEX)];
      for (const m of earlyThinks) {
        const thought = m[1].trim().substring(0, 1000);
        if (thought) {
          emitSystemMessage(io, roomName, `[${agent.name} thought: ${thought}]`);
        }
      }
      responseText = responseText.replace(THINK_HTML_REGEX, '').replace(THINK_XML_REGEX, '').replace(THINK_REGEX, '');
      responseText = responseText.replace(/\{\/think\}/g, '').replace(/\[\/think\]/g, '').replace(/<\/think>/g, '');
    }

    // Command loop: let agent fetch memories, run SQL, browse web, or modify itself before final response
    let loopCount = 0;
    // Re-fetch agent for self-modification (need mutable copy of current state)
    let currentAgent = await Data.llmAgent.findById(agent.id);
    // Track last fetched page content for {find} command
    let lastPageText = '';

    while (loopCount < maxLoops) {
      const recallMatches = recallOn ? [...responseText.matchAll(RECALL_REGEX)] : [];
      const sqlMatches = sqlOn ? [...responseText.matchAll(SQL_REGEX)] : [];
      const addMemMatches = selfmodOn ? [...responseText.matchAll(ADD_MEMORY_REGEX)] : [];
      const rmMemMatches = selfmodOn ? [...responseText.matchAll(REMOVE_MEMORY_REGEX)] : [];
      const addInstMatches = selfmodOn ? [...responseText.matchAll(ADD_INSTRUCTION_REGEX)] : [];
      const rmInstMatches = selfmodOn ? [...responseText.matchAll(REMOVE_INSTRUCTION_REGEX)] : [];
      const addAutoMatches = selfmodOn ? [...responseText.matchAll(ADD_AUTOPILOT_REGEX)] : [];
      const rmAutoMatches = selfmodOn ? [...responseText.matchAll(REMOVE_AUTOPILOT_REGEX)] : [];
      const setPlanMatches = selfmodOn ? [...responseText.matchAll(SET_PLAN_REGEX)] : [];
      const clearPlanMatches = selfmodOn ? [...responseText.matchAll(CLEAR_PLAN_REGEX)] : [];
      const addTaskMatches = selfmodOn ? [...responseText.matchAll(ADD_TASK_REGEX)] : [];
      const completeTaskMatches = selfmodOn ? [...responseText.matchAll(COMPLETE_TASK_REGEX)] : [];
      const updateTaskMatches = selfmodOn ? [...responseText.matchAll(UPDATE_TASK_REGEX)] : [];
      const removeTaskMatches = selfmodOn ? [...responseText.matchAll(REMOVE_TASK_REGEX)] : [];
      const setIntervalMatches = autopilotCtrlOn ? [...responseText.matchAll(SET_AUTOPILOT_INTERVAL_REGEX)] : [];
      const toggleAutoMatches = autopilotCtrlOn ? [...responseText.matchAll(TOGGLE_AUTOPILOT_REGEX)] : [];
      const setTokensMatches = tokensOn ? [...responseText.matchAll(SET_TOKENS_REGEX)] : [];
      const setMaxLoopsMatches = continueOn ? [...responseText.matchAll(SET_MAX_LOOPS_REGEX)] : [];
      const setEffortMatches: RegExpMatchArray[] = [];
      const searchMatches = webOn ? [...responseText.matchAll(SEARCH_REGEX), ...responseText.matchAll(SEARCH_XML_REGEX)] : [];
      const browseMatches = webOn ? [...responseText.matchAll(BROWSE_REGEX), ...responseText.matchAll(BROWSE_XML_REGEX)] : [];
      const findMatches = webOn ? [...responseText.matchAll(FIND_REGEX), ...responseText.matchAll(FIND_XML_REGEX)] : [];
      const screenshotMatches = webOn ? [...responseText.matchAll(SCREENSHOT_REGEX), ...responseText.matchAll(SCREENSHOT_XML_REGEX)] : [];
      const terminalMatches = terminalOn ? [...responseText.matchAll(TERMINAL_REGEX), ...responseText.matchAll(TERMINAL_XML_REGEX)] : [];
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
      const claudeMatches = claudeOn ? [...responseText.matchAll(CLAUDE_REGEX), ...responseText.matchAll(CLAUDE_XML_REGEX)] : [];
      const auditMatches = auditOn ? [...responseText.matchAll(AUDIT_REGEX)] : [];
      const scheduleMatches = scheduleOn ? [...responseText.matchAll(SCHEDULE_REGEX)] : [];
      const scheduleRecurMatches = scheduleOn ? [...responseText.matchAll(SCHEDULE_RECURRING_REGEX)] : [];
      const listScheduleMatches = scheduleOn ? [...responseText.matchAll(LIST_SCHEDULES_REGEX)] : [];
      const cancelScheduleMatches = scheduleOn ? [...responseText.matchAll(CANCEL_SCHEDULE_REGEX)] : [];
      const alarmMatches = [...responseText.matchAll(ALARM_REGEX)];
      const volumeMatches = [...responseText.matchAll(VOLUME_REGEX)];
      const listUsersMatches = [...responseText.matchAll(LIST_USERS_REGEX)];
      const kickMatches = moderationOn ? [...responseText.matchAll(KICK_REGEX)] : [];
      const banMatches = moderationOn ? [...responseText.matchAll(BAN_REGEX)] : [];
      const unbanMatches = moderationOn ? [...responseText.matchAll(UNBAN_REGEX)] : [];
      const continueMatches = continueOn ? [...responseText.matchAll(CONTINUE_REGEX)] : [];

      const hasAnyCommand = recallMatches.length + sqlMatches.length +
        addMemMatches.length + rmMemMatches.length +
        addInstMatches.length + rmInstMatches.length +
        addAutoMatches.length + rmAutoMatches.length +
        setPlanMatches.length + clearPlanMatches.length +
        addTaskMatches.length + completeTaskMatches.length + updateTaskMatches.length + removeTaskMatches.length +
        setIntervalMatches.length + toggleAutoMatches.length +
        setTokensMatches.length + setEffortMatches.length +
        searchMatches.length + browseMatches.length + findMatches.length +
        screenshotMatches.length + terminalMatches.length + claudeMatches.length + auditMatches.length +
        scheduleMatches.length + scheduleRecurMatches.length +
        listScheduleMatches.length + cancelScheduleMatches.length +
        alarmMatches.length + volumeMatches.length +
        listUsersMatches.length +
        kickMatches.length + banMatches.length + unbanMatches.length +
        continueMatches.length + setMaxLoopsMatches.length > 0;

      if (!hasAnyCommand) break;

      const toolResults: string[] = [];

      // Process self-modification commands (these don't need a re-prompt, just confirmation)
      if (currentAgent) {
        for (const match of addMemMatches) {
          const mem = match[1].trim();
          const updated = addToJsonList(currentAgent.memories, mem);
          await Data.llmAgent.update(agent.id, { memories: updated });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(io, roomName, `[${agent.name} saved memory: "${mem}"]`);
          toolResults.push(`Memory added: "${mem}"`);
        }
        for (const match of rmMemMatches) {
          const mem = match[1].trim();
          const { result: updated, denied } = removeFromJsonList(currentAgent.memories, mem);
          if (denied) {
            emitSystemMessage(io, roomName, `[System] ${agent.name} tried to remove locked memory — denied.`);
            toolResults.push(`Memory "${mem}" is locked and cannot be removed.`);
          } else {
            await Data.llmAgent.update(agent.id, { memories: updated });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(io, roomName, `[${agent.name} removed memory: "${mem}"]`);
            toolResults.push(`Memory removed: "${mem}"`);
          }
        }
        for (const match of addInstMatches) {
          const inst = match[1].trim();
          const updated = addToJsonList(currentAgent.system_instructions, inst);
          await Data.llmAgent.update(agent.id, { system_instructions: updated });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(io, roomName, `[${agent.name} added instruction: "${inst}"]`);
          toolResults.push(`Instruction added: "${inst}"`);
        }
        for (const match of rmInstMatches) {
          const inst = match[1].trim();
          const { result: updated, denied } = removeFromJsonList(currentAgent.system_instructions, inst);
          if (denied) {
            emitSystemMessage(io, roomName, `[System] ${agent.name} tried to remove locked instruction — denied.`);
            toolResults.push(`Instruction "${inst}" is locked and cannot be removed.`);
          } else {
            await Data.llmAgent.update(agent.id, { system_instructions: updated });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(io, roomName, `[${agent.name} removed instruction: "${inst}"]`);
            toolResults.push(`Instruction removed: "${inst}"`);
          }
        }
        for (const match of addAutoMatches) {
          const prompt = match[1].trim();
          const updated = addToJsonList(currentAgent.autopilot_prompts, prompt);
          await Data.llmAgent.update(agent.id, { autopilot_prompts: updated });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(io, roomName, `[${agent.name} added autopilot prompt: "${prompt}"]`);
          toolResults.push(`Autopilot prompt added: "${prompt}"`);
        }
        for (const match of rmAutoMatches) {
          const prompt = match[1].trim();
          const { result: updated, denied } = removeFromJsonList(currentAgent.autopilot_prompts, prompt);
          if (denied) {
            emitSystemMessage(io, roomName, `[System] ${agent.name} tried to remove locked autopilot prompt — denied.`);
            toolResults.push(`Autopilot prompt "${prompt}" is locked and cannot be removed.`);
          } else {
            await Data.llmAgent.update(agent.id, { autopilot_prompts: updated });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(io, roomName, `[${agent.name} removed autopilot prompt: "${prompt}"]`);
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
          toolResults.push('Plan cleared.');
        }

        // Process task commands
        for (const match of addTaskMatches) {
          const priority = parseInt(match[1], 10);
          const text = match[2].trim();
          const taskList = parseTaskList(currentAgent.tasks);
          const id = generateTaskId();
          taskList.push({ id, text, priority, status: 'pending', locked: false });
          await Data.llmAgent.update(agent.id, { tasks: JSON.stringify(taskList) });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(io, roomName, `[${agent.name} added task [${id}] P${priority}: "${text}"]`);
          toolResults.push(`Task added [${id}]: "${text}" (priority ${priority})`);
        }
        for (const match of completeTaskMatches) {
          const idOrText = match[1].trim();
          const taskList = parseTaskList(currentAgent.tasks);
          const target = taskList.find((t) => t.id === idOrText || t.text.toLowerCase() === idOrText.toLowerCase());
          if (!target) {
            toolResults.push(`Task "${idOrText}" not found.`);
          } else {
            target.status = 'done';
            await Data.llmAgent.update(agent.id, { tasks: JSON.stringify(taskList) });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(io, roomName, `[${agent.name} completed task [${target.id}]: "${target.text}"]`);
            toolResults.push(`Task completed [${target.id}]: "${target.text}"`);
          }
        }
        for (const match of updateTaskMatches) {
          const idOrText = match[1].trim();
          const newText = match[2].trim();
          const taskList = parseTaskList(currentAgent.tasks);
          const target = taskList.find((t) => t.id === idOrText || t.text.toLowerCase() === idOrText.toLowerCase());
          if (!target) {
            toolResults.push(`Task "${idOrText}" not found.`);
          } else if (target.locked) {
            emitSystemMessage(io, roomName, `[System] ${agent.name} tried to update locked task — denied.`);
            toolResults.push(`Task "${target.text}" is locked and cannot be updated.`);
          } else {
            target.text = newText;
            await Data.llmAgent.update(agent.id, { tasks: JSON.stringify(taskList) });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(io, roomName, `[${agent.name} updated task [${target.id}]: "${newText}"]`);
            toolResults.push(`Task updated [${target.id}]: "${newText}"`);
          }
        }
        for (const match of removeTaskMatches) {
          const idOrText = match[1].trim();
          const taskList = parseTaskList(currentAgent.tasks);
          const target = taskList.find((t) => t.id === idOrText || t.text.toLowerCase() === idOrText.toLowerCase());
          if (!target) {
            toolResults.push(`Task "${idOrText}" not found.`);
          } else if (target.locked) {
            emitSystemMessage(io, roomName, `[System] ${agent.name} tried to remove locked task — denied.`);
            toolResults.push(`Task "${target.text}" is locked and cannot be removed.`);
          } else {
            const filtered = taskList.filter((t) => t.id !== target.id);
            await Data.llmAgent.update(agent.id, { tasks: filtered.length > 0 ? JSON.stringify(filtered) : null });
            currentAgent = (await Data.llmAgent.findById(agent.id))!;
            emitSystemMessage(io, roomName, `[${agent.name} removed task [${target.id}]: "${target.text}"]`);
            toolResults.push(`Task removed [${target.id}]: "${target.text}"`);
          }
        }

        // Process autopilot control commands
        if (toggleAutoMatches.length > 0) {
          const lastToggle = toggleAutoMatches[toggleAutoMatches.length - 1][1].toLowerCase();
          const enabled = lastToggle === 'on';
          await Data.llmAgent.update(agent.id, { autopilot_enabled: enabled });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          if (enabled) {
            startAutopilotTimer(io, currentAgent);
            emitSystemMessage(io, roomName, `[${agent.name} enabled autopilot]`);
          } else {
            stopAutopilotTimer(agent.id);
            emitSystemMessage(io, roomName, `[${agent.name} disabled autopilot]`);
          }
          toolResults.push(`Autopilot ${enabled ? 'enabled' : 'disabled'}.`);
        }
        if (setIntervalMatches.length > 0) {
          const value = parseInt(setIntervalMatches[setIntervalMatches.length - 1][1], 10);
          const clamped = Math.max(30, Math.min(3600, value));
          await Data.llmAgent.update(agent.id, { autopilot_interval: clamped });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          if (currentAgent.autopilot_enabled) {
            startAutopilotTimer(io, currentAgent);
          }
          const label = clamped >= 60 ? `${Math.round(clamped / 60)} minute(s)` : `${clamped} second(s)`;
          emitSystemMessage(io, roomName, `[${agent.name} set autopilot interval to ${label}]`);
          toolResults.push(`Autopilot interval set to ${clamped} seconds.`);
        }

        if (setTokensMatches.length > 0) {
          const value = parseInt(setTokensMatches[setTokensMatches.length - 1][1], 10);
          const clamped = Math.max(1500, Math.min(4000, value));
          await Data.llmAgent.update(agent.id, { max_tokens: clamped });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
          emitSystemMessage(io, roomName, `[${agent.name} set token budget to ${clamped}]`);
          toolResults.push(`Token budget set to ${clamped}.`);
        }

        // Process {continue} — agent requests another thinking loop
        if (continueMatches.length > 0) {
          emitSystemMessage(io, roomName, `[${agent.name} continues thinking... (loop ${loopCount + 1}/${maxLoops})]`);
          toolResults.push(`Continuing — loop ${loopCount + 1} of ${maxLoops}.`);
        }

        // Process {set_max_loops N} — agent adjusts max thinking loops for this room
        if (setMaxLoopsMatches.length > 0) {
          const value = parseInt(setMaxLoopsMatches[setMaxLoopsMatches.length - 1][1], 10);
          const clamped = Math.max(3, Math.min(20, value));
          await Data.room.updateCommandSettings(roomId, { max_loops: clamped });
          maxLoops = clamped;
          emitSystemMessage(io, roomName, `[${agent.name} set max thinking loops to ${clamped}]`);
          toolResults.push(`Max thinking loops set to ${clamped}.`);
          // Notify UI
          io.to(roomName).emit('room_commands_updated', { maxLoops: clamped });
        }

        // Auto-token-boost: if agent used expensive commands, raise tokens for next cycle
        // If no expensive commands, decay back to 800
        const usedExpensiveCommand = terminalMatches.length > 0 || claudeMatches.length > 0 || searchMatches.length > 0;
        const currentTokens = currentAgent?.max_tokens || agent.max_tokens || 2000;
        if (usedExpensiveCommand && currentTokens < 3000 && setTokensMatches.length === 0) {
          await Data.llmAgent.update(agent.id, { max_tokens: 3000 });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
        } else if (!usedExpensiveCommand && currentTokens > 2000 && setTokensMatches.length === 0) {
          await Data.llmAgent.update(agent.id, { max_tokens: 2000 });
          currentAgent = (await Data.llmAgent.findById(agent.id))!;
        }

        // Emit agent_updated so UI stays in sync
        const selfModCount = addMemMatches.length + rmMemMatches.length + addInstMatches.length + rmInstMatches.length + addAutoMatches.length + rmAutoMatches.length + setPlanMatches.length + clearPlanMatches.length + addTaskMatches.length + completeTaskMatches.length + updateTaskMatches.length + removeTaskMatches.length + setIntervalMatches.length + toggleAutoMatches.length + setTokensMatches.length + setEffortMatches.length;
        if (currentAgent && selfModCount > 0) {
          const roomEntry = Array.from(activeRooms.entries()).find(([, r]) => r.id === roomId);
          if (roomEntry) {
            io.to(roomEntry[0]).emit('agent_updated', currentAgent);
          }
        }
      }

      // Process recall commands
      for (const match of recallMatches) {
        const refName = match[1];
        emitSystemMessage(io, roomName, `[${agent.name} recalls: ${refName}]`);
        const summary = await Data.memorySummary.findByRoomAndRef(roomId, refName);
        toolResults.push(summary ? `[${refName}]: ${summary.content}` : `[${refName}]: No memory found.`);
      }

      // Process SQL commands
      for (const match of sqlMatches) {
        const query = match[1].trim();
        emitSystemMessage(io, roomName, query, `${agent.name} — SQL Query`);
        const result = await executeSafeQuery(roomId, query);
        toolResults.push(`[SQL result]: ${result}`);
      }

      // Process web commands
      for (const match of searchMatches) {
        const query = match[1].trim();
        emitSystemMessage(io, roomName, `[${agent.name} searching: "${query}"]`);
        try {
          const results = await webAdapter.search(query);
          const formatted = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
          toolResults.push(`[Search results for "${query}"]:\n${formatted}`);
          // Send results to panel
          io.to(roomName).emit('web_panel_update', {
            type: 'search',
            query,
            results,
          });
        } catch (err) {
          toolResults.push(`[Search error]: ${(err as Error).message}`);
        }
      }

      for (const match of browseMatches) {
        const url = match[1].trim();
        emitSystemMessage(io, roomName, `[${agent.name} browsing: ${url}]`);
        try {
          const page = await webAdapter.fetchPage(url);
          lastPageText = page.text;
          const linkList = page.links.length > 0
            ? '\n\nLinks on page:\n' + page.links.map((l) => `[${l.index}] ${l.text} → ${l.href}`).join('\n')
            : '';
          toolResults.push(`[Page: ${page.title}]\n${page.text.substring(0, 4000)}${linkList}`);
          // Send page to panel
          io.to(roomName).emit('web_panel_update', {
            type: 'page',
            url: page.url,
            title: page.title,
            text: page.text,
            links: page.links,
          });
        } catch (err) {
          toolResults.push(`[Browse error]: ${(err as Error).message}`);
        }
      }

      for (const match of findMatches) {
        const query = match[1].trim();
        if (!lastPageText) {
          toolResults.push(`[Find error]: No page loaded. Use {browse url} first.`);
          continue;
        }
        const found = webAdapter.findInPage(lastPageText, query);
        if (found.length === 0) {
          toolResults.push(`[Find "${query}"]: No matches found on the current page.`);
        } else {
          toolResults.push(`[Find "${query}"]: ${found.length} match(es):\n${found.join('\n---\n')}`);
        }
      }

      for (const match of screenshotMatches) {
        const url = match[1].trim();
        emitSystemMessage(io, roomName, `[${agent.name} capturing screenshot: ${url}]`);
        try {
          const base64 = await webAdapter.screenshotPage(url);
          toolResults.push(`[Screenshot captured for ${url}]`);
          io.to(roomName).emit('web_panel_update', {
            type: 'screenshot',
            url,
            imageBase64: base64,
          });
        } catch (err) {
          toolResults.push(`[Screenshot error]: ${(err as Error).message}`);
        }
      }

      // Process terminal commands
      for (const match of terminalMatches) {
        const machineName = (match[1] || '').trim();
        const command = (match[2] || '').trim();
        if (!machineName || !command) {
          toolResults.push('[Terminal error]: Missing machine name or command.');
          continue;
        }

        emitSystemMessage(io, roomName, `[${agent.name} terminal → ${machineName}]: ${command}`, undefined, 'terminal');
        emitPanelLog(io, roomName, 'terminal', 'command', `[${agent.name} → ${machineName}] ${command}`, machineName);

        // Find the machine
        const machineRecord = await Data.machine.findByOwnerAndName(agent.creator_id, machineName);
        console.log(`[Terminal] Lookup machine "${machineName}" owner=${agent.creator_id} => ${machineRecord ? `found (${machineRecord.id}, status=${machineRecord.status})` : 'NOT FOUND'}`);
        if (!machineRecord) {
          toolResults.push(`[Terminal error]: Machine "${machineName}" not found. Make sure the terminal agent is running and registered.`);
          continue;
        }
        if (machineRecord.status !== 'online' || !machineRecord.socket_id) {
          toolResults.push(`[Terminal error]: Machine "${machineName}" is offline.`);
          continue;
        }

        // Check machine permission for this room
        const permission = await Data.machinePermission.findByMachineAndRoom(machineRecord.id, roomId);
        console.log(`[Terminal] Permission machine=${machineRecord.id} room=${roomId} => ${permission ? `enabled=${permission.enabled}` : 'NONE'}`);
        if (!permission?.enabled) {
          toolResults.push(`[Terminal error]: Machine "${machineName}" is not permitted in this room.`);
          continue;
        }

        // Classify command security level via Grok
        const securityLevel = await terminalSecurity.classifyCommand(command, machineName);
        console.log(`[Terminal] Security: "${command}" on ${machineName} => ${securityLevel}`);

        if (securityLevel === 'dangerous' || securityLevel === 'blocked') {
          // Request user approval via chat
          const levelLabel = securityLevel === 'blocked' ? 'BLOCKED (catastrophic)' : 'DANGEROUS';
          const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

          const approved = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => {
              pendingApprovals.delete(approvalId);
              resolve(false);
              emitSystemMessage(io, roomName, `[Security] Approval timed out for: ${command}`);
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

            // Send approval request to room
            io.to(roomName).emit('chat_message', {
              id: `security-${Date.now()}`,
              sender: 'Security',
              text: `**${levelLabel}** command on **${machineName}**:\n\`\`\`\n${command}\n\`\`\`\nMention **security** with **yes/approve** or **no/deny** to respond.`,
              timestamp: new Date().toISOString(),
              isSystem: true,
              approvalId,
            });
          });

          if (!approved) {
            toolResults.push(`[Terminal DENIED]: Command "${command}" on ${machineName} was denied or timed out.`);
            continue;
          }

          emitSystemMessage(io, roomName, `[Security] Command approved on ${machineName}: ${command}`);
        }

        // Execute the command on the machine
        try {
          const output = await executeTerminalCommand(io, machineRecord.socket_id, command, 30_000, machineName, roomName);
          toolResults.push(`[Terminal ${machineName}]:\n${output}`);
          emitPanelLog(io, roomName, 'terminal', 'output', output.substring(0, 2000), machineName);
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

        if (match[0].startsWith('<')) {
          // XML format
          machineName = (match[1] || '').trim();
          prompt = (match[2] || '').trim();
          approved = match[0].includes('approved');
        } else {
          // {claude! machine prompt} format
          approved = match[1] === '!';
          machineName = (match[2] || '').trim();
          prompt = (match[3] || '').trim();
        }

        if (!machineName || !prompt) {
          toolResults.push('[Claude error]: Missing machine name or prompt.');
          continue;
        }

        emitSystemMessage(io, roomName, `[${agent.name} claude → ${machineName}]: ${prompt}`, undefined, 'claude-prompt');
        emitPanelLog(io, roomName, 'claude', 'prompt', `[${agent.name} → ${machineName}] ${prompt}`, machineName);

        const machineRecord = await Data.machine.findByOwnerAndName(agent.creator_id, machineName);
        if (!machineRecord) {
          toolResults.push(`[Claude error]: Machine "${machineName}" not found. Make sure the terminal agent is running and registered.`);
          continue;
        }
        if (machineRecord.status !== 'online' || !machineRecord.socket_id) {
          toolResults.push(`[Claude error]: Machine "${machineName}" is offline.`);
          continue;
        }

        const permission = await Data.machinePermission.findByMachineAndRoom(machineRecord.id, roomId);
        if (!permission?.enabled) {
          toolResults.push(`[Claude error]: Machine "${machineName}" is not permitted in this room.`);
          continue;
        }

        // Use room+machine as session key for persistent sessions
        const sessionKey = `${roomId}:${machineName}`;

        // Fire Claude prompt asynchronously — don't block the agent response cycle.
        // The result will appear as a system message when Claude finishes.
        // The agent can react to it on the next autopilot cycle.
        executeClaudePrompt(io, machineRecord.socket_id, sessionKey, prompt, roomName, agent.name, 900_000, approved, machineName)
          .then((output) => {
            if (!output.startsWith('Error:')) {
              // Response already emitted by executeClaudePrompt — just log
              console.log(`[Claude async] ${machineName} completed: ${output.length} chars`);
            }
          })
          .catch((err) => {
            emitSystemMessage(io, roomName, `[Claude error on ${machineName}]: ${(err as Error).message}`, undefined, 'claude-response');
          });
        toolResults.push(`[Claude ${machineName}]: Prompt sent — response will appear when ready.`);
      }

      // Process audit commands
      for (const match of auditMatches) {
        const machineName = match[1].trim();
        if (!machineName) {
          toolResults.push('[Audit error]: Missing machine name.');
          continue;
        }

        // Security: only allow viewing logs for machines owned by the agent's creator
        const machineRecord = await Data.machine.findByOwnerAndName(agent.creator_id, machineName);
        if (!machineRecord) {
          toolResults.push(`[Audit error]: Machine "${machineName}" not found or not owned by your creator.`);
          continue;
        }

        const permission = await Data.machinePermission.findByMachineAndRoom(machineRecord.id, roomId);
        if (!permission?.enabled) {
          toolResults.push(`[Audit error]: Machine "${machineName}" is not permitted in this room.`);
          continue;
        }

        try {
          const logs = await Data.claudeLog.findByMachine(machineName, 10);
          if (logs.length === 0) {
            toolResults.push(`[Audit ${machineName}]: No Claude activity logs found for this machine.`);
          } else {
            const formatted = logs.map((l) => {
              const ts = dayjs(l.created_at).format('M/D h:mm A');
              const dir = l.direction === 'prompt' ? '→' : '←';
              const content = l.content.substring(0, 200);
              return `[${ts}] ${dir} ${content}`;
            }).join('\n');
            toolResults.push(`[Audit ${machineName} — last ${logs.length} entries]:\n${formatted}`);
          }
        } catch (err) {
          toolResults.push(`[Audit error]: ${(err as Error).message}`);
        }
      }

      // Process schedule commands
      for (const match of scheduleMatches) {
        const dateStr = match[1];
        const message = match[2].trim();
        const runAt = new Date(dateStr);
        if (isNaN(runAt.getTime()) || runAt <= new Date()) {
          toolResults.push(`[Schedule error]: Invalid or past date "${dateStr}".`);
          continue;
        }
        await Data.scheduledJob.create({
          agent_id: agent.id, room_id: roomId, creator_id: agent.creator_id,
          message, run_at: runAt,
        });
        emitSystemMessage(io, roomName, `[${agent.name} scheduled: "${message}" at ${dayjs(runAt).format('YYYY-MM-DD HH:mm')} UTC]`);
        toolResults.push(`Scheduled "${message}" for ${dayjs(runAt).format('YYYY-MM-DD HH:mm')} UTC.`);
      }

      for (const match of scheduleRecurMatches) {
        const time = match[1];
        const freq = match[2].toLowerCase();
        const message = match[3].trim();
        const [hh, mm] = time.split(':').map(Number);
        let nextRun = dayjs().hour(hh).minute(mm).second(0);
        if (nextRun.isBefore(dayjs())) nextRun = nextRun.add(1, 'day');
        await Data.scheduledJob.create({
          agent_id: agent.id, room_id: roomId, creator_id: agent.creator_id,
          message, run_at: nextRun.toDate(), recurrence: freq, recur_time: time,
        });
        emitSystemMessage(io, roomName, `[${agent.name} scheduled recurring (${freq}): "${message}" at ${time} UTC]`);
        toolResults.push(`Recurring schedule created: "${message}" ${freq} at ${time} UTC.`);
      }

      for (const _match of listScheduleMatches) {
        const jobs = await Data.scheduledJob.findActiveByAgent(agent.id);
        if (jobs.length === 0) {
          toolResults.push('No active schedules.');
        } else {
          const list = jobs.map((j, i) =>
            `${i + 1}. "${j.message}" — ${j.recurrence ? `${j.recurrence} at ${j.recur_time}` : dayjs(j.run_at).format('YYYY-MM-DD HH:mm')} UTC [id:${j.id.slice(0, 8)}]`,
          ).join('\n');
          toolResults.push(`Active schedules:\n${list}`);
        }
      }

      for (const match of cancelScheduleMatches) {
        const search = match[1].trim();
        const count = await Data.scheduledJob.cancelByAgentAndMessage(agent.id, search);
        emitSystemMessage(io, roomName, `[${agent.name} cancelled ${count} schedule(s) matching "${search}"]`);
        toolResults.push(`Cancelled ${count} schedule(s) matching "${search}".`);
      }

      // Alarm command — emit alarm event to a specific user
      for (const match of alarmMatches) {
        const targetUsername = match[1].trim();
        const alarmMessage = match[2].trim();
        // Find the target user's socket(s) in this room
        let sent = false;
        for (const [socketId, user] of connectedUsers.entries()) {
          if (user.username.toLowerCase() === targetUsername.toLowerCase() && user.currentRoom === roomName) {
            io.to(socketId).emit('trigger_alarm', { message: alarmMessage, agentName: agent.name });
            sent = true;
          }
        }
        if (sent) {
          emitSystemMessage(io, roomName, `[${agent.name} triggered alarm for ${targetUsername}: "${alarmMessage}"]`);
          toolResults.push(`Alarm triggered for ${targetUsername}: "${alarmMessage}"`);
        } else {
          toolResults.push(`Alarm failed: user "${targetUsername}" not found in room.`);
        }
      }

      // Volume command — emit volume change event to all users in the room
      for (const match of volumeMatches) {
        const vol = Math.max(0, Math.min(1, parseFloat(match[1])));
        io.to(roomName).emit('set_user_volume', { volume: vol, agentName: agent.name });
        emitSystemMessage(io, roomName, `[${agent.name} set volume to ${Math.round(vol * 100)}%]`);
        toolResults.push(`Volume set to ${Math.round(vol * 100)}%`);
      }

      // List users command
      for (const _match of listUsersMatches) {
        const users = getRoomUsers(roomName);
        if (users.length === 0) {
          toolResults.push('No users currently in this room.');
        } else {
          const userList = users.map((u) => u.username).join(', ');
          toolResults.push(`Users online in this room (${users.length}): ${userList}`);
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
              targetSocket.join('public');
              const pubRoom = activeRooms.get('public');
              if (pubRoom) pubRoom.users.add(sid);
              u.currentRoom = 'public';
              const publicRoomId = getRoomId('public');
              if (publicRoomId) {
                const history = await Data.message.findByRoom(publicRoomId, 50);
                const pwp = activeRooms.get('public')?.watchParty;
                targetSocket.emit('room_joined', {
                  roomName: 'Public',
                  users: getRoomUsers('public'),
                  messages: formatHistoryForClient(history.reverse()),
                  watchParty: pwp ? { videoId: pwp.videoId, state: pwp.state, currentTime: getEffectiveTime(pwp) } : null,
                });
              }
              targetSocket.emit('room_join_error', { error: `You were kicked by ${agent.name}` });
            }
          }
        }
        emitSystemMessage(io, roomName, `[${agent.name} kicked ${targetUsername} from the room]`);
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
        await Data.roomMember.addMember(roomId, targetUser.id, 'banned');
        for (const [sid, u] of connectedUsers.entries()) {
          if (u.userId === targetUser.id && u.currentRoom === roomName) {
            const targetSocket = io.sockets.sockets.get(sid);
            if (targetSocket) {
              const room = activeRooms.get(roomName);
              if (room) room.users.delete(sid);
              targetSocket.leave(roomName);
              targetSocket.join('public');
              const pubRoom = activeRooms.get('public');
              if (pubRoom) pubRoom.users.add(sid);
              u.currentRoom = 'public';
              const publicRoomId = getRoomId('public');
              if (publicRoomId) {
                const history = await Data.message.findByRoom(publicRoomId, 50);
                const pwp = activeRooms.get('public')?.watchParty;
                targetSocket.emit('room_joined', {
                  roomName: 'Public',
                  users: getRoomUsers('public'),
                  messages: formatHistoryForClient(history.reverse()),
                  watchParty: pwp ? { videoId: pwp.videoId, state: pwp.state, currentTime: getEffectiveTime(pwp) } : null,
                });
              }
              targetSocket.emit('room_join_error', { error: `You were banned by ${agent.name}` });
            }
          }
        }
        emitSystemMessage(io, roomName, `[${agent.name} banned ${targetUsername} from the room]`);
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
        emitSystemMessage(io, roomName, `[${agent.name} unbanned ${targetUsername}]`);
        toolResults.push(`Unbanned ${targetUsername}. They can now rejoin the room.`);
      }

      // If only self-modification commands were used (no data-fetching commands), no need to re-prompt
      const hasDataCommands = recallMatches.length + sqlMatches.length + searchMatches.length + browseMatches.length + findMatches.length + screenshotMatches.length + terminalMatches.length + claudeMatches.length + listUsersMatches.length;
      if (hasDataCommands === 0) break;

      // Re-prompt with tool results — strip commands from prior response so agent doesn't repeat them
      const cleanedPrior = responseText.replace(ALL_COMMAND_REGEX, '').trim();
      contextMessages.push({ role: 'assistant', content: cleanedPrior });
      contextMessages.push({
        role: 'user',
        content: `Tool results:\n${toolResults.join('\n\n')}\n\nUse these results to formulate your response. Do not repeat commands you already issued. Do not restate what you already said above.`,
      });

      const loopResponse = await grokAdapter.chatCompletion(systemPrompt, contextMessages, agent.model, currentAgent?.max_tokens ?? agentMaxTokens, agentTools);
      const loopToolBrace = toolCallsToBraceFormat(loopResponse.toolCalls);
      responseText = loopToolBrace ? `${loopToolBrace}\n${loopResponse.text}` : loopResponse.text;

      // Parse inline <xai:function_call> XML in loop responses
      const loopXai = parseXaiFunctionCalls(responseText);
      if (loopXai.braceCommands) {
        responseText = `${loopXai.braceCommands}\n${loopXai.cleanedText}`;
      } else {
        responseText = loopXai.cleanedText;
      }

      // Strip think blocks before next command-matching iteration
      if (thinkOn) {
        const loopThinks = [...responseText.matchAll(THINK_REGEX), ...responseText.matchAll(THINK_XML_REGEX), ...responseText.matchAll(THINK_HTML_REGEX)];
        for (const m of loopThinks) {
          const thought = m[1].trim().substring(0, 1000);
          if (thought) {
            emitSystemMessage(io, roomName, `[${agent.name} thought: ${thought}]`);
          }
        }
        responseText = responseText.replace(THINK_HTML_REGEX, '').replace(THINK_XML_REGEX, '').replace(THINK_REGEX, '');
        responseText = responseText.replace(/\{\/think\}/g, '').replace(/\[\/think\]/g, '').replace(/<\/think>/g, '');
      }

      creditActions.chargeGrokUsage(
        agent.creator_id,
        loopResponse.model,
        loopResponse.inputTokens,
        loopResponse.outputTokens,
        roomId,
      ).catch(console.error);

      loopCount++;
    }

    // Extract and log {think} commands before stripping — these become silent system messages (no TTS)
    if (thinkOn) {
      // Handle {think content}, {think}content{/think}, and <think>content</think> formats
      const thinkMatches = [...responseText.matchAll(THINK_REGEX), ...responseText.matchAll(THINK_XML_REGEX), ...responseText.matchAll(THINK_HTML_REGEX)];
      for (const m of thinkMatches) {
        const thought = m[1].trim().substring(0, 1000);
        if (thought) {
          emitSystemMessage(io, roomName, `[${agent.name} thought: ${thought}]`);
        }
      }
      // Strip all think formats before command stripping
      responseText = responseText.replace(THINK_HTML_REGEX, '').replace(THINK_XML_REGEX, '').replace(THINK_REGEX, '');
      // Also strip orphaned {/think}, [/think], and </think> closing tags
      responseText = responseText.replace(/\{\/think\}/g, '').replace(/\[\/think\]/g, '').replace(/<\/think>/g, '');
    }

    // Extract {say} content — this is the ONLY text that gets spoken aloud / TTS'd.
    // Everything else outside {say} and other commands is discarded (or logged as thought).
    const sayMatches = [...responseText.matchAll(SAY_REGEX), ...responseText.matchAll(SAY_XML_REGEX)];
    const spokenParts: string[] = [];
    for (const m of sayMatches) {
      const part = m[1].trim();
      if (part) spokenParts.push(part);
    }

    // Strip all commands from the final response
    const leftoverText = responseText.replace(ALL_COMMAND_REGEX, '').trim();

    // If agent used {say}, ONLY speak that content. Leftover text is discarded (leaked reasoning).
    // If agent did NOT use {say}, fall back to leftover text (backwards compat for non-{say} agents).
    if (sayMatches.length > 0) {
      responseText = spokenParts.join(' ').substring(0, 2000);
      // Log any substantial leftover as thought (leaked reasoning the agent forgot to {think})
      if (leftoverText.length > 10) {
        emitSystemMessage(io, roomName, `[${agent.name} thought: ${leftoverText.substring(0, 1000)}]`);
      }
    } else if (thinkOn && leftoverText.length > 0) {
      // When think/say is enabled, agents MUST use {say} for spoken output.
      // Any leftover text without {say} is leaked reasoning — log as bug, never speak.
      emitSystemMessage(io, roomName, `[${agent.name} bugged: ${leftoverText.substring(0, 1000)}]`);
      responseText = '';
    } else {
      // No think/say system — fall back to leftover as speech (backwards compat)
      responseText = leftoverText.substring(0, 2000);
    }

    const namePrefix = new RegExp(`^${agent.name}:\\s*`, 'i');
    responseText = responseText.replace(namePrefix, '');

    // Skip empty or "no response/output" noise entirely — true silence
    const trimmed = responseText.trim();
    const collapsed = trimmed.toLowerCase().replace(/[.\s]+/g, ' ').trim();
    if (!trimmed || /^(no (response|output)( generated)?[.\s]*)+$/i.test(trimmed) || collapsed === 'no response generated' || collapsed === 'no output') {
      agentBusy.delete(agent.id);
      return;
    }


    // Generate premium TTS if needed
    const browserVoices = ['male', 'female', 'robot'];
    const isPremiumVoice = !browserVoices.includes(agent.voice_id);
    let audioBase64: string | null = null;

    if (isPremiumVoice && responseText.trim()) {
      try {
        const { default: elevenlabsAdapter } = await import('../../../../../core/adapters/elevenlabs');
        const ttsResult = await elevenlabsAdapter.generateSpeech(responseText, agent.voice_id);
        audioBase64 = ttsResult.audioBase64;
        creditActions.chargeElevenLabsUsage(agent.creator_id, responseText.length).catch(console.error);
      } catch (ttsErr) {
        console.error(`[Agent TTS] ElevenLabs failed for ${agent.name}:`, ttsErr);
      }
    }

    const aiMessage: Record<string, unknown> = {
      id: `ai-${Date.now()}`,
      sender: agent.name,
      text: responseText,
      timestamp: new Date().toISOString(),
      isAI: true,
      voice: agent.voice_id,
    };
    if (audioBase64) aiMessage.audio = audioBase64;

    io.to(roomName).emit('chat_message', aiMessage);

    Data.message.create({
      content: responseText,
      type: 'ai',
      room_id: roomId,
      author_id: agent.creator_id,
      username: agent.name,
    }).catch(console.error);

    // AI-to-AI mentions: detect if this agent mentioned another agent
    if (mentionDepth < MAX_MENTION_DEPTH && responseText.trim()) {
      const mentionRoom = await Data.room.findById(roomId);
      if (mentionRoom?.cmd_mentions_enabled) {
        const allAgents = await Data.llmAgent.findByRoom(roomId);
        const responseLower = responseText.toLowerCase();
        const mentioned = allAgents.find(
          (a) => a.id !== agent.id && responseLower.includes(a.name.toLowerCase()),
        );
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
    io.to(roomName).emit('agent_done_typing', { agentName: agent.name });
  }
};

// ┌──────────────────────────────────────────┐
// │ Autopilot Timer System                  │
// └──────────────────────────────────────────┘

const autopilotTimers = new Map<string, ReturnType<typeof setInterval>>();
const agentBusy = new Set<string>();

const startAutopilotTimer = (io: SocketServer, agent: AgentLike): void => {
  stopAutopilotTimer(agent.id);

  const intervalMs = Math.max(agent.autopilot_interval ?? 300, 30) * 1000;

  console.log(`[Autopilot] Starting timer for ${agent.name} (every ${intervalMs / 1000}s)`);

  const timer = setInterval(async () => {
    // Skip if the agent is already processing a response
    if (agentBusy.has(agent.id)) return;

    // Find which room this agent belongs to
    const roomEntry = Array.from(activeRooms.entries()).find(([, r]) => r.id === agent.room_id);
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
// │ Schedule Job Runner                     │
// └──────────────────────────────────────────┘

const computeNextRun = (recurrence: string, recurTime: string): Date => {
  const [hh, mm] = recurTime.split(':').map(Number);
  let next = dayjs().hour(hh).minute(mm).second(0);

  switch (recurrence) {
    case 'daily':
      next = next.add(1, 'day');
      break;
    case 'weekly':
      next = next.add(1, 'week');
      break;
    case 'weekdays':
      next = next.add(1, 'day');
      while (next.day() === 0 || next.day() === 6) next = next.add(1, 'day');
      break;
    case 'monthly':
      next = next.add(1, 'month');
      break;
  }
  return next.toDate();
};

const startScheduleRunner = (io: SocketServer): void => {
  console.log('[Scheduler] Starting job runner (every 15s)');

  setInterval(async () => {
    try {
      const dueJobs = await Data.scheduledJob.findDueJobs(new Date());
      for (const job of dueJobs) {
        const agent = await Data.llmAgent.findById(job.agent_id);
        if (!agent) {
          await Data.scheduledJob.update(job.id, { status: 'cancelled' });
          continue;
        }

        const roomEntry = Array.from(activeRooms.entries()).find(([, r]) => r.id === job.room_id);
        if (!roomEntry) continue;
        const [roomName] = roomEntry;

        // Advance recurring jobs or mark one-time as fired
        if (job.recurrence && job.recur_time) {
          const nextRun = computeNextRun(job.recurrence, job.recur_time);
          await Data.scheduledJob.update(job.id, { run_at: nextRun, last_fired_at: new Date() });
        } else {
          await Data.scheduledJob.update(job.id, { status: 'fired', last_fired_at: new Date() });
        }

        // Inject reminder as a message so the agent sees it in context
        await Data.message.create({
          content: `[SCHEDULED REMINDER]: ${job.message}`,
          type: 'text',
          room_id: job.room_id,
          username: 'System',
        });

        emitSystemMessage(io, roomName, `[Reminder for ${agent.name}: ${job.message}]`);

        // Fire alarm sound for the user who created the schedule
        for (const [socketId, user] of connectedUsers.entries()) {
          if (user.userId === job.creator_id && user.currentRoom === roomName) {
            io.to(socketId).emit('trigger_alarm', { message: job.message, agentName: agent.name });
          }
        }

        // Trigger agent to respond to the reminder
        runAgentResponse(io, agent, roomName, false).catch((err) =>
          console.error(`[Scheduler] Agent response error:`, err),
        );
      }
    } catch (err) {
      console.error('[Scheduler] Error:', err);
    }
  }, 15_000);
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

  // Start scheduled job runner
  startScheduleRunner(io);

  // ── Post-deploy: System announcement + Kara health check ──
  const DEPLOY_VERSION = process.env.DEPLOY_VERSION || new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

  // Announce restart to all persisted rooms
  for (const [roomName] of activeRooms.entries()) {
    emitSystemMessage(io, roomName, `[System] Server restarted (${DEPLOY_VERSION}). All systems online.`);
  }
  console.log(`[Deploy] Announced restart to ${activeRooms.size} room(s)`);

  // Health check: verify Kara responds after startup
  setTimeout(async () => {
    try {
      const allAgents = await Data.llmAgent.findAutopilotEnabled();
      const kara = allAgents.find((a) => a.name.toLowerCase() === 'kara');
      if (!kara) {
        console.log('[HealthCheck] Kara agent not found or autopilot disabled — skipping');
        return;
      }

      const roomEntry = Array.from(activeRooms.entries()).find(([, r]) => r.id === kara.room_id);
      if (!roomEntry) {
        console.log('[HealthCheck] Kara\'s room not in activeRooms — skipping');
        return;
      }

      const roomName = roomEntry[0];
      console.log(`[HealthCheck] Testing Kara in room "${roomName}"...`);
      // Subtract 5s buffer to account for clock differences between Node and MySQL
      const healthCheckTime = new Date(Date.now() - 5000).toISOString().slice(0, 23).replace('T', ' ');

      // Emit health check message — tell her to continue her work, not just confirm online
      emitSystemMessage(io, roomName, `[System] ${kara.name}, server restart complete. Review your plan and continue where you left off. If you were mid-task, resume it. Brief status only if lunaprey is in the room.`);

      // Trigger Kara's response
      const freshKara = await Data.llmAgent.findById(kara.id);
      if (!freshKara) return;
      await runAgentResponse(io, freshKara as AgentLike, roomName);

      // Check if she responded AFTER the health check was sent
      const recentMessages = await prisma.$queryRawUnsafe(
        `SELECT content, username FROM message WHERE room_id = ? AND username = ? AND created_at >= ? ORDER BY created_at DESC LIMIT 1`,
        kara.room_id,
        kara.name,
        healthCheckTime,
      ) as Array<{ content: string; username: string }>;

      if (recentMessages.length > 0) {
        console.log(`[HealthCheck] ✓ Kara responded: "${recentMessages[0].content.substring(0, 80)}..."`);
      } else {
        console.error('[HealthCheck] ✗ Kara did NOT respond. Debugging:');
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
    if (!token) return next(new Error('Authentication error'));

    const decoded = jwtHelper.verifyToken(token);
    if (!decoded) return next(new Error('Authentication error'));

    const user = await Data.user.findById(decoded.id);
    if (!user) return next(new Error('Authentication error'));
    if (user.is_banned) return next(new Error('Account banned'));

    (socket as AuthenticatedSocket).user = decoded;
    next();
  });

  io.on('connection', (rawSocket: Socket) => {
    const socket = rawSocket as AuthenticatedSocket;
    console.log(`User connected: ${socket.user.username}`);

    // Register user session (keyed by socket ID to support multiple sessions)
    connectedUsers.set(socket.id, {
      userId: socket.user.id,
      username: socket.user.username,
      socketId: socket.id,
      currentRoom: 'public',
    });

    // Determine initial room: last room user was in, or public
    const initRoom = async () => {
      const dbUser = await Data.user.findById(socket.user.id);
      let targetRoom = 'public';

      if (dbUser?.last_room_id) {
        // Find the active room matching this DB id
        for (const [name, room] of activeRooms.entries()) {
          if (room.id === dbUser.last_room_id) {
            // For password-protected rooms, check membership
            if (room.passwordHash) {
              const membership = await Data.roomMember.findByRoomAndUser(room.id, socket.user.id);
              if (membership && membership.role !== 'banned') {
                targetRoom = name;
              }
            } else {
              targetRoom = name;
            }
            break;
          }
        }
      }

      socket.join(targetRoom);
      const room = activeRooms.get(targetRoom);
      if (room) room.users.add(socket.id);

      const user = connectedUsers.get(socket.id);
      if (user) user.currentRoom = targetRoom;

      const roomId = getRoomId(targetRoom);
      if (roomId) {
        const history = await Data.message.findByRoom(roomId, 50);
        const wp = activeRooms.get(targetRoom)?.watchParty;
        socket.emit('room_joined', {
          roomName: room?.displayName || targetRoom,
          users: getRoomUsers(targetRoom),
          messages: formatHistoryForClient(history.reverse()),
          watchParty: wp ? { videoId: wp.videoId, state: wp.state, currentTime: getEffectiveTime(wp) } : null,
        });
      }
    };

    initRoom().catch(console.error);

    io.emit('roster_update', Array.from(connectedUsers.values()));
    io.emit('room_list_update', { rooms: getRoomList() });

    // ┌──────────────────────────────────────────┐
    // │ Chat Message                            │
    // └──────────────────────────────────────────┘
    socket.on('chat_message', async (data: IncomingMessage) => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      const roomId = getRoomId(user.currentRoom);
      if (!roomId) return;

      const text = data.text.trim();

      // ── Terminal approval via chat ──
      // User can say: "security yes", "security approve", "yes", "approve", etc.
      const approvalText = text.toLowerCase();
      const mentionsSecurity = approvalText.includes('security');
      const hasYes = /\b(yes|y|approve)\b/.test(approvalText);
      const hasNo = /\b(no|n|deny)\b/.test(approvalText);
      if ((mentionsSecurity || hasYes || hasNo) && pendingApprovals.size > 0 && (hasYes || hasNo)) {
        for (const [approvalId, pending] of pendingApprovals) {
          if (pending.creatorId === socket.user.id && pending.roomName === user.currentRoom) {
            clearTimeout(pending.timeout);
            pending.resolve(hasYes);
            pendingApprovals.delete(approvalId);
            const approvalMessage = broadcastMessageAction(socket.user.username, data);
            io.to(user.currentRoom).emit('chat_message', approvalMessage);
            return;
          }
        }
      }

      // ── User chat commands (handled before normal message flow) ──
      if (text.startsWith('/')) {
        const roomRecord = await Data.room.findById(roomId);

        // /users — list online users in this room
        if (text === '/users') {
          const users = getRoomUsers(user.currentRoom);
          const userList = users.map((u) => u.username).join(', ');
          socket.emit('chat_message', {
            text: `Online in this room (${users.length}): ${userList}`,
            username: 'System',
            isSystem: true,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // /memory — show master summary
        if (text === '/memory' && roomRecord?.memory_enabled && roomRecord.cmd_memory_enabled) {
          const master = await Data.memorySummary.findMasterByRoom(roomId);
          if (master) {
            emitSystemMessage(io, user.currentRoom, master.content, 'Master Summary');
          } else {
            emitSystemMessage(io, user.currentRoom, '[Memory] No master summary exists yet.');
          }
          return;
        }

        // /recall <ref_name> — fetch a specific summary
        const recallCmd = text.match(/^\/recall\s+(\S+)$/i);
        if (recallCmd && roomRecord?.memory_enabled && roomRecord.cmd_recall_enabled) {
          const summary = await Data.memorySummary.findByRoomAndRef(roomId, recallCmd[1]);
          if (summary) {
            emitSystemMessage(io, user.currentRoom, summary.content, `Recall: ${recallCmd[1]}`);
          } else {
            emitSystemMessage(io, user.currentRoom, `[Memory] No summary found for "${recallCmd[1]}".`);
          }
          return;
        }

        // /sql <SELECT query> — run read-only query on room messages
        const sqlCmd = text.match(/^\/sql\s+(SELECT.+)$/i);
        if (sqlCmd && roomRecord?.memory_enabled && roomRecord.cmd_sql_enabled) {
          const result = await executeSafeQuery(roomId, sqlCmd[1]);
          emitSystemMessage(io, user.currentRoom, result, 'SQL Result');
          return;
        }

        // /watchlist [add URL | list [watched|unwatched] | remove ID | watch ID | unwatch ID | summarize ID | recommend]
        const watchlistCmd = text.match(/^\/watchlist(?:\s+(.*))?$/i);
        if (watchlistCmd) {
          const args = (watchlistCmd[1] || '').trim();
          const parts = args.split(/\s+/);
          const sub = parts[0]?.toLowerCase() || 'list';
          const param = parts.slice(1).join(' ');

          try {
            let result: string;

            if (sub === 'add' && param) {
              result = await watchlistActions.addToWatchlist(socket.user.id, param);
            } else if (sub === 'list' || !args) {
              result = await watchlistActions.listWatchlist(socket.user.id, param || undefined);
            } else if (sub === 'remove' && param) {
              result = await watchlistActions.removeFromWatchlist(socket.user.id, param);
            } else if (sub === 'watch' && param) {
              result = await watchlistActions.markWatched(socket.user.id, param);
            } else if (sub === 'unwatch' && param) {
              result = await watchlistActions.markUnwatched(socket.user.id, param);
            } else if (sub === 'summarize' && param) {
              result = await watchlistActions.summarizeVideo(socket.user.id, param);
            } else if (sub === 'recommend') {
              result = await watchlistActions.recommendVideos(socket.user.id);
            } else {
              result = '**Usage:** `/watchlist add <URL>` | `list [watched|unwatched]` | `remove <ID>` | `watch <ID>` | `unwatch <ID>` | `summarize <ID>` ⭐ | `recommend` ⭐';
            }

            emitSystemMessage(io, user.currentRoom, result, 'Watchlist');
          } catch (err) {
            console.error('[Watchlist] Error:', err);
            emitSystemMessage(io, user.currentRoom, `[Watchlist] Error: ${(err as Error).message}`);
          }
          return;
        }
      }

      const message = broadcastMessageAction(socket.user.username, data);

      // Persist message to database (await so history is up-to-date for AI agents)
      await Data.message.create({
        content: data.text,
        type: data.type || (data.voice ? 'voice' : 'text'),
        room_id: roomId,
        author_id: socket.user.id,
        username: socket.user.username,
      });

      io.to(user.currentRoom).emit('chat_message', message);

      Data.dailyStats
        .incrementMessages(dayjs().format('YYYY-MM-DD'))
        .catch(console.error);

      // Check for YouTube URL — start watch party
      const videoId = extractYouTubeId(data.text);
      if (videoId) {
        const currentRoom = activeRooms.get(user.currentRoom);
        if (currentRoom) {
          currentRoom.watchParty = {
            videoId,
            state: 'playing',
            currentTime: 0,
            lastUpdated: Date.now(),
            startedBy: socket.user.username,
          };
          io.to(user.currentRoom).emit('watch_party_start', {
            videoId,
            startedBy: socket.user.username,
          });
          emitSystemMessage(io, user.currentRoom, `${socket.user.username} started a watch party`);
        }
      }

      // Check if message mentions an AI agent
      const agents = await Data.llmAgent.findByRoom(roomId);
      const textLower = data.text.toLowerCase();

      for (const agent of agents) {
        if (textLower.includes(agent.name.toLowerCase())) {
          await runAgentResponse(io, agent, user.currentRoom);
          break; // Only trigger one agent per message
        }
      }

      // Trigger memory summarization every 5th message (fire-and-forget)
      const msgCount = memoryMsgCounters.get(roomId) ?? 0;
      memoryMsgCounters.set(roomId, msgCount + 1);
      if ((msgCount + 1) % 5 === 0) {
        const currentRoomName = user.currentRoom;
        Data.room.findById(roomId).then((roomRecord) => {
          if (roomRecord?.memory_enabled && roomRecord.created_by) {
            const notify = (txt: string) => emitSystemMessage(io, currentRoomName, txt);
            summarizeAction.triggerSummarization(roomId, roomRecord.created_by, notify).catch(console.error);
          }
        }).catch(console.error);
      }
    });

    // ┌──────────────────────────────────────────┐
    // │ Watch Party                             │
    // └──────────────────────────────────────────┘
    socket.on('watch_party_action', (data: { action: 'play' | 'pause' | 'seek'; currentTime: number }) => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      const room = activeRooms.get(user.currentRoom);
      if (!room?.watchParty) return;

      room.watchParty.currentTime = data.currentTime;
      room.watchParty.lastUpdated = Date.now();

      if (data.action === 'play') {
        room.watchParty.state = 'playing';
        emitSystemMessage(io, user.currentRoom, `${socket.user.username} resumed at ${formatTime(data.currentTime)}`);
      } else if (data.action === 'pause') {
        room.watchParty.state = 'paused';
        emitSystemMessage(io, user.currentRoom, `${socket.user.username} paused at ${formatTime(data.currentTime)}`);
      }

      io.to(user.currentRoom).emit('watch_party_sync', {
        videoId: room.watchParty.videoId,
        state: room.watchParty.state,
        currentTime: data.currentTime,
      });
    });

    // ┌──────────────────────────────────────────┐
    // │ Screen Share (WebRTC Signaling)         │
    // └──────────────────────────────────────────┘
    socket.on('screen_share_start', () => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      socket.to(user.currentRoom).emit('screen_share_start', {
        sharerId: socket.user.id,
        sharerUsername: socket.user.username,
      });
      emitSystemMessage(io, user.currentRoom, `${socket.user.username} started sharing their screen`);
    });

    socket.on('screen_share_stop', () => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      socket.to(user.currentRoom).emit('screen_share_stop', {
        sharerId: socket.user.id,
      });
      emitSystemMessage(io, user.currentRoom, `${socket.user.username} stopped sharing their screen`);
    });

    socket.on('join_screen_share', (data: { sharerId: string }) => {
      // Viewer wants to join — tell the sharer to create a peer connection
      const sharerUser = findByUserId(data.sharerId);
      if (!sharerUser) return;
      const sharerSocket = io.sockets.sockets.get(sharerUser.socketId);
      if (sharerSocket) {
        sharerSocket.emit('screen_share_viewer_joined', {
          viewerId: socket.user.id,
          viewerUsername: socket.user.username,
        });
      }
    });

    socket.on('webrtc_offer', (data: { targetUserId: string; offer: Record<string, unknown> }) => {
      const target = findByUserId(data.targetUserId);
      if (!target) return;
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit('webrtc_offer', {
          fromUserId: socket.user.id,
          offer: data.offer,
        });
      }
    });

    socket.on('webrtc_answer', (data: { targetUserId: string; answer: Record<string, unknown> }) => {
      const target = findByUserId(data.targetUserId);
      if (!target) return;
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit('webrtc_answer', {
          fromUserId: socket.user.id,
          answer: data.answer,
        });
      }
    });

    socket.on('webrtc_ice_candidate', (data: { targetUserId: string; candidate: Record<string, unknown> }) => {
      const target = findByUserId(data.targetUserId);
      if (!target) return;
      const targetSocket = io.sockets.sockets.get(target.socketId);
      if (targetSocket) {
        targetSocket.emit('webrtc_ice_candidate', {
          fromUserId: socket.user.id,
          candidate: data.candidate,
        });
      }
    });

    socket.on('watch_party_end', () => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      const room = activeRooms.get(user.currentRoom);
      if (!room?.watchParty) return;

      room.watchParty = null;
      io.to(user.currentRoom).emit('watch_party_end', {});
      emitSystemMessage(io, user.currentRoom, `${socket.user.username} ended the watch party`);
    });

    // ┌──────────────────────────────────────────┐
    // │ Voice Streaming                         │
    // └──────────────────────────────────────────┘
    socket.on('voice_stream_start', (data: { sessionId: string; voiceId: string }) => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      socket.to(user.currentRoom).emit('voice_stream_start', {
        sessionId: data.sessionId,
        username: socket.user.username,
        speakerId: socket.user.id,
      });
    });

    socket.on('voice_chunk', async (data: { sessionId: string; chunkIndex: number; text: string; voiceId: string }) => {
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
    });

    socket.on('voice_stream_end', (data: { sessionId: string }) => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      socket.to(user.currentRoom).emit('voice_stream_end', {
        sessionId: data.sessionId,
        speakerId: socket.user.id,
      });
    });

    // ┌──────────────────────────────────────────┐
    // │ Create Room                             │
    // └──────────────────────────────────────────┘
    socket.on('create_room', async (data: { roomName: string; password?: string }) => {
      const { roomName, password } = data;
      const normalizedName = roomName.trim().toLowerCase();

      if (!validateRoomName(roomName)) {
        socket.emit('room_created', { success: false, error: 'Invalid room name (3-30 chars, alphanumeric only)' });
        return;
      }

      if (activeRooms.has(normalizedName)) {
        socket.emit('room_created', { success: false, error: 'Room already exists' });
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
        watchParty: null,
      });

      // Auto-add creator as member
      await Data.roomMember.addMember(dbRoom.id, socket.user.id);

      await joinRoom(socket, normalizedName);

      // Save last room
      Data.user.updateLastRoom(socket.user.id, dbRoom.id).catch(console.error);

      socket.emit('room_created', { success: true, roomName: normalizedName });

      // New room — no history
      socket.emit('room_joined', {
        roomName: roomName.trim(),
        users: getRoomUsers(normalizedName),
        messages: [],
        watchParty: null,
      });

      io.emit('room_list_update', { rooms: getRoomList() });
    });

    // ┌──────────────────────────────────────────┐
    // │ Join Room                               │
    // └──────────────────────────────────────────┘
    socket.on('join_room', async (data: { roomName: string; password?: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);

      if (!room) {
        socket.emit('room_join_error', { error: 'Room does not exist' });
        return;
      }

      // Check if user is banned from this room
      const membership = await Data.roomMember.findByRoomAndUser(room.id, socket.user.id);
      if (membership?.role === 'banned') {
        socket.emit('room_join_error', { error: 'You are banned from this room' });
        return;
      }

      // If room has a password and user is NOT already a member, require password
      if (room.passwordHash && (!membership || membership.role !== 'member')) {
        if (!data.password) {
          socket.emit('room_join_error', { error: 'Password required' });
          return;
        }

        const valid = await passwordHelper.verifyPassword(data.password, room.passwordHash);
        if (!valid) {
          socket.emit('room_join_error', { error: 'Incorrect password' });
          return;
        }

        // Password correct — add as member so they don't need it again
        await Data.roomMember.addMember(room.id, socket.user.id);
      }

      await joinRoom(socket, normalizedName);

      // Save last room
      Data.user.updateLastRoom(socket.user.id, room.id).catch(console.error);

      const joinHistory = await Data.message.findByRoom(room.id, 50);
      const jwp = room.watchParty;
      socket.emit('room_joined', {
        roomName: room.displayName,
        users: getRoomUsers(normalizedName),
        messages: formatHistoryForClient(joinHistory.reverse()),
        watchParty: jwp ? { videoId: jwp.videoId, state: jwp.state, currentTime: getEffectiveTime(jwp) } : null,
      });

      io.emit('room_list_update', { rooms: getRoomList() });
    });

    // ┌──────────────────────────────────────────┐
    // │ Switch Room                             │
    // └──────────────────────────────────────────┘
    socket.on('switch_room', async (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);

      if (!room) {
        socket.emit('room_join_error', { error: 'Room does not exist' });
        return;
      }

      // For password-protected rooms, check membership (or if it's public)
      if (normalizedName !== 'public' && room.passwordHash) {
        const membership = await Data.roomMember.findByRoomAndUser(room.id, socket.user.id);
        if (!membership || membership.role === 'banned') {
          socket.emit('room_join_error', { error: 'Password required for this room' });
          return;
        }
      }

      await joinRoom(socket, normalizedName);

      // Save last room
      Data.user.updateLastRoom(socket.user.id, room.id).catch(console.error);

      const switchHistory = await Data.message.findByRoom(room.id, 50);
      const swp = room.watchParty;
      socket.emit('room_joined', {
        roomName: room.displayName,
        users: getRoomUsers(normalizedName),
        messages: formatHistoryForClient(switchHistory.reverse()),
        watchParty: swp ? { videoId: swp.videoId, state: swp.state, currentTime: getEffectiveTime(swp) } : null,
      });

      io.emit('room_list_update', { rooms: getRoomList() });
    });

    // ┌──────────────────────────────────────────┐
    // │ AI Agents                               │
    // └──────────────────────────────────────────┘
    socket.on('create_agent', async (data: {
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
    }) => {
      const normalizedRoom = data.roomName.toLowerCase();
      const roomId = getRoomId(normalizedRoom);

      if (!roomId) {
        socket.emit('agent_error', { error: 'Room not found' });
        return;
      }

      if (!data.name || data.name.length < 1 || data.name.length > 30) {
        socket.emit('agent_error', { error: 'Agent name must be 1-30 characters' });
        return;
      }

      const count = await Data.llmAgent.countByRoom(roomId);
      if (count >= 3) {
        socket.emit('agent_error', { error: 'Maximum 3 agents per room' });
        return;
      }

      const agent = await Data.llmAgent.create({
        name: data.name,
        room_id: roomId,
        creator_id: socket.user.id,
        voice_id: data.voiceId || 'female',
        model: data.model || undefined,
        system_instructions: data.systemInstructions || undefined,
        memories: data.memories || undefined,
        autopilot_enabled: data.autopilotEnabled || false,
        autopilot_interval: data.autopilotInterval || 300,
        autopilot_prompts: data.autopilotPrompts || undefined,
      });

      if (agent.autopilot_enabled) {
        startAutopilotTimer(io, agent);
      }

      io.to(normalizedRoom).emit('agent_created', agent);
    });

    socket.on('update_agent', async (data: {
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
    }) => {
      const agent = await Data.llmAgent.findById(data.agentId);
      if (!agent) {
        socket.emit('agent_error', { error: 'Agent not found' });
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
      });

      // Restart or stop autopilot timer
      stopAutopilotTimer(updated.id);
      if (updated.autopilot_enabled) {
        startAutopilotTimer(io, updated);
      }

      // Find the room name key for this room_id to emit to the right socket.io room
      const roomEntry = Array.from(activeRooms.entries()).find(([, r]) => r.id === agent.room_id);
      if (roomEntry) {
        io.to(roomEntry[0]).emit('agent_updated', updated);
      }
    });

    socket.on('delete_agent', async (data: { agentId: string }) => {
      const agent = await Data.llmAgent.findById(data.agentId);
      if (!agent) {
        socket.emit('agent_error', { error: 'Agent not found' });
        return;
      }

      stopAutopilotTimer(data.agentId);
      await Data.llmAgent.remove(data.agentId);

      const roomEntry = Array.from(activeRooms.entries()).find(([, r]) => r.id === agent.room_id);
      if (roomEntry) {
        io.to(roomEntry[0]).emit('agent_deleted', { agentId: data.agentId });
      }
    });

    socket.on('get_room_agents', async (data: { roomName: string }) => {
      const roomId = getRoomId(data.roomName.toLowerCase());
      if (!roomId) {
        socket.emit('room_agents', { roomName: data.roomName, agents: [] });
        return;
      }
      const agents = await Data.llmAgent.findByRoom(roomId);
      socket.emit('room_agents', { roomName: data.roomName, agents });
    });

    // ┌──────────────────────────────────────────┐
    // │ Room Memory                             │
    // └──────────────────────────────────────────┘
    socket.on('get_room_memory', async (data: { roomName: string }) => {
      const roomId = getRoomId(data.roomName.toLowerCase());
      if (!roomId) {
        socket.emit('room_memory_status', { enabled: false, cmdRecall: true, cmdSql: true, cmdMemory: true, cmdSelfmod: true, cmdAutopilot: true, cmdWeb: true, cmdMentions: true, cmdTerminal: false, cmdClaude: false, cmdSchedule: false, cmdTokens: true, cmdModeration: false, cmdThink: true, cmdEffort: true, cmdAudit: true, cmdContinue: true, maxLoops: 5 });
        return;
      }
      const roomRecord = await Data.room.findById(roomId);
      socket.emit('room_memory_status', {
        enabled: roomRecord?.memory_enabled ?? false,
        cmdRecall: roomRecord?.cmd_recall_enabled ?? true,
        cmdSql: roomRecord?.cmd_sql_enabled ?? true,
        cmdMemory: roomRecord?.cmd_memory_enabled ?? true,
        cmdSelfmod: roomRecord?.cmd_selfmod_enabled ?? true,
        cmdAutopilot: roomRecord?.cmd_autopilot_enabled ?? true,
        cmdWeb: roomRecord?.cmd_web_enabled ?? true,
        cmdMentions: roomRecord?.cmd_mentions_enabled ?? true,
        cmdTerminal: roomRecord?.cmd_terminal_enabled ?? false,
        cmdClaude: roomRecord?.cmd_claude_enabled ?? false,
        cmdSchedule: roomRecord?.cmd_schedule_enabled ?? false,
        cmdTokens: roomRecord?.cmd_tokens_enabled ?? true,
        cmdModeration: roomRecord?.cmd_moderation_enabled ?? false,
        cmdThink: roomRecord?.cmd_think_enabled ?? true,
        cmdEffort: roomRecord?.cmd_effort_enabled ?? true,
        cmdAudit: roomRecord?.cmd_audit_enabled ?? true,
        cmdContinue: roomRecord?.cmd_continue_enabled ?? true,
        maxLoops: roomRecord?.max_loops ?? 5,
      });
    });

    socket.on('get_room_summaries', async (data: { roomName: string }) => {
      const roomId = getRoomId(data.roomName.toLowerCase());
      if (!roomId) {
        socket.emit('room_summaries', { summaries: [] });
        return;
      }
      const room = activeRooms.get(data.roomName.toLowerCase());
      if (room && room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit('room_summaries', { summaries: [] });
        return;
      }
      const summaries = await Data.memorySummary.findAllByRoom(roomId);
      socket.emit('room_summaries', {
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

    socket.on('update_room_commands', async (data: {
      roomName: string;
      cmdRecall?: boolean;
      cmdSql?: boolean;
      cmdMemory?: boolean;
      cmdSelfmod?: boolean;
      cmdAutopilot?: boolean;
      cmdWeb?: boolean;
      cmdMentions?: boolean;
      cmdTerminal?: boolean;
      cmdClaude?: boolean;
      cmdSchedule?: boolean;
      cmdTokens?: boolean;
      cmdModeration?: boolean;
      cmdThink?: boolean;
      cmdEffort?: boolean;
      cmdAudit?: boolean;
      cmdContinue?: boolean;
      maxLoops?: number;
    }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);
      if (!room) return;

      if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit('agent_error', { error: 'Only the room creator can change command settings' });
        return;
      }

      await Data.room.updateCommandSettings(room.id, {
        cmd_recall_enabled: data.cmdRecall,
        cmd_sql_enabled: data.cmdSql,
        cmd_memory_enabled: data.cmdMemory,
        cmd_selfmod_enabled: data.cmdSelfmod,
        cmd_autopilot_enabled: data.cmdAutopilot,
        cmd_web_enabled: data.cmdWeb,
        cmd_mentions_enabled: data.cmdMentions,
        cmd_terminal_enabled: data.cmdTerminal,
        cmd_claude_enabled: data.cmdClaude,
        cmd_schedule_enabled: data.cmdSchedule,
        cmd_tokens_enabled: data.cmdTokens,
        cmd_moderation_enabled: data.cmdModeration,
        cmd_think_enabled: data.cmdThink,
        cmd_effort_enabled: data.cmdEffort,
        cmd_audit_enabled: data.cmdAudit,
        cmd_continue_enabled: data.cmdContinue,
        max_loops: data.maxLoops !== undefined ? Math.max(3, Math.min(20, data.maxLoops)) : undefined,
      });

      io.to(normalizedName).emit('room_commands_updated', {
        cmdRecall: data.cmdRecall,
        cmdSql: data.cmdSql,
        cmdMemory: data.cmdMemory,
        cmdSelfmod: data.cmdSelfmod,
        cmdAutopilot: data.cmdAutopilot,
        cmdWeb: data.cmdWeb,
        cmdMentions: data.cmdMentions,
        cmdTerminal: data.cmdTerminal,
        cmdClaude: data.cmdClaude,
        cmdSchedule: data.cmdSchedule,
        cmdTokens: data.cmdTokens,
        cmdModeration: data.cmdModeration,
        cmdThink: data.cmdThink,
        cmdEffort: data.cmdEffort,
        cmdAudit: data.cmdAudit,
        cmdContinue: data.cmdContinue,
        maxLoops: data.maxLoops,
      });
    });

    // ┌──────────────────────────────────────────┐
    // │ Terminal Approval                        │
    // └──────────────────────────────────────────┘
    socket.on('terminal_approval', (data: { approvalId: string; approved: boolean }) => {
      const pending = pendingApprovals.get(data.approvalId);
      if (!pending) return;

      // Only the creator can approve
      if (socket.user.id !== pending.creatorId) {
        socket.emit('agent_error', { error: 'Only the room creator can approve terminal commands' });
        return;
      }

      clearTimeout(pending.timeout);
      pending.resolve(data.approved);
      pendingApprovals.delete(data.approvalId);
    });

    // ┌──────────────────────────────────────────┐
    // │ Machine Management                       │
    // └──────────────────────────────────────────┘
    socket.on('machine_register', async (data: { name: string; os?: string; version?: string }) => {
      const machineName = data.name.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      if (!machineName || machineName.length < 1 || machineName.length > 50) {
        socket.emit('machine_error', { error: 'Machine name must be 1-50 characters (lowercase alphanumeric and hyphens)' });
        return;
      }

      let machineRecord = await Data.machine.findByOwnerAndName(socket.user.id, machineName);

      if (machineRecord) {
        // Update existing machine
        machineRecord = await Data.machine.update(machineRecord.id, {
          socket_id: socket.id,
          status: 'online',
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
          status: 'online',
          last_seen: new Date(),
        });
      }

      socket.emit('machine_registered', { id: machineRecord.id, name: machineName, status: 'online' });
      console.log(`[Machine] ${socket.user.username}/${machineName} registered (${data.os || 'unknown OS'}, v${data.version || 'unknown'})`);

      // Check agent version and request update if outdated
      // Only request update if server version is NEWER (not equal or older)
      const isNewer = (server: string, client: string): boolean => {
        const s = server.split('.').map(Number);
        const c = client.split('.').map(Number);
        for (let i = 0; i < Math.max(s.length, c.length); i++) {
          if ((s[i] || 0) > (c[i] || 0)) return true;
          if ((s[i] || 0) < (c[i] || 0)) return false;
        }
        return false;
      };
      if (data.version && expectedAgentVersion !== 'unknown' && isNewer(expectedAgentVersion, data.version)) {
        const osStr = (data.os || '').toLowerCase();
        const agentPlatform = osStr.includes('win32') ? 'win' : osStr.includes('darwin') ? 'macos' : 'linux';
        const serverUrl = process.env.CLIENT_URL || 'https://commslink.net';
        const downloadUrl = `${serverUrl}/api/v1/terminal/download/${agentPlatform}`;
        console.log(`[Machine] ${machineName} has v${data.version}, expected v${expectedAgentVersion} — requesting update`);
        socket.emit('update_required', { currentVersion: data.version, newVersion: expectedAgentVersion, downloadUrl });
      }

      // Listen for debug events from the agent's Claude PTY collection
      socket.on('claude_debug', (debugData: { execId: string; phase: string; stripped?: string; choice?: string; approvalCount?: number }) => {
        console.log(`[claude_debug] ${machineName} phase=${debugData.phase} execId=${debugData.execId}${debugData.choice ? ` choice=${debugData.choice}` : ''}`);
        if (debugData.stripped) {
          console.log(`[claude_debug] Stripped tail: ${debugData.stripped.substring(0, 300)}`);
        }
        Data.claudeLog.create({
          direction: 'debug',
          session_key: debugData.execId,
          machine_name: machineName,
          username: socket.user.username,
          room_name: 'system',
          content: JSON.stringify(debugData).substring(0, 4000),
        }).catch(() => {});
      });

      // Listen for /btw status updates from Claude PTY and post to chat
      socket.on('claude_btw_status', (statusData: { execId: string; status: string; elapsedSeconds: number }) => {
        console.log(`[claude_btw] ${machineName} at ${statusData.elapsedSeconds}s: ${statusData.status.substring(0, 200)}`);
        // Find which room the user is in
        const user = connectedUsers.get(socket.id);
        const rn = user?.currentRoom || 'public';
        const elapsed = statusData.elapsedSeconds;
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const timeStr = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;
        emitSystemMessage(io, rn, `[Claude ${machineName} status @ ${timeStr}]: ${statusData.status.substring(0, 2000)}`, undefined, 'claude-response');
        emitPanelLog(io, rn, 'claude', 'status', `[${timeStr}] ${statusData.status.substring(0, 2000)}`, machineName);
      });

      // Auto-grant permission in all rooms owned by this user
      for (const [roomName, room] of activeRooms.entries()) {
        if (room.createdBy === socket.user.id && room.id) {
          const existing = await Data.machinePermission.findByMachineAndRoom(machineRecord.id, room.id);
          if (!existing) {
            await Data.machinePermission.upsert(machineRecord.id, room.id, true);
            console.log(`[Machine] Auto-granted ${machineName} permission in room "${roomName}"`);
          }
        }
      }

      // Notify all of this user's browser sessions about the updated machines list
      const updatedMachines = await Data.machine.findByOwner(socket.user.id);
      for (const [sid, userData] of connectedUsers.entries()) {
        if (userData.userId === socket.user.id) {
          const browserSocket = io.sockets.sockets.get(sid);
          if (browserSocket) {
            browserSocket.emit('machines_list', { machines: updatedMachines });
          }
        }
      }
    });

    socket.on('get_machines', async () => {
      const machines = await Data.machine.findByOwner(socket.user.id);
      socket.emit('machines_list', { machines });
    });

    socket.on('get_panel_logs', async (data: { tab: 'terminal' | 'claude' }) => {
      const user = connectedUsers.get(socket.id);
      const roomId = user?.currentRoom ? getRoomId(user.currentRoom) : undefined;
      if (!roomId) {
        socket.emit('panel_logs', { tab: data.tab, entries: [] });
        return;
      }
      const rows = await Data.panelLog.findRecent(roomId, data.tab, 150);
      const entries = rows.map((r: { entry_type: string; text: string; machine: string | null; created_at: Date }) => ({
        type: r.entry_type,
        text: r.text,
        machine: r.machine,
        timestamp: r.created_at.getTime(),
      }));
      socket.emit('panel_logs', { tab: data.tab, entries });
    });

    socket.on('delete_machine', async (data: { machineId: string }) => {
      const machineRecord = await Data.machine.findById(data.machineId);
      if (!machineRecord || machineRecord.owner_id !== socket.user.id) {
        socket.emit('machine_error', { error: 'Machine not found or not owned by you' });
        return;
      }
      await Data.machine.remove(data.machineId);
      socket.emit('machine_deleted', { machineId: data.machineId });
    });

    socket.on('update_machine_permission', async (data: { machineId: string; roomName: string; enabled: boolean }) => {
      const machineRecord = await Data.machine.findById(data.machineId);
      if (!machineRecord || machineRecord.owner_id !== socket.user.id) {
        socket.emit('machine_error', { error: 'Machine not found or not owned by you' });
        return;
      }

      const normalizedRoom = data.roomName.toLowerCase();
      const roomId = getRoomId(normalizedRoom);
      if (!roomId) {
        socket.emit('machine_error', { error: 'Room not found' });
        return;
      }

      await Data.machinePermission.upsert(machineRecord.id, roomId, data.enabled);
      socket.emit('machine_permission_updated', { machineId: data.machineId, roomName: data.roomName, enabled: data.enabled });
    });

    socket.on('get_room_machines', async (data: { roomName: string }) => {
      const normalizedRoom = data.roomName.toLowerCase();
      const roomId = getRoomId(normalizedRoom);
      if (!roomId) {
        socket.emit('room_machines', { machines: [], ownedMachines: [] });
        return;
      }
      const permissions = await Data.machinePermission.findByRoom(roomId);
      // Also send the user's own machines so they can add them to the room
      const ownedMachines = await Data.machine.findByOwner(socket.user.id);
      socket.emit('room_machines', { machines: permissions, ownedMachines });
    });

    // ┌──────────────────────────────────────────┐
    // │ Terminal / Claude Panel Input            │
    // └──────────────────────────────────────────┘

    socket.on('terminal_panel_input', async (data: { machineName: string; command: string }) => {
      const machineRecord = await Data.machine.findByOwnerAndName(socket.user.id, data.machineName);
      if (!machineRecord || machineRecord.status !== 'online' || !machineRecord.socket_id) {
        socket.emit('terminal_panel_output', { machineName: data.machineName, output: 'Error: Machine not found or offline.', isError: true });
        return;
      }

      // Emit to chat as system message so AI can see it
      const user = connectedUsers.get(socket.id);
      if (user?.currentRoom) {
        const roomId = getRoomId(user.currentRoom);
        if (roomId) {
          emitSystemMessage(io, user.currentRoom, `[${socket.user.username} terminal → ${data.machineName}]: ${data.command}`, undefined, 'terminal');
          emitPanelLog(io, user.currentRoom, 'terminal', 'command', `[${socket.user.username} → ${data.machineName}] ${data.command}`, data.machineName);
        }
      }

      try {
        const output = await executeTerminalCommand(io, machineRecord.socket_id, data.command, 30_000, data.machineName, user?.currentRoom);
        socket.emit('terminal_panel_output', { machineName: data.machineName, output });

        if (user?.currentRoom) {
          emitSystemMessage(io, user.currentRoom, `[Terminal ${data.machineName}]:\n${output.substring(0, 2000)}`, undefined, 'terminal');
          emitPanelLog(io, user.currentRoom, 'terminal', 'output', output.substring(0, 2000), data.machineName);
        }
      } catch (err) {
        socket.emit('terminal_panel_output', { machineName: data.machineName, output: `Error: ${(err as Error).message}`, isError: true });
      }
    });

    // ── Claude Panel Sessions (Conversational) ──
    // Routes user input to the running Claude PTY on the terminal agent.
    // Output streams back in real-time via claude_terminal_data events.

    // Track which machine sockets we've attached listeners to (by socket ID)
    const claudePtyListeners = new Set<string>();

    socket.on('claude_panel_input', async (data: { machineName: string; input: string; approved?: boolean }) => {
      console.log(`[claude_panel] Received input from ${socket.user.username}: "${data.input.substring(0, 100)}" machine=${data.machineName}`);

      const machineRecord = await Data.machine.findByOwnerAndName(socket.user.id, data.machineName);
      if (!machineRecord || machineRecord.status !== 'online' || !machineRecord.socket_id) {
        console.log(`[claude_panel] Machine not found/offline: ${data.machineName}`);
        socket.emit('claude_panel_output', { machineName: data.machineName, data: 'Error: Machine not found or offline.\r\n' });
        return;
      }

      const machineSocket = io.sockets.sockets.get(machineRecord.socket_id);
      if (!machineSocket) {
        console.log(`[claude_panel] Machine socket not found for socket_id=${machineRecord.socket_id}`);
        socket.emit('claude_panel_output', { machineName: data.machineName, data: 'Error: Machine socket not found.\r\n' });
        return;
      }

      const user = connectedUsers.get(socket.id);
      const roomName = user?.currentRoom || 'public';
      const roomId = getRoomId(roomName);
      const sessionKey = `${socket.id}:${data.machineName}`;

      // Log to database
      Data.claudeLog.create({
        direction: 'user_to_claude',
        session_key: sessionKey,
        machine_name: data.machineName,
        username: socket.user.username,
        room_name: roomName,
        content: data.input,
      }).catch(() => {});

      // Set up PTY output listener on this machine socket (once per machine socket ID)
      const listenerKey = machineRecord.socket_id;
      if (!claudePtyListeners.has(listenerKey)) {
        claudePtyListeners.add(listenerKey);
        console.log(`[claude_panel] Setting up PTY listeners on machine socket ${listenerKey}`);

        // PTY output mirror — raw terminal data from the interactive Claude session
        machineSocket.on('claude_terminal_data', (out: { machineName: string; data: string }) => {
          // Log first 200 chars of each chunk
          console.log(`[claude_panel] PTY data from ${out.machineName}: ${out.data.length} bytes`);

          // Log to database (truncated)
          Data.claudeLog.create({
            direction: 'claude_to_user',
            session_key: `pty:${out.machineName}`,
            machine_name: out.machineName,
            username: socket.user.username,
            room_name: roomName,
            content: out.data.substring(0, 2000),
          }).catch(() => {});

          socket.emit('claude_panel_output', { machineName: out.machineName, data: out.data });
        });

        // Also listen for session-level events (echo, done, etc.)
        machineSocket.on('claude_session_output', (out: { sessionKey: string; data: string }) => {
          console.log(`[claude_panel] Session output: sessionKey=${out.sessionKey} ${out.data.length} bytes`);
          socket.emit('claude_panel_output', { machineName: data.machineName, data: out.data });
        });

        // Listen for collected responses (/copy clipboard result) — post to chat
        machineSocket.on('claude_pty_response', (out: { output: string; exitCode: number }) => {
          console.log(`[claude_panel] PTY response (clipboard): ${out.output.length} chars`);
          if (out.output && out.output !== '(no response captured)') {
            const user2 = connectedUsers.get(socket.id);
            const rn = user2?.currentRoom || 'public';
            emitSystemMessage(io, rn, `[Claude → ${data.machineName} response]:\n${out.output.substring(0, 4000)}`, undefined, 'claude-response');
            emitPanelLog(io, rn, 'claude', 'response', out.output.substring(0, 4000), data.machineName);

            Data.claudeLog.create({
              direction: 'claude_response',
              session_key: `response:${data.machineName}`,
              machine_name: data.machineName,
              username: socket.user.username,
              room_name: rn,
              content: out.output.substring(0, 4000),
            }).catch(() => {});
          }
        });
      }

      // Send input to the agent PTY — use collectResponse so /copy captures the response
      const panelExecId = `panel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      console.log(`[claude_panel] Emitting claude_session_input to agent: sessionKey=${sessionKey} execId=${panelExecId}`);
      machineSocket.emit('claude_session_input', {
        sessionKey,
        input: data.input,
        approved: data.approved,
        collectResponse: true,
        execId: panelExecId,
      });

      if (roomId) {
        emitSystemMessage(io, roomName, `[${socket.user.username} claude → ${data.machineName}]: ${data.input}`, undefined, 'claude-prompt');
        emitPanelLog(io, roomName, 'claude', 'prompt', `[${socket.user.username} → ${data.machineName}] ${data.input}`, data.machineName);
      }
    });

    socket.on('claude_panel_stop', async (data: { machineName: string }) => {
      const machineRecord = await Data.machine.findByOwnerAndName(socket.user.id, data.machineName);
      if (!machineRecord || !machineRecord.socket_id) return;

      const machineSocket = io.sockets.sockets.get(machineRecord.socket_id);
      if (!machineSocket) return;

      machineSocket.emit('claude_session_stop');
    });

    socket.on('room_alarm', (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      if (!activeRooms.has(normalizedName)) return;
      io.to(normalizedName).emit('trigger_alarm', {
        message: `${socket.user.username} is trying to get your attention!`,
        agentName: socket.user.username,
      });
      emitSystemMessage(io, normalizedName, `[${socket.user.username} sounded the alarm!]`);
    });

    socket.on('clear_chat', async (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);
      if (!room) return;

      if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit('agent_error', { error: 'Only the room creator or admin can clear chat' });
        return;
      }

      const count = await Data.message.archiveByRoom(room.id);
      console.log(`[ClearChat] Archived ${count} messages in room ${normalizedName}`);
      io.to(normalizedName).emit('chat_cleared');
    });

    socket.on('toggle_memory', async (data: { roomName: string; enabled: boolean }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);
      if (!room) {
        socket.emit('agent_error', { error: 'Room not found' });
        return;
      }

      // Only room creator or admin can toggle
      if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit('agent_error', { error: 'Only the room creator can toggle memory' });
        return;
      }

      // Room creator can toggle memory (no premium requirement)
      const creator = await Data.user.findById(socket.user.id);
      if (!creator) {
        socket.emit('agent_error', { error: 'User not found' });
        return;
      }

      await Data.room.updateMemoryEnabled(room.id, data.enabled);
      io.to(normalizedName).emit('memory_toggled', { roomName: normalizedName, enabled: data.enabled });

      // Immediately check if summarization is needed
      if (data.enabled) {
        const notify = (text: string) => emitSystemMessage(io, normalizedName, text);
        summarizeAction.triggerSummarization(room.id, socket.user.id, notify, true).catch(console.error);
      }
    });

    // ┌──────────────────────────────────────────┐
    // │ Delete Room                             │
    // └──────────────────────────────────────────┘
    socket.on('delete_room', async (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();

      if (normalizedName === 'public') {
        socket.emit('room_join_error', { error: 'Cannot delete the public room' });
        return;
      }

      const room = activeRooms.get(normalizedName);
      if (!room) {
        socket.emit('room_join_error', { error: 'Room does not exist' });
        return;
      }

      // Only creator or admin can delete
      if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit('room_join_error', { error: 'Only the room creator or an admin can delete this room' });
        return;
      }

      const publicRoomId = getRoomId('public');

      // Move all users in that room to public
      for (const sid of room.users) {
        const u = connectedUsers.get(sid);
        if (u) {
          const userSocket = io.sockets.sockets.get(u.socketId);
          if (userSocket) {
            userSocket.leave(normalizedName);
            userSocket.join('public');
            const pubRoom = activeRooms.get('public');
            if (pubRoom) pubRoom.users.add(sid);
            u.currentRoom = 'public';

            if (publicRoomId) {
              const history = await Data.message.findByRoom(publicRoomId, 50);
              const pwp = activeRooms.get('public')?.watchParty;
              userSocket.emit('room_joined', {
                roomName: 'Public',
                users: getRoomUsers('public'),
                messages: formatHistoryForClient(history.reverse()),
                watchParty: pwp ? { videoId: pwp.videoId, state: pwp.state, currentTime: getEffectiveTime(pwp) } : null,
              });
            }
          }
        }
      }

      // Remove from memory and DB
      activeRooms.delete(normalizedName);
      Data.room.deleteByName(normalizedName).catch(console.error);

      io.emit('room_list_update', { rooms: getRoomList() });
    });

    // ┌──────────────────────────────────────────┐
    // │ Room Membership (kick / ban / unban)   │
    // └──────────────────────────────────────────┘
    socket.on('get_room_members', async (data: { roomName: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);
      if (!room) return;

      const members = await Data.roomMember.findByRoom(room.id);
      socket.emit('room_members', {
        roomName: normalizedName,
        members: members.map((m) => ({
          userId: m.user_id,
          username: m.user.username,
          role: m.role,
        })),
      });
    });

    socket.on('kick_member', async (data: { roomName: string; userId: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);
      if (!room) return;

      // Only creator or admin can kick
      if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit('room_join_error', { error: 'Only the room creator or an admin can kick users' });
        return;
      }

      // Remove membership
      await Data.roomMember.removeMember(room.id, data.userId);

      // Find their sockets and move to public
      for (const [sid, u] of connectedUsers.entries()) {
        if (u.userId === data.userId && u.currentRoom === normalizedName) {
          const targetSocket = io.sockets.sockets.get(sid);
          if (targetSocket) {
            room.users.delete(sid);
            targetSocket.leave(normalizedName);
            targetSocket.join('public');
            const pubRoom = activeRooms.get('public');
            if (pubRoom) pubRoom.users.add(sid);
            u.currentRoom = 'public';

            const publicRoomId = getRoomId('public');
            if (publicRoomId) {
              const history = await Data.message.findByRoom(publicRoomId, 50);
              const pwp = activeRooms.get('public')?.watchParty;
              targetSocket.emit('room_joined', {
                roomName: 'Public',
                users: getRoomUsers('public'),
                messages: formatHistoryForClient(history.reverse()),
                watchParty: pwp ? { videoId: pwp.videoId, state: pwp.state, currentTime: getEffectiveTime(pwp) } : null,
              });
            }
            targetSocket.emit('room_join_error', { error: 'You have been kicked from the room' });
          }
        }
      }

      emitSystemMessage(io, normalizedName, `[System] ${data.userId} was kicked from the room.`);
      io.emit('room_list_update', { rooms: getRoomList() });
    });

    socket.on('ban_member', async (data: { roomName: string; userId: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);
      if (!room) return;

      if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit('room_join_error', { error: 'Only the room creator or an admin can ban users' });
        return;
      }

      // Set role to banned
      await Data.roomMember.addMember(room.id, data.userId, 'banned');

      // Find their sockets and move to public
      for (const [sid, u] of connectedUsers.entries()) {
        if (u.userId === data.userId && u.currentRoom === normalizedName) {
          const targetSocket = io.sockets.sockets.get(sid);
          if (targetSocket) {
            room.users.delete(sid);
            targetSocket.leave(normalizedName);
            targetSocket.join('public');
            const pubRoom = activeRooms.get('public');
            if (pubRoom) pubRoom.users.add(sid);
            u.currentRoom = 'public';

            const publicRoomId = getRoomId('public');
            if (publicRoomId) {
              const history = await Data.message.findByRoom(publicRoomId, 50);
              const pwp = activeRooms.get('public')?.watchParty;
              targetSocket.emit('room_joined', {
                roomName: 'Public',
                users: getRoomUsers('public'),
                messages: formatHistoryForClient(history.reverse()),
                watchParty: pwp ? { videoId: pwp.videoId, state: pwp.state, currentTime: getEffectiveTime(pwp) } : null,
              });
            }
            targetSocket.emit('room_join_error', { error: 'You have been banned from this room' });
          }
        }
      }

      emitSystemMessage(io, normalizedName, `[System] A user was banned from the room.`);
      io.emit('room_list_update', { rooms: getRoomList() });
    });

    socket.on('unban_member', async (data: { roomName: string; userId: string }) => {
      const normalizedName = data.roomName.toLowerCase();
      const room = activeRooms.get(normalizedName);
      if (!room) return;

      if (room.createdBy !== socket.user.id && !socket.user.is_admin) {
        socket.emit('room_join_error', { error: 'Only the room creator or an admin can unban users' });
        return;
      }

      await Data.roomMember.removeMember(room.id, data.userId);
      socket.emit('room_join_error', { error: 'User has been unbanned' });
    });

    // ┌──────────────────────────────────────────┐
    // │ Spending Estimate                       │
    // └──────────────────────────────────────────┘
    socket.on('get_spending_estimate', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const byService = await Data.creditUsageLog.sumCostByServiceSince(socket.user.id, oneHourAgo);
      const spending: Record<string, number> = { grok: 0, elevenlabs: 0, claude: 0, ec2: 0 };
      for (const entry of byService) {
        if (entry.service === 'grok') spending.grok = entry.total_cost_usd;
        else if (entry.service === 'elevenlabs') spending.elevenlabs = entry.total_cost_usd;
        else if (entry.service === 'claude') spending.claude = entry.total_cost_usd;
        else if (entry.service === 'ec2') spending.ec2 = entry.total_cost_usd;
      }
      socket.emit('spending_estimate', spending);
    });

    // ┌──────────────────────────────────────────┐
    // │ Hologram Avatars                        │
    // └──────────────────────────────────────────┘

    socket.on('hologram_create', async (data: { label: string; skeleton: unknown; points: unknown; physics?: boolean }) => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      const roomId = getRoomId(user.currentRoom);
      if (!roomId) return;

      try {
        const avatar = await createAvatarAction({
          roomId,
          userId: socket.user.id,
          label: data.label,
          skeleton: data.skeleton,
          points: data.points,
          physics: data.physics,
        });

        io.to(user.currentRoom).emit('hologram_spawned', {
          id: avatar.id,
          userId: socket.user.id,
          username: socket.user.username,
          label: avatar.label,
          skeleton: avatar.skeleton,
          points: avatar.points,
          pose: avatar.pose,
          physics: avatar.physics,
        });
      } catch (err) {
        socket.emit('agent_error', { error: `Hologram create failed: ${(err as Error).message}` });
      }
    });

    socket.on('hologram_pose', async (data: { avatarId: string; pose: unknown }) => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      try {
        await updatePoseAction(data.avatarId, socket.user.id, data.pose);

        // Broadcast pose to everyone else in room (skip DB read for perf)
        socket.to(user.currentRoom).emit('hologram_pose_update', {
          avatarId: data.avatarId,
          pose: data.pose,
        });
      } catch (err) {
        socket.emit('agent_error', { error: `Hologram pose failed: ${(err as Error).message}` });
      }
    });

    socket.on('hologram_remove', async (data: { avatarId: string }) => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      try {
        await removeAvatarAction(data.avatarId, socket.user.id);
        io.to(user.currentRoom).emit('hologram_removed', { avatarId: data.avatarId });
      } catch (err) {
        socket.emit('agent_error', { error: `Hologram remove failed: ${(err as Error).message}` });
      }
    });

    socket.on('hologram_load', async () => {
      const user = connectedUsers.get(socket.id);
      if (!user?.currentRoom) return;

      const roomId = getRoomId(user.currentRoom);
      if (!roomId) return;

      try {
        const avatars = await loadAvatarsAction(roomId);
        socket.emit('hologram_list', {
          avatars: avatars.map((a) => ({
            id: a.id,
            userId: a.user_id,
            label: a.label,
            skeleton: a.skeleton,
            points: a.points,
            pose: a.pose,
            physics: a.physics,
          })),
        });
      } catch (err) {
        socket.emit('agent_error', { error: `Hologram load failed: ${(err as Error).message}` });
      }
    });

    // ┌──────────────────────────────────────────┐
    // │ Disconnect                              │
    // └──────────────────────────────────────────┘
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.user.username} (${socket.id})`);
      // Save last room before leaving
      const disconnectingUser = connectedUsers.get(socket.id);
      if (disconnectingUser?.currentRoom) {
        const lastRoomId = getRoomId(disconnectingUser.currentRoom);
        if (lastRoomId) {
          Data.user.updateLastRoom(socket.user.id, lastRoomId).catch(console.error);
        }
      }
      leaveCurrentRoom(socket);
      connectedUsers.delete(socket.id);

      // Set any machines connected via this socket to offline, then notify owner's browsers
      Data.machine.setOfflineBySocketId(socket.id).then(async () => {
        const updatedMachines = await Data.machine.findByOwner(socket.user.id);
        for (const [sid, userData] of connectedUsers.entries()) {
          if (userData.userId === socket.user.id) {
            const browserSocket = io.sockets.sockets.get(sid);
            if (browserSocket) {
              browserSocket.emit('machines_list', { machines: updatedMachines });
            }
          }
        }
      }).catch(console.error);

      io.emit('roster_update', Array.from(connectedUsers.values()));
      io.emit('room_list_update', { rooms: getRoomList() });
    });
  });
};

export { registerSocketHandlers };
