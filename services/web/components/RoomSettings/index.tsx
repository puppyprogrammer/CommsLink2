'use client';

import React, { useState, useEffect } from 'react';

import {
  Box,
  Typography,
  TextField,
  Button,
  IconButton,
  Divider,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Alert,
  Paper,
  ListSubheader,
  InputAdornment,
  Checkbox,
  FormControlLabel,
  Slider,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import AddIcon from '@mui/icons-material/Add';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import TerminalIcon from '@mui/icons-material/Terminal';
import DownloadIcon from '@mui/icons-material/Download';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ComputerIcon from '@mui/icons-material/Computer';
import CircleIcon from '@mui/icons-material/Circle';
import BlockIcon from '@mui/icons-material/Block';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import PeopleIcon from '@mui/icons-material/People';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

import useSession from '@/lib/session/useSession';
import { getSocket } from '@/lib/socket';
import { useToast } from '@/lib/state/ToastContext';
import apiClient from '@/lib/api/client';
import voiceApi from '@/lib/api/voice';
import config from '@/settings/config.json';

type Agent = {
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
};

type GrokModel = {
  id: string;
  label: string;
  cost: string;
};

type PremiumVoice = {
  voice_id: string;
  name: string;
};

type RoomSettingsProps = {
  roomName: string;
  open: boolean;
  onClose: () => void;
  canManageRoom?: boolean;
  onDeleteRoom?: (roomName: string) => void;
};

const BROWSER_VOICES = [
  { value: 'male', label: 'Male (Browser)' },
  { value: 'female', label: 'Female (Browser)' },
  { value: 'robot', label: 'Robot (Browser)' },
];

const DEFAULT_MODEL = 'grok-4-1-fast-non-reasoning';

type ListItem = { text: string; locked: boolean };

/** Parse stored instructions JSON or legacy single string into ListItem[]. */
const parseList = (raw: string | null): ListItem[] => {
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
  } catch {
    // Legacy: single string instruction
  }
  return raw.trim() ? [{ text: raw.trim(), locked: false }] : [];
};

/** Serialize ListItem[] to JSON string. */
const serializeList = (list: ListItem[]): string | undefined => {
  const filtered = list.filter((item) => item.text.trim());
  if (filtered.length === 0) return undefined;
  return JSON.stringify(filtered);
};

const RoomSettings: React.FC<RoomSettingsProps> = ({ roomName, open, onClose, canManageRoom, onDeleteRoom }) => {
  const { session } = useSession();
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [error, setError] = useState('');
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [models, setModels] = useState<GrokModel[]>([]);
  const [premiumVoices, setPremiumVoices] = useState<PremiumVoice[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [cmdRecall, setCmdRecall] = useState(true);
  const [cmdSql, setCmdSql] = useState(true);
  const [cmdMemory, setCmdMemory] = useState(true);
  const [cmdSelfmod, setCmdSelfmod] = useState(true);
  const [cmdAutopilot, setCmdAutopilot] = useState(true);
  const [cmdWeb, setCmdWeb] = useState(true);
  const [cmdMentions, setCmdMentions] = useState(true);
  const [cmdTerminal, setCmdTerminal] = useState(false);
  const [cmdClaude, setCmdClaude] = useState(false);
  const [cmdSchedule, setCmdSchedule] = useState(false);
  const [cmdTokens, setCmdTokens] = useState(true);
  const [cmdModeration, setCmdModeration] = useState(false);
  const [cmdThink, setCmdThink] = useState(true);
  const [cmdEffort, setCmdEffort] = useState(true);
  const [cmdAudit, setCmdAudit] = useState(true);
  const [cmdContinue, setCmdContinue] = useState(true);
  const [maxLoops, setMaxLoops] = useState(5);

  // Terminal machines
  type MachinePermission = {
    id: string;
    machine_id: string;
    room_id: string;
    enabled: boolean;
    machine?: { id: string; name: string; owner_id: string; status: string; os: string | null };
  };
  type OwnedMachine = { id: string; name: string; status: string; os: string | null };
  const [roomMachines, setRoomMachines] = useState<MachinePermission[]>([]);
  const [ownedMachines, setOwnedMachines] = useState<OwnedMachine[]>([]);
  const [addTerminalOpen, setAddTerminalOpen] = useState(false);
  const [newMachineName, setNewMachineName] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [setupStep, setSetupStep] = useState<'name' | 'download'>('name');

  // Memory summaries
  type MemorySummary = {
    id: string;
    ref_name: string;
    level: number;
    parent_id: string | null;
    content: string;
    msg_start: string;
    msg_end: string;
    messages_covered: number;
    created_at: string;
  };
  const [summaries, setSummaries] = useState<MemorySummary[]>([]);
  const [expandedSummary, setExpandedSummary] = useState<string | null>(null);

  // Room members
  type RoomMember = { userId: string; username: string; role: string };
  const [roomMembers, setRoomMembers] = useState<RoomMember[]>([]);

  // Create form
  const [newName, setNewName] = useState('');
  const [newVoice, setNewVoice] = useState('female');
  const [newModel, setNewModel] = useState(DEFAULT_MODEL);
  const [newInstructions, setNewInstructions] = useState<ListItem[]>([]);
  const [newInstructionDraft, setNewInstructionDraft] = useState('');
  const [newMemories, setNewMemories] = useState<ListItem[]>([]);
  const [newMemoryDraft, setNewMemoryDraft] = useState('');
  const [newAutopilot, setNewAutopilot] = useState(false);
  const [newAutopilotInterval, setNewAutopilotInterval] = useState(300);
  const [newAutopilotPrompts, setNewAutopilotPrompts] = useState<ListItem[]>([]);
  const [newAutopilotDraft, setNewAutopilotDraft] = useState('');
  const [newPlan, setNewPlan] = useState('');
  const [newTasks, setNewTasks] = useState('');

  // Edit form
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [editName, setEditName] = useState('');
  const [editVoice, setEditVoice] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editInstructions, setEditInstructions] = useState<ListItem[]>([]);
  const [editInstructionDraft, setEditInstructionDraft] = useState('');
  const [editMemories, setEditMemories] = useState<ListItem[]>([]);
  const [editMemoryDraft, setEditMemoryDraft] = useState('');
  const [editAutopilot, setEditAutopilot] = useState(false);
  const [editAutopilotInterval, setEditAutopilotInterval] = useState(300);
  const [editAutopilotPrompts, setEditAutopilotPrompts] = useState<ListItem[]>([]);
  const [editAutopilotDraft, setEditAutopilotDraft] = useState('');
  const [editPlan, setEditPlan] = useState('');
  const [editTasks, setEditTasks] = useState('');

  // Fetch models and premium voices
  useEffect(() => {
    if (!open) return;
    apiClient
      .get('/models')
      .then((res) => setModels(res.data.models))
      .catch(() => {});

    if (session?.token && session?.user?.is_premium) {
      voiceApi
        .listVoices(session.token)
        .then((res) => setPremiumVoices(res.voices || []))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !session?.token) return;

    const socket = getSocket(session.token);
    socket.emit('get_room_agents', { roomName });
    socket.emit('get_room_memory', { roomName });
    socket.emit('get_room_machines', { roomName });
    socket.emit('get_room_summaries', { roomName });

    const handleMemoryStatus = (data: {
      enabled: boolean;
      cmdRecall: boolean;
      cmdSql: boolean;
      cmdMemory: boolean;
      cmdSelfmod: boolean;
      cmdAutopilot: boolean;
      cmdWeb: boolean;
      cmdMentions: boolean;
      cmdTerminal: boolean;
      cmdClaude: boolean;
      cmdSchedule: boolean;
      cmdTokens: boolean;
      cmdModeration: boolean;
      cmdThink: boolean;
      cmdEffort: boolean;
      cmdAudit: boolean;
      cmdContinue: boolean;
      maxLoops: number;
    }) => {
      setMemoryEnabled(data.enabled);
      setCmdRecall(data.cmdRecall);
      setCmdSql(data.cmdSql);
      setCmdMemory(data.cmdMemory);
      setCmdSelfmod(data.cmdSelfmod);
      setCmdAutopilot(data.cmdAutopilot);
      setCmdWeb(data.cmdWeb);
      setCmdMentions(data.cmdMentions);
      setCmdTerminal(data.cmdTerminal);
      setCmdClaude(data.cmdClaude);
      setCmdSchedule(data.cmdSchedule);
      setCmdTokens(data.cmdTokens);
      setCmdModeration(data.cmdModeration);
      setCmdThink(data.cmdThink);
      setCmdEffort(data.cmdEffort);
      setCmdAudit(data.cmdAudit);
      setCmdContinue(data.cmdContinue);
      setMaxLoops(data.maxLoops);
    };

    const handleMemoryToggled = (data: { enabled: boolean }) => {
      setMemoryEnabled(data.enabled);
    };

    const handleCommandsUpdated = (data: {
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
      if (data.cmdRecall !== undefined) setCmdRecall(data.cmdRecall);
      if (data.cmdSql !== undefined) setCmdSql(data.cmdSql);
      if (data.cmdMemory !== undefined) setCmdMemory(data.cmdMemory);
      if (data.cmdSelfmod !== undefined) setCmdSelfmod(data.cmdSelfmod);
      if (data.cmdAutopilot !== undefined) setCmdAutopilot(data.cmdAutopilot);
      if (data.cmdWeb !== undefined) setCmdWeb(data.cmdWeb);
      if (data.cmdMentions !== undefined) setCmdMentions(data.cmdMentions);
      if (data.cmdTerminal !== undefined) setCmdTerminal(data.cmdTerminal);
      if (data.cmdTokens !== undefined) setCmdTokens(data.cmdTokens);
      if (data.cmdModeration !== undefined) setCmdModeration(data.cmdModeration);
      if (data.cmdClaude !== undefined) setCmdClaude(data.cmdClaude);
      if (data.cmdSchedule !== undefined) setCmdSchedule(data.cmdSchedule);
      if (data.cmdThink !== undefined) setCmdThink(data.cmdThink);
      if (data.cmdEffort !== undefined) setCmdEffort(data.cmdEffort);
      if (data.cmdAudit !== undefined) setCmdAudit(data.cmdAudit);
      if (data.cmdContinue !== undefined) setCmdContinue(data.cmdContinue);
      if (data.maxLoops !== undefined) setMaxLoops(data.maxLoops);
    };

    const handleAgents = (data: { agents: Agent[] }) => {
      setAgents(data.agents);
    };

    const handleCreated = (agent: Agent) => {
      setAgents((prev) => [...prev, agent]);
      setNewName('');
      setNewVoice('female');
      setNewModel(DEFAULT_MODEL);
      setNewInstructions([]);
      setNewInstructionDraft('');
      setNewMemories([]);
      setNewMemoryDraft('');
      setNewAutopilot(false);
      setNewAutopilotInterval(300);
      setNewAutopilotPrompts([]);
      setNewAutopilotDraft('');
      setNewPlan('');
      setNewTasks('');
      setError('');
    };

    const handleUpdated = (agent: Agent) => {
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? agent : a)));
      setEditAgent(null);
    };

    const handleDeleted = (data: { agentId: string }) => {
      setAgents((prev) => prev.filter((a) => a.id !== data.agentId));
    };

    const handleError = (data: { error: string }) => {
      setError(data.error);
      toast(data.error);
    };

    const handleRoomMachines = (data: { machines: MachinePermission[]; ownedMachines?: OwnedMachine[] }) => {
      setRoomMachines(data.machines);
      if (data.ownedMachines) setOwnedMachines(data.ownedMachines);
    };

    const handleMachinePermissionUpdated = () => {
      socket.emit('get_room_machines', { roomName });
    };

    const handleRoomMembers = (data: { members: RoomMember[] }) => {
      setRoomMembers(data.members);
    };

    const handleSummaries = (data: { summaries: MemorySummary[] }) => {
      setSummaries(data.summaries);
    };

    socket.on('room_machines', handleRoomMachines);
    socket.on('machine_permission_updated', handleMachinePermissionUpdated);
    socket.on('room_memory_status', handleMemoryStatus);
    socket.on('memory_toggled', handleMemoryToggled);
    socket.on('room_commands_updated', handleCommandsUpdated);
    socket.on('room_agents', handleAgents);
    socket.on('agent_created', handleCreated);
    socket.on('agent_updated', handleUpdated);
    socket.on('agent_deleted', handleDeleted);
    socket.on('agent_error', handleError);
    socket.on('room_members', handleRoomMembers);
    socket.on('room_summaries', handleSummaries);

    // Fetch members
    socket.emit('get_room_members', { roomName });

    return () => {
      socket.off('room_machines', handleRoomMachines);
      socket.off('machine_permission_updated', handleMachinePermissionUpdated);
      socket.off('room_memory_status', handleMemoryStatus);
      socket.off('memory_toggled', handleMemoryToggled);
      socket.off('room_commands_updated', handleCommandsUpdated);
      socket.off('room_agents', handleAgents);
      socket.off('agent_created', handleCreated);
      socket.off('agent_updated', handleUpdated);
      socket.off('agent_deleted', handleDeleted);
      socket.off('agent_error', handleError);
      socket.off('room_members', handleRoomMembers);
      socket.off('room_summaries', handleSummaries);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session?.token, roomName]);

  const getModelLabel = (modelId: string): string => {
    const m = models.find((mod) => mod.id === modelId);
    return m ? m.label : modelId;
  };

  const getVoiceLabel = (voiceId: string): string => {
    const browser = BROWSER_VOICES.find((v) => v.value === voiceId);
    if (browser) return browser.label;
    const premium = premiumVoices.find((v) => v.voice_id === voiceId);
    if (premium) return premium.name;
    return voiceId;
  };

  const handleCreate = () => {
    if (!session?.token || !newName.trim()) return;
    setError('');
    const socket = getSocket(session.token);
    socket.emit('create_agent', {
      name: newName.trim(),
      roomName,
      voiceId: newVoice,
      model: newModel,
      systemInstructions: serializeList(newInstructions),
      memories: serializeList(newMemories),
      autopilotEnabled: newAutopilot,
      autopilotInterval: newAutopilotInterval,
      autopilotPrompts: serializeList(newAutopilotPrompts),
      plan: newPlan.trim() || null,
      tasks: newTasks.trim() || null,
    });
  };

  const handleUpdate = () => {
    if (!session?.token || !editAgent) return;
    const socket = getSocket(session.token);
    socket.emit('update_agent', {
      agentId: editAgent.id,
      name: editName.trim() || undefined,
      voiceId: editVoice,
      model: editModel,
      systemInstructions: serializeList(editInstructions),
      memories: serializeList(editMemories),
      autopilotEnabled: editAutopilot,
      autopilotInterval: editAutopilotInterval,
      autopilotPrompts: serializeList(editAutopilotPrompts),
      plan: editPlan.trim() || null,
      tasks: editTasks.trim() || null,
    });
  };

  const handleDelete = (agentId: string) => {
    if (!session?.token) return;
    const socket = getSocket(session.token);
    socket.emit('delete_agent', { agentId });
  };

  const startEdit = (agent: Agent) => {
    setEditAgent(agent);
    setEditName(agent.name);
    setEditVoice(agent.voice_id);
    setEditModel(agent.model || DEFAULT_MODEL);
    setEditInstructions(parseList(agent.system_instructions));
    setEditInstructionDraft('');
    setEditMemories(parseList(agent.memories));
    setEditMemoryDraft('');
    setEditAutopilot(agent.autopilot_enabled);
    setEditAutopilotInterval(agent.autopilot_interval);
    setEditAutopilotPrompts(parseList(agent.autopilot_prompts));
    setEditAutopilotDraft('');
    setEditPlan(agent.plan || '');
    setEditTasks(agent.tasks || '');
  };

  const addItem = (
    list: ListItem[],
    setList: (l: ListItem[]) => void,
    draft: string,
    setDraft: (s: string) => void,
  ) => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setList([...list, { text: trimmed, locked: false }]);
    setDraft('');
  };

  const removeItem = (list: ListItem[], setList: (l: ListItem[]) => void, index: number) => {
    setList(list.filter((_, i) => i !== index));
  };

  const toggleLock = (list: ListItem[], setList: (l: ListItem[]) => void, index: number) => {
    setList(list.map((item, i) => (i === index ? { ...item, locked: !item.locked } : item)));
  };

  const renderModelSelect = (value: string, onChange: (val: string) => void) => (
    <Select fullWidth size="small" value={value} onChange={(e) => onChange(e.target.value)} sx={{ mb: 1 }}>
      <ListSubheader>AI Model</ListSubheader>
      {models.map((m) => (
        <MenuItem key={m.id} value={m.id}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%', gap: 2 }}>
            <span>{m.label}</span>
            <Typography variant="detailText" sx={{ color: 'text.secondary' }}>
              {m.cost}
            </Typography>
          </Box>
        </MenuItem>
      ))}
    </Select>
  );

  const renderVoiceSelect = (value: string, onChange: (val: string) => void) => (
    <Select fullWidth size="small" value={value} onChange={(e) => onChange(e.target.value)} sx={{ mb: 1 }}>
      <ListSubheader>Browser Voices</ListSubheader>
      {BROWSER_VOICES.map((v) => (
        <MenuItem key={v.value} value={v.value}>
          {v.label}
        </MenuItem>
      ))}
      {premiumVoices.length > 0 && <ListSubheader>Premium Voices (ElevenLabs)</ListSubheader>}
      {premiumVoices.map((v) => (
        <MenuItem key={v.voice_id} value={v.voice_id}>
          {v.name}
        </MenuItem>
      ))}
    </Select>
  );

  const renderItemList = (
    title: string,
    placeholder: string,
    list: ListItem[],
    setList: (l: ListItem[]) => void,
    draft: string,
    setDraft: (s: string) => void,
  ) => (
    <Box sx={{ flex: 1 }}>
      <Typography variant="detailText" sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}>
        {title}
      </Typography>
      <Box sx={{ maxHeight: 200, overflowY: 'auto', mb: 0.5 }}>
        {list.map((item, i) => (
          <Box
            key={i}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 0.5,
              mb: 0.5,
              p: 0.75,
              bgcolor: item.locked ? 'action.selected' : 'background.default',
              border: '1px solid',
              borderColor: item.locked ? 'primary.main' : 'divider',
            }}
          >
            <Typography variant="detailText" sx={{ flex: 1, wordBreak: 'break-word' }}>
              {item.text}
            </Typography>
            <IconButton
              size="small"
              onClick={() => toggleLock(list, setList, i)}
              title={item.locked ? 'Unlock (agent can remove)' : 'Lock (agent cannot remove)'}
              sx={{ mt: -0.5 }}
            >
              {item.locked ? (
                <LockIcon sx={{ fontSize: 14, color: 'primary.main' }} />
              ) : (
                <LockOpenIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              )}
            </IconButton>
            <IconButton size="small" color="error" onClick={() => removeItem(list, setList, i)} sx={{ mt: -0.5 }}>
              <DeleteIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        ))}
      </Box>
      <TextField
        fullWidth
        size="small"
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            addItem(list, setList, draft, setDraft);
          }
        }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => addItem(list, setList, draft, setDraft)} disabled={!draft.trim()}>
                <AddIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
    </Box>
  );

  const renderAutopilotControls = (
    enabled: boolean,
    setEnabled: (v: boolean) => void,
    interval: number,
    setInterval: (v: number) => void,
  ) => (
    <Box sx={{ mb: 1 }}>
      <FormControlLabel
        control={<Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} size="small" />}
        label={
          <Typography variant="detailText" sx={{ fontWeight: 600 }}>
            Autopilot
          </Typography>
        }
      />
      {enabled && (
        <TextField
          fullWidth
          size="small"
          type="number"
          label="Interval (seconds)"
          value={interval}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (!isNaN(v) && v >= 2) setInterval(v);
          }}
          inputProps={{ min: 2 }}
          sx={{ mt: 0.5 }}
        />
      )}
    </Box>
  );

  /** 4-column editor layout used for both create and edit forms */
  const renderEditorColumns = (
    // Column 1: Settings
    nameValue: string,
    setName: (v: string) => void,
    voiceValue: string,
    setVoice: (v: string) => void,
    modelValue: string,
    setModel: (v: string) => void,
    autopilotEnabled: boolean,
    setAutopilotEnabled: (v: boolean) => void,
    autopilotInterval: number,
    setAutopilotIntervalVal: (v: number) => void,
    // Column 2: Instructions
    instructions: ListItem[],
    setInstructions: (l: ListItem[]) => void,
    instructionDraft: string,
    setInstructionDraft: (s: string) => void,
    // Column 3: Memories
    memories: ListItem[],
    setMemories: (l: ListItem[]) => void,
    memoryDraft: string,
    setMemoryDraft: (s: string) => void,
    // Column 4: Autopilot Prompts
    autopilotPrompts: ListItem[],
    setAutopilotPrompts: (l: ListItem[]) => void,
    autopilotDraft: string,
    setAutopilotDraft: (s: string) => void,
    // Column 5: Plan
    planValue: string,
    setPlan: (v: string) => void,
    // Column 6: Tasks
    tasksValue: string,
    setTasks: (v: string) => void,
  ) => (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      {/* Column 1: Settings */}
      <Box sx={{ flex: '1 1 180px', minWidth: 160 }}>
        <Typography variant="detailText" sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}>
          Settings
        </Typography>
        <TextField
          fullWidth
          size="small"
          label="Agent Name"
          value={nameValue}
          onChange={(e) => setName(e.target.value)}
          sx={{ mb: 1 }}
        />
        {renderVoiceSelect(voiceValue, setVoice)}
        {renderModelSelect(modelValue, setModel)}
        {renderAutopilotControls(autopilotEnabled, setAutopilotEnabled, autopilotInterval, setAutopilotIntervalVal)}
      </Box>

      {/* Column 2: Instructions */}
      <Box sx={{ flex: '1 1 180px', minWidth: 160 }}>
        {renderItemList(
          'Instructions',
          'Add an instruction...',
          instructions,
          setInstructions,
          instructionDraft,
          setInstructionDraft,
        )}
      </Box>

      {/* Column 3: Memories */}
      <Box sx={{ flex: '1 1 180px', minWidth: 160 }}>
        {renderItemList('Memories', 'Add a memory...', memories, setMemories, memoryDraft, setMemoryDraft)}
      </Box>

      {/* Column 4: Autopilot Prompts */}
      <Box sx={{ flex: '1 1 180px', minWidth: 160 }}>
        {renderItemList(
          'Autopilot Prompts',
          'Add a prompt...',
          autopilotPrompts,
          setAutopilotPrompts,
          autopilotDraft,
          setAutopilotDraft,
        )}
      </Box>

      {/* Column 5: Plan */}
      <Box sx={{ flex: '1 1 180px', minWidth: 160 }}>
        <Typography variant="detailText" sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}>
          Plan
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', mb: 0.5, opacity: 0.7 }}>
          The AI can set and clear its own plan. You can also edit it here.
        </Typography>
        <TextField
          fullWidth
          size="small"
          multiline
          minRows={4}
          maxRows={10}
          placeholder="No plan set. The AI will set one when needed."
          value={planValue}
          onChange={(e) => setPlan(e.target.value)}
        />
      </Box>

      {/* Column 6: Tasks */}
      <Box sx={{ flex: '1 1 180px', minWidth: 160 }}>
        <Typography variant="detailText" sx={{ mb: 0.5, display: 'block', fontWeight: 600 }}>
          Tasks
        </Typography>
        <Typography variant="caption" sx={{ display: 'block', mb: 0.5, opacity: 0.7 }}>
          JSON array of tasks. The AI manages these via commands.
        </Typography>
        <TextField
          fullWidth
          size="small"
          multiline
          minRows={4}
          maxRows={10}
          placeholder="No tasks. The AI will create tasks when needed."
          value={tasksValue}
          onChange={(e) => setTasks(e.target.value)}
        />
      </Box>
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Room Settings — {roomName}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* ── Remote Terminals ─────────────────────────── */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ mb: 1, fontSize: '1rem' }}>
            <TerminalIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom' }} />
            Remote Terminals
          </Typography>
          <Typography variant="detailText" sx={{ mb: 1, display: 'block', color: 'text.secondary' }}>
            Connect machines to this room so AI agents can execute terminal commands on them.
          </Typography>

          {roomMachines.length > 0 && (
            <Box sx={{ mb: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0.5 }}>
              {roomMachines.map((perm) => (
                <Paper
                  key={perm.id}
                  sx={{ p: 1, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider' }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                    <ComputerIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                      {perm.machine?.name || 'Unknown'}
                    </Typography>
                    <CircleIcon
                      sx={{
                        fontSize: 8,
                        color: perm.machine?.status === 'online' ? 'success.main' : 'text.disabled',
                      }}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={perm.enabled}
                          onChange={(e) => {
                            if (!session?.token) return;
                            const socket = getSocket(session.token);
                            socket.emit('update_machine_permission', {
                              machineId: perm.machine_id,
                              roomName,
                              enabled: e.target.checked,
                            });
                          }}
                          size="small"
                          sx={{ p: 0.25 }}
                        />
                      }
                      label={
                        <Typography variant="detailText" sx={{ fontSize: '0.7rem' }}>
                          Enabled
                        </Typography>
                      }
                      sx={{ m: 0 }}
                    />
                    {perm.machine?.status === 'offline' && (
                      <IconButton
                        size="small"
                        title="Delete machine"
                        onClick={() => {
                          if (!session?.token) return;
                          if (!confirm(`Delete machine "${perm.machine?.name}"?`)) return;
                          const socket = getSocket(session.token);
                          socket.emit('delete_machine', { machineId: perm.machine_id });
                          setRoomMachines((prev) => prev.filter((p) => p.machine_id !== perm.machine_id));
                        }}
                      >
                        <DeleteIcon sx={{ fontSize: 14, color: 'error.main' }} />
                      </IconButton>
                    )}
                  </Box>
                </Paper>
              ))}
            </Box>
          )}

          {(() => {
            const addedIds = new Set(roomMachines.map((p) => p.machine_id));
            const unlinked = ownedMachines.filter((m) => !addedIds.has(m.id));
            if (unlinked.length === 0) return null;
            return (
              <Box sx={{ mb: 1 }}>
                <Typography variant="detailText" sx={{ mb: 0.5, display: 'block', color: 'text.secondary' }}>
                  Your machines not yet in this room:
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0.5 }}>
                  {unlinked.map((m) => (
                    <Paper
                      key={m.id}
                      sx={{ p: 1, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider' }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        <ComputerIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                          {m.name}
                        </Typography>
                        <CircleIcon
                          sx={{
                            fontSize: 8,
                            color: m.status === 'online' ? 'success.main' : 'text.disabled',
                          }}
                        />
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Button
                          variant="outlined"
                          size="small"
                          startIcon={<AddIcon sx={{ fontSize: 12 }} />}
                          onClick={() => {
                            if (!session?.token) return;
                            const socket = getSocket(session.token);
                            socket.emit('update_machine_permission', { machineId: m.id, roomName, enabled: true });
                          }}
                          sx={{ fontSize: '0.7rem', py: 0.25 }}
                        >
                          Add
                        </Button>
                        {m.status === 'offline' && (
                          <IconButton
                            size="small"
                            title="Delete machine"
                            onClick={() => {
                              if (!session?.token) return;
                              if (!confirm(`Delete machine "${m.name}"?`)) return;
                              const socket = getSocket(session.token);
                              socket.emit('delete_machine', { machineId: m.id });
                              setOwnedMachines((prev) => prev.filter((om) => om.id !== m.id));
                            }}
                          >
                            <DeleteIcon sx={{ fontSize: 14, color: 'error.main' }} />
                          </IconButton>
                        )}
                      </Box>
                    </Paper>
                  ))}
                </Box>
              </Box>
            );
          })()}

          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon />}
            onClick={() => {
              setAddTerminalOpen(true);
              setSetupStep('name');
              setNewMachineName('');
              setSetupCode('');
            }}
          >
            Set Up New Terminal
          </Button>
        </Box>

        <Divider sx={{ mb: 2 }} />

        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ mb: 1, fontSize: '1rem' }}>
            Room Memory
          </Typography>
          <FormControlLabel
            control={
              <Checkbox
                checked={memoryEnabled}
                onChange={(e) => {
                  if (!session?.token) return;
                  const socket = getSocket(session.token);
                  socket.emit('toggle_memory', { roomName, enabled: e.target.checked });
                }}
                size="small"
              />
            }
            label={
              <Typography variant="detailText">
                Enable AI Memory (summarizes chat history for agents — charged to room creator)
              </Typography>
            }
          />
        </Box>

        {memoryEnabled && summaries.length > 0 && (
          <>
            <Divider sx={{ mb: 2 }} />
            <Box sx={{ mb: 2 }}>
              <Typography variant="h6" sx={{ mb: 1, fontSize: '1rem' }}>
                <AccountTreeIcon sx={{ fontSize: 18, mr: 0.5, verticalAlign: 'text-bottom' }} />
                Memory Summaries
              </Typography>
              <Typography variant="detailText" sx={{ mb: 1, display: 'block', color: 'text.secondary' }}>
                Hierarchical memory: L1 chunks (20 msgs) roll up into L2 episodes, L3 eras, and L4 master summary.
              </Typography>
              {[4, 3, 2, 1].map((level) => {
                const levelNames: Record<number, string> = { 1: 'Chunks', 2: 'Episodes', 3: 'Eras', 4: 'Master' };
                const levelSummaries = summaries.filter((s) => s.level === level);
                if (levelSummaries.length === 0) return null;
                return (
                  <Box key={level} sx={{ mb: 1.5 }}>
                    <Typography
                      variant="detailText"
                      sx={{ fontWeight: 600, mb: 0.5, display: 'block', color: 'text.secondary' }}
                    >
                      L{level} — {levelNames[level]} ({levelSummaries.length})
                    </Typography>
                    {levelSummaries.map((s) => {
                      const isExpanded = expandedSummary === s.id;
                      const start = new Date(s.msg_start).toLocaleDateString();
                      const end = new Date(s.msg_end).toLocaleDateString();
                      const dateRange = start === end ? start : `${start} — ${end}`;
                      return (
                        <Paper
                          key={s.id}
                          variant="outlined"
                          sx={{
                            mb: 0.5,
                            cursor: 'pointer',
                            '&:hover': { borderColor: 'primary.main' },
                          }}
                          onClick={() => setExpandedSummary(isExpanded ? null : s.id)}
                        >
                          <Box
                            sx={{
                              px: 1.5,
                              py: 0.75,
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <Box>
                              <Typography variant="detailText" sx={{ fontWeight: 500 }}>
                                {s.ref_name}
                              </Typography>
                              <Typography variant="detailText" sx={{ color: 'text.secondary', ml: 1 }}>
                                {dateRange} &middot; {s.messages_covered} msgs
                              </Typography>
                            </Box>
                            {isExpanded ? (
                              <ExpandLessIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                            ) : (
                              <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                            )}
                          </Box>
                          {isExpanded && (
                            <Box
                              sx={{
                                px: 1.5,
                                pb: 1,
                                borderTop: '1px solid',
                                borderColor: 'divider',
                              }}
                            >
                              <Typography
                                variant="detailText"
                                sx={{
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  pt: 1,
                                  fontSize: '0.8rem',
                                  lineHeight: 1.5,
                                  maxHeight: 300,
                                  overflow: 'auto',
                                }}
                              >
                                {s.content}
                              </Typography>
                              {s.parent_id && (
                                <Typography
                                  variant="detailText"
                                  sx={{ color: 'text.secondary', mt: 0.5, fontSize: '0.75rem' }}
                                >
                                  Parent: {summaries.find((p) => p.id === s.parent_id)?.ref_name || s.parent_id}
                                </Typography>
                              )}
                            </Box>
                          )}
                        </Paper>
                      );
                    })}
                  </Box>
                );
              })}
            </Box>
          </>
        )}

        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ mb: 1, fontSize: '1rem' }}>
            AI Commands
          </Typography>
          <Typography variant="detailText" sx={{ mb: 1, display: 'block', color: 'text.secondary' }}>
            Toggle which commands AI agents can use. Memory commands also work as user chat commands.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0.5 }}>
            {[
              ...(memoryEnabled
                ? [
                    {
                      label: '/memory — View master summary',
                      desc: 'AI: automatically included in prompt | User: /memory',
                      checked: cmdMemory,
                      key: 'cmdMemory' as const,
                      set: setCmdMemory,
                    },
                    {
                      label: '/recall [ref] — Retrieve a specific summary',
                      desc: 'AI: {recall ref_name} | User: /recall l1-20260309-001',
                      checked: cmdRecall,
                      key: 'cmdRecall' as const,
                      set: setCmdRecall,
                    },
                    {
                      label: '/sql [query] — Query room messages',
                      desc: 'AI: {sql SELECT ...} | User: /sql SELECT username, content FROM message LIMIT 10',
                      checked: cmdSql,
                      key: 'cmdSql' as const,
                      set: setCmdSql,
                    },
                  ]
                : []),
              {
                label: 'Self-Modification — Memories, instructions, prompts, plan, tasks',
                desc: 'AI: {add_memory}, {remove_memory}, {add_instruction}, {remove_instruction}, {add_autopilot}, {remove_autopilot}, {set_plan}, {clear_plan}, {add_task}, {complete_task}, {update_task}, {remove_task}',
                checked: cmdSelfmod,
                key: 'cmdSelfmod' as const,
                set: setCmdSelfmod,
              },
              {
                label: 'Autopilot Control — Toggle and set interval',
                desc: 'AI: {toggle_autopilot on|off}, {set_autopilot_interval N} (seconds, min 5)',
                checked: cmdAutopilot,
                key: 'cmdAutopilot' as const,
                set: setCmdAutopilot,
              },
              {
                label: 'Web Browsing — Search, browse pages, find text',
                desc: 'AI: {search query}, {browse url}, {find text}',
                checked: cmdWeb,
                key: 'cmdWeb' as const,
                set: setCmdWeb,
              },
              {
                label: 'AI Mentions — Agents respond to each other',
                desc: 'When an agent mentions another agent by name, that agent responds (max 5 exchanges)',
                checked: cmdMentions,
                key: 'cmdMentions' as const,
                set: setCmdMentions,
              },
              {
                label: 'Remote Terminal — Execute commands on connected machines',
                desc: 'AI: {terminal machine_name command} | Dangerous commands require creator approval',
                checked: cmdTerminal,
                key: 'cmdTerminal' as const,
                set: setCmdTerminal,
              },
              {
                label: 'Claude Code — Persistent AI coding sessions on remote machines',
                desc: 'AI: {claude machine_name prompt} | Sessions persist across messages',
                checked: cmdClaude,
                key: 'cmdClaude' as const,
                set: setCmdClaude,
              },
              {
                label: 'Scheduling — Set reminders and recurring tasks',
                desc: 'AI: {schedule YYYY-MM-DD HH:mm message}, {schedule_recurring daily|weekly|weekdays|monthly HH:mm message}',
                checked: cmdSchedule,
                key: 'cmdSchedule' as const,
                set: setCmdSchedule,
              },
              {
                label: 'Token Budget — AI adjusts own response length',
                desc: 'AI: {set_tokens N} | Lets agents increase tokens for long prompts and lower them for quick replies',
                checked: cmdTokens,
                key: 'cmdTokens' as const,
                set: setCmdTokens,
              },
              {
                label: 'AI Moderation — Kick and ban users',
                desc: 'AI: {kick username}, {ban username}, {unban username} | AI can moderate disruptive users',
                checked: cmdModeration,
                key: 'cmdModeration' as const,
                set: setCmdModeration,
              },
              {
                label: 'Internal Thought — Silent reasoning without voice',
                desc: 'AI: {think reasoning here} | Logs thought as system message, no TTS generated. Saves voice credits.',
                checked: cmdThink,
                key: 'cmdThink' as const,
                set: setCmdThink,
              },
              {
                label: 'Effort Level — Switch between reasoning models',
                desc: 'AI: {set_effort low|high} | Low = fast non-reasoning, High = thorough reasoning model',
                checked: cmdEffort,
                key: 'cmdEffort' as const,
                set: setCmdEffort,
              },
              {
                label: 'Claude Audit Log — View recent Claude activity on machines',
                desc: 'AI: {audit machine_name} | Shows last 10 Claude interactions for a machine owned by the creator',
                checked: cmdAudit,
                key: 'cmdAudit' as const,
                set: setCmdAudit,
              },
              {
                label: 'Extended Thinking — AI chains multiple thought loops',
                desc: 'AI: {continue} | Lets agents request additional thinking loops before responding (up to max loops setting)',
                checked: cmdContinue,
                key: 'cmdContinue' as const,
                set: setCmdContinue,
              },
            ].map((cmd) => (
              <Box key={cmd.key}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={cmd.checked}
                      onChange={(e) => {
                        cmd.set(e.target.checked);
                        if (!session?.token) return;
                        const socket = getSocket(session.token);
                        socket.emit('update_room_commands', { roomName, [cmd.key]: e.target.checked });
                      }}
                      size="small"
                      sx={{ p: 0.25 }}
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="detailText" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>
                        {cmd.label}
                      </Typography>
                      <Typography
                        variant="detailText"
                        sx={{ display: 'block', color: 'text.secondary', fontSize: '0.65rem' }}
                      >
                        {cmd.desc}
                      </Typography>
                    </Box>
                  }
                  sx={{ m: 0, alignItems: 'flex-start' }}
                />
              </Box>
            ))}
          </Box>

          {/* Max Loops slider */}
          <Box sx={{ mt: 1, mb: 1, px: 1 }}>
            <Typography variant="detailText" sx={{ fontWeight: 600, fontSize: '0.75rem' }}>
              Max Thinking Loops: {maxLoops}
            </Typography>
            <Typography
              variant="detailText"
              sx={{ display: 'block', color: 'text.secondary', fontSize: '0.65rem', mb: 0.5 }}
            >
              Maximum command/thinking loops per AI turn. Higher = deeper reasoning but more API calls. Default: 5.
            </Typography>
            <Slider
              size="small"
              min={3}
              max={20}
              step={1}
              value={maxLoops}
              onChange={(_, val) => setMaxLoops(val as number)}
              onChangeCommitted={(_, val) => {
                if (!session?.token) return;
                const socket = getSocket(session.token);
                socket.emit('update_room_commands', { roomName, maxLoops: val as number });
              }}
              valueLabelDisplay="auto"
              marks={[
                { value: 3, label: '3' },
                { value: 5, label: '5' },
                { value: 10, label: '10' },
                { value: 15, label: '15' },
                { value: 20, label: '20' },
              ]}
            />
          </Box>

          {/* Always-on commands (informational) */}
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0.5 }}>
            {[
              {
                label: 'List Users — See who is online in this room',
                desc: 'AI: {list_users} | User: /users',
              },
              {
                label: "Alarm — Trigger a loud alarm on a specific user's device",
                desc: 'AI: {alarm username message}',
              },
              {
                label: "Volume — Set a user's volume level",
                desc: 'AI: {volume 0.0-1.0}',
              },
            ].map((cmd) => (
              <Box key={cmd.label}>
                <FormControlLabel
                  control={<Checkbox checked disabled size="small" sx={{ p: 0.25 }} />}
                  label={
                    <Box>
                      <Typography variant="detailText" sx={{ fontWeight: 600, opacity: 0.7, fontSize: '0.75rem' }}>
                        {cmd.label}
                      </Typography>
                      <Typography
                        variant="detailText"
                        sx={{ display: 'block', color: 'text.secondary', fontSize: '0.65rem' }}
                      >
                        {cmd.desc}
                      </Typography>
                    </Box>
                  }
                  sx={{ m: 0, alignItems: 'flex-start' }}
                />
              </Box>
            ))}
          </Box>
        </Box>

        <Divider sx={{ mb: 2 }} />

        <Typography variant="h6" sx={{ mb: 1, fontSize: '1rem' }}>
          AI Agents ({agents.length}/3)
        </Typography>
        <Typography variant="detailText" sx={{ mb: 2, display: 'block' }}>
          Mention an agent&apos;s name in chat to trigger a response.
        </Typography>

        {agents.map((agent) => {
          const instructions = parseList(agent.system_instructions);
          const memories = parseList(agent.memories);
          const autopilotPrompts = parseList(agent.autopilot_prompts);
          let taskCount = 0;
          try {
            const parsed = JSON.parse(agent.tasks || '[]');
            if (Array.isArray(parsed)) taskCount = parsed.filter((t: { status?: string }) => t.status === 'pending').length;
          } catch { /* ignore */ }
          return (
            <Paper
              key={agent.id}
              sx={{
                p: 1.5,
                mb: 1,
                bgcolor: 'background.default',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <SmartToyIcon sx={{ fontSize: 18, color: 'primary.main' }} />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {agent.name}
                  </Typography>
                  <Typography variant="detailText">({getVoiceLabel(agent.voice_id)})</Typography>
                </Box>
                <Box>
                  <IconButton size="small" onClick={() => startEdit(agent)}>
                    <EditIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(agent.id)}>
                    <DeleteIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              </Box>
              <Typography variant="detailText" sx={{ mt: 0.5, display: 'block', color: 'text.secondary' }}>
                Model: {getModelLabel(agent.model)}
                {agent.autopilot_enabled &&
                  ` | Autopilot: every ${agent.autopilot_interval >= 60 ? `${Math.round(agent.autopilot_interval / 60)}m` : `${agent.autopilot_interval}s`}`}
              </Typography>
              <Typography variant="detailText" sx={{ display: 'block', color: 'text.secondary' }}>
                {`${instructions.length} instruction${instructions.length !== 1 ? 's' : ''}, `}
                {`${memories.length} memor${memories.length !== 1 ? 'ies' : 'y'}, `}
                {`${autopilotPrompts.length} autopilot prompt${autopilotPrompts.length !== 1 ? 's' : ''}`}
                {taskCount > 0 && `, ${taskCount} pending task${taskCount !== 1 ? 's' : ''}`}
              </Typography>
            </Paper>
          );
        })}

        {agents.length < 3 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
              Add Agent
            </Typography>
            {renderEditorColumns(
              newName,
              setNewName,
              newVoice,
              setNewVoice,
              newModel,
              setNewModel,
              newAutopilot,
              setNewAutopilot,
              newAutopilotInterval,
              setNewAutopilotInterval,
              newInstructions,
              setNewInstructions,
              newInstructionDraft,
              setNewInstructionDraft,
              newMemories,
              setNewMemories,
              newMemoryDraft,
              setNewMemoryDraft,
              newAutopilotPrompts,
              setNewAutopilotPrompts,
              newAutopilotDraft,
              setNewAutopilotDraft,
              newPlan,
              setNewPlan,
              newTasks,
              setNewTasks,
            )}
            <Button variant="contained" size="small" onClick={handleCreate} disabled={!newName.trim()} sx={{ mt: 1 }}>
              Add Agent
            </Button>
          </>
        )}
        {/* Room Members */}
        {canManageRoom && roomMembers.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <PeopleIcon sx={{ fontSize: 16 }} /> Members ({roomMembers.length})
            </Typography>
            {roomMembers.map((member) => (
              <Box
                key={member.userId}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  py: 0.5,
                  px: 1,
                  mb: 0.5,
                  borderRadius: 1,
                  bgcolor: member.role === 'banned' ? 'rgba(255,0,0,0.08)' : 'rgba(255,255,255,0.03)',
                }}
              >
                <Typography variant="body2" sx={{ color: member.role === 'banned' ? '#f44336' : 'inherit' }}>
                  {member.username} {member.role === 'banned' ? '(banned)' : ''}
                </Typography>
                <Box>
                  {member.role === 'banned' ? (
                    <Button
                      size="small"
                      variant="text"
                      onClick={() => {
                        if (!session?.token) return;
                        const socket = getSocket(session.token);
                        socket.emit('unban_member', { roomName, userId: member.userId });
                        setRoomMembers((prev) => prev.filter((m) => m.userId !== member.userId));
                      }}
                      sx={{ minWidth: 0, fontSize: 11 }}
                    >
                      Unban
                    </Button>
                  ) : (
                    <>
                      <IconButton
                        size="small"
                        title="Kick"
                        onClick={() => {
                          if (!session?.token) return;
                          const socket = getSocket(session.token);
                          socket.emit('kick_member', { roomName, userId: member.userId });
                          setRoomMembers((prev) => prev.filter((m) => m.userId !== member.userId));
                        }}
                      >
                        <PersonRemoveIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        title="Ban"
                        onClick={() => {
                          if (!session?.token) return;
                          if (!confirm(`Ban ${member.username} from this room?`)) return;
                          const socket = getSocket(session.token);
                          socket.emit('ban_member', { roomName, userId: member.userId });
                          setRoomMembers((prev) =>
                            prev.map((m) => (m.userId === member.userId ? { ...m, role: 'banned' } : m)),
                          );
                        }}
                      >
                        <BlockIcon sx={{ fontSize: 16, color: '#f44336' }} />
                      </IconButton>
                    </>
                  )}
                </Box>
              </Box>
            ))}
          </>
        )}
        {canManageRoom && (
          <>
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" color="error" size="small" onClick={() => setClearConfirmOpen(true)}>
                Clear Chat
              </Button>
              {onDeleteRoom && roomName.toLowerCase() !== 'public' && (
                <Button
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<DeleteIcon sx={{ fontSize: 16 }} />}
                  onClick={() => {
                    if (confirm(`Delete room "${roomName}"? This cannot be undone.`)) {
                      onDeleteRoom(roomName);
                      onClose();
                    }
                  }}
                >
                  Delete Room
                </Button>
              )}
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {/* Clear Chat Confirm Dialog */}
      <Dialog open={clearConfirmOpen} onClose={() => setClearConfirmOpen(false)}>
        <DialogTitle>Clear Chat History</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to clear all messages in this room? Messages will be archived and no longer visible in
            chat.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearConfirmOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (!session?.token) return;
              const socket = getSocket(session.token);
              socket.emit('clear_chat', { roomName });
              setClearConfirmOpen(false);
              toast('Chat cleared');
              onClose();
            }}
          >
            Clear Chat
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add Remote Terminal Dialog */}
      <Dialog open={addTerminalOpen} onClose={() => setAddTerminalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          <TerminalIcon sx={{ fontSize: 20, mr: 1, verticalAlign: 'text-bottom' }} />
          {setupStep === 'name' ? 'Add Remote Terminal' : 'Download & Connect'}
        </DialogTitle>
        <DialogContent>
          {setupStep === 'name' && (
            <Box sx={{ mt: 1 }}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Enter a name for this machine. This is how AI agents will reference it (e.g.{' '}
                <code>{'{terminal my-pc ls -la}'}</code>).
              </Typography>
              <TextField
                fullWidth
                size="small"
                label="Machine Name"
                placeholder="e.g. my-workstation, ec2-prod, dev-server"
                value={newMachineName}
                onChange={(e) => setNewMachineName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              />
            </Box>
          )}
          {setupStep === 'download' && (
            <Box sx={{ mt: 1 }}>
              <Alert severity="success" sx={{ mb: 2 }}>
                Machine &quot;{newMachineName}&quot; configured! Now download and run the agent on your target machine.
              </Alert>

              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                Step 1: Download for your platform
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<DownloadIcon />}
                  href={`${config.API_HOSTNAME}/api/v1/terminal/download/win`}
                >
                  Windows
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<DownloadIcon />}
                  href={`${config.API_HOSTNAME}/api/v1/terminal/download/linux`}
                >
                  Linux
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<DownloadIcon />}
                  href={`${config.API_HOSTNAME}/api/v1/terminal/download/macos`}
                >
                  macOS
                </Button>
              </Box>

              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                Step 2: Run with this setup code
              </Typography>
              <Typography variant="detailText" sx={{ display: 'block', mb: 1, color: 'text.secondary' }}>
                The setup code pre-fills your username and machine name. You just enter your password.
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  p: 1,
                  bgcolor: 'background.default',
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: 1,
                  mb: 2,
                }}
              >
                <Typography
                  variant="detailText"
                  sx={{ flex: 1, fontFamily: 'monospace', wordBreak: 'break-all', fontSize: '0.7rem' }}
                >
                  {setupCode}
                </Typography>
                <IconButton
                  size="small"
                  onClick={() => {
                    navigator.clipboard.writeText(setupCode);
                    toast('Setup code copied!');
                  }}
                >
                  <ContentCopyIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>

              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                Step 3: Run the command
              </Typography>
              <Box
                sx={{
                  p: 1.5,
                  bgcolor: '#1a1a2e',
                  borderRadius: 1,
                  fontFamily: 'monospace',
                  fontSize: '0.8rem',
                  color: '#e0e0e0',
                  mb: 1,
                }}
              >
                <Box sx={{ color: '#888', mb: 0.5 }}># Windows:</Box>
                <Box>commslink-agent-win.exe --setup {setupCode.substring(0, 20)}...</Box>
                <Box sx={{ color: '#888', mt: 1, mb: 0.5 }}># Linux/Mac:</Box>
                <Box>chmod +x commslink-agent-linux</Box>
                <Box>./commslink-agent-linux --setup {setupCode.substring(0, 20)}...</Box>
              </Box>
              <Typography variant="detailText" sx={{ display: 'block', color: 'text.secondary' }}>
                Or just double-click the exe and follow the interactive login prompts.
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddTerminalOpen(false)}>{setupStep === 'download' ? 'Done' : 'Cancel'}</Button>
          {setupStep === 'name' && (
            <Button
              variant="contained"
              disabled={!newMachineName.trim()}
              onClick={async () => {
                if (!session?.token) return;
                try {
                  const res = await apiClient.post(
                    '/terminal/setup-code',
                    { machineName: newMachineName },
                    { headers: { Authorization: `Bearer ${session.token}` } },
                  );
                  setSetupCode(res.data.data?.setupCode || '');
                  setSetupStep('download');

                  // Also create/enable the machine permission for this room
                  const socket = getSocket(session.token);
                  socket.emit('machine_register', { name: newMachineName });
                } catch {
                  toast('Failed to generate setup code');
                }
              }}
            >
              Generate Setup Code
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editAgent} onClose={() => setEditAgent(null)} maxWidth="lg" fullWidth>
        <DialogTitle>Edit Agent</DialogTitle>
        <DialogContent sx={{ mt: 1 }}>
          {renderEditorColumns(
            editName,
            setEditName,
            editVoice,
            setEditVoice,
            editModel,
            setEditModel,
            editAutopilot,
            setEditAutopilot,
            editAutopilotInterval,
            setEditAutopilotInterval,
            editInstructions,
            setEditInstructions,
            editInstructionDraft,
            setEditInstructionDraft,
            editMemories,
            setEditMemories,
            editMemoryDraft,
            setEditMemoryDraft,
            editAutopilotPrompts,
            setEditAutopilotPrompts,
            editAutopilotDraft,
            setEditAutopilotDraft,
            editPlan,
            setEditPlan,
            editTasks,
            setEditTasks,
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditAgent(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleUpdate}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default RoomSettings;
