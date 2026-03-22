'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { IconButton, ToggleButtonGroup, ToggleButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TerminalIcon from '@mui/icons-material/Terminal';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import type { Socket } from 'socket.io-client';
import useSession from '@/lib/session/useSession';
import styles from './TerminalPanel.module.scss';

type Machine = {
  id: string;
  name: string;
  status: string;
  os?: string;
};

type LogEntry = {
  type: 'command' | 'output' | 'error' | 'prompt' | 'response' | 'status';
  text: string;
  machine?: string;
  timestamp: number;
};

type Props = {
  socket: Socket | null;
  machines: Machine[];
  onClose: () => void;
  initialTab?: 'terminal' | 'claude';
  isCreator?: boolean;
};

const TerminalPanel: React.FC<Props> = ({ socket, machines, onClose, initialTab, isCreator = false }) => {
  const { session } = useSession();
  const [tab, setTab] = useState<'terminal' | 'claude'>(initialTab || 'claude');
  const [mobileAgentRunning, setMobileAgentRunning] = useState(false);
  const [showMobilePrompt, setShowMobilePrompt] = useState(false);

  // Check if running inside native app or on a mobile browser
  const isNativeApp = typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).__nativeTerminalAgent;
  const isMobileBrowser = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && !isNativeApp;

  const toggleMobileAgent = useCallback(() => {
    const native = (window as unknown as Record<string, unknown>).__nativeTerminalAgent as { start: (url: string, token: string, name: string) => void; stop: () => void } | undefined;
    if (!native) return;

    if (mobileAgentRunning) {
      native.stop();
      setMobileAgentRunning(false);
    } else {
      native.start('https://commslink.net', session?.token || '', `android-${Date.now().toString(36)}`);
      setMobileAgentRunning(true);
    }
  }, [mobileAgentRunning, session?.token]);
  const [input, setInput] = useState('');
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<string>('');

  // Switch tab when parent requests it
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const [terminalEntries, setTerminalEntries] = useState<LogEntry[]>([]);
  const [claudeEntries, setClaudeEntries] = useState<LogEntry[]>([]);

  const terminalOutputRef = useRef<HTMLDivElement>(null);
  const claudeOutputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onlineMachines = machines.filter((m) => m.status === 'online');

  // Auto-select first online machine
  useEffect(() => {
    if (!selectedMachine && onlineMachines.length > 0) {
      setSelectedMachine(onlineMachines[0].name);
    }
  }, [onlineMachines, selectedMachine]);

  // Auto-scroll terminal tab
  useEffect(() => {
    if (terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight;
    }
  }, [terminalEntries]);

  // Auto-scroll claude tab
  useEffect(() => {
    if (claudeOutputRef.current) {
      claudeOutputRef.current.scrollTop = claudeOutputRef.current.scrollHeight;
    }
  }, [claudeEntries]);

  // Listen for panel_log events from backend
  useEffect(() => {
    if (!socket) return;

    const handlePanelLog = (data: { tab: 'terminal' | 'claude'; type: string; text: string; machine?: string }) => {
      const entry: LogEntry = {
        type: data.type as LogEntry['type'],
        text: data.text,
        machine: data.machine,
        timestamp: Date.now(),
      };

      if (data.tab === 'terminal') {
        setTerminalEntries((prev) => [...prev.slice(-500), entry]);
      } else {
        setClaudeEntries((prev) => [...prev.slice(-500), entry]);
      }
    };

    socket.on('panel_log', handlePanelLog);

    // Load history from DB
    const handlePanelLogs = (data: { tab: 'terminal' | 'claude'; entries: LogEntry[] }) => {
      if (data.tab === 'terminal') {
        setTerminalEntries((prev) => (prev.length > 0 ? prev : data.entries));
      } else {
        setClaudeEntries((prev) => (prev.length > 0 ? prev : data.entries));
      }
    };
    socket.on('panel_logs', handlePanelLogs);
    socket.emit('get_panel_logs', { tab: 'terminal' });
    socket.emit('get_panel_logs', { tab: 'claude' });

    return () => {
      socket.off('panel_log', handlePanelLog);
      socket.off('panel_logs', handlePanelLogs);
    };
  }, [socket]);

  // Listen for terminal_panel_output (user-initiated commands via panel input)
  useEffect(() => {
    if (!socket) return;

    const handleTerminalOutput = (data: { machineName: string; output: string; isError?: boolean }) => {
      setTerminalEntries((prev) => [
        ...prev.slice(-500),
        {
          type: data.isError ? 'error' : 'output',
          text: data.output,
          machine: data.machineName,
          timestamp: Date.now(),
        },
      ]);
      setTerminalBusy(false);
    };

    socket.on('terminal_panel_output', handleTerminalOutput);
    return () => {
      socket.off('terminal_panel_output', handleTerminalOutput);
    };
  }, [socket]);

  const handleSubmit = useCallback(() => {
    if (!input.trim() || !socket || !selectedMachine || tab !== 'terminal') return;

    const text = input.trim();
    setInput('');

    if (terminalBusy) return;
    setTerminalEntries((prev) => [
      ...prev.slice(-500),
      { type: 'command', text, machine: selectedMachine, timestamp: Date.now() },
    ]);
    setTerminalBusy(true);
    socket.emit('terminal_panel_input', { machineName: selectedMachine, command: text });
  }, [input, socket, selectedMachine, terminalBusy, tab]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const machine = machines.find((m) => m.name === selectedMachine);
  const isOnline = machine?.status === 'online';

  const getEntryClass = (type: LogEntry['type']): string => {
    switch (type) {
      case 'command':
        return styles.inputLine;
      case 'prompt':
        return styles.claudePromptLine;
      case 'output':
        return styles.outputLine;
      case 'response':
        return styles.responseLine;
      case 'status':
        return styles.statusLine;
      case 'error':
        return styles.errorLine;
      default:
        return styles.outputLine;
    }
  };

  const activeEntries = tab === 'terminal' ? terminalEntries : claudeEntries;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <ToggleButtonGroup
          value={tab}
          exclusive
          onChange={(_, v) => v && setTab(v)}
          size="small"
          className={styles.tabGroup}
        >
          <ToggleButton value="terminal" sx={{ p: '3px 10px', fontSize: '0.7rem', gap: '4px' }}>
            <TerminalIcon sx={{ fontSize: 14 }} /> Terminal
          </ToggleButton>
          <ToggleButton value="claude" sx={{ p: '3px 10px', fontSize: '0.7rem', gap: '4px' }}>
            <SmartToyIcon sx={{ fontSize: 14 }} /> Claude
          </ToggleButton>
        </ToggleButtonGroup>

        {tab === 'terminal' && (
          <select
            className={styles.machineSelect}
            value={selectedMachine}
            onChange={(e) => setSelectedMachine(e.target.value)}
          >
            {onlineMachines.length === 0 && <option value="">No machines online</option>}
            {onlineMachines.map((m) => (
              <option key={m.id} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        )}

        <div
          className={`${styles.statusDot} ${isOnline ? styles.online : styles.offline}`}
          title={isOnline ? 'Online' : 'Offline'}
        />

        <IconButton
          size="small"
          onClick={() => (tab === 'terminal' ? setTerminalEntries([]) : setClaudeEntries([]))}
          title="Clear log"
          sx={{ flexShrink: 0 }}
        >
          <DeleteSweepIcon sx={{ fontSize: 16, color: '#8b949e' }} />
        </IconButton>

        <IconButton size="small" onClick={onClose} sx={{ flexShrink: 0, color: '#f44', '&:hover': { color: '#f66', bgcolor: 'rgba(255,68,68,0.1)' } }}>
          <CloseIcon sx={{ fontSize: 22 }} />
        </IconButton>
      </div>

      {/* Log output */}
      <div className={styles.output} ref={tab === 'terminal' ? terminalOutputRef : claudeOutputRef}>
        {machines.length === 0 && activeEntries.length === 0 ? (
          <div className={styles.onboarding}>
            <div className={styles.onboardingIcon}>&#128421;</div>
            {isCreator ? (
              <>
                <div className={styles.onboardingTitle}>Connect a Machine</div>

                {/* Native app: show Share Phone button prominently */}
                {isNativeApp && (
                  <>
                    <div className={styles.onboardingDesc}>
                      Share this phone as a terminal, or download the agent for a desktop machine.
                    </div>
                    <button
                      className={`${styles.downloadBtn} ${mobileAgentRunning ? styles.downloadBtnActive : ''}`}
                      onClick={toggleMobileAgent}
                      style={{ marginTop: 4, width: '100%', justifyContent: 'center', padding: '0.6rem 1rem', fontSize: '0.85rem' }}
                    >
                      {mobileAgentRunning ? '\u25FC Stop Sharing This Phone' : '\uD83D\uDCF1 Share This Phone as Terminal'}
                    </button>
                    <div className={styles.downloadButtons}>
                      <a href="/api/v1/terminal/download/win" className={styles.downloadBtn}><span>&#9881;</span> Windows</a>
                      <a href="/api/v1/terminal/download/linux" className={styles.downloadBtn}><span>&#128039;</span> Linux</a>
                      <a href="/api/v1/terminal/download/macos" className={styles.downloadBtn}><span>&#63743;</span> macOS</a>
                    </div>
                  </>
                )}

                {/* Mobile browser (not native app): prompt to get the app */}
                {isMobileBrowser && (
                  <>
                    <div className={styles.onboardingDesc}>
                      Control machines remotely with AI agents. Get the CommsLink app to share your phone as a terminal too.
                    </div>
                    <div className={styles.downloadButtons}>
                      <button className={styles.downloadBtn} onClick={() => setShowMobilePrompt(true)} style={{ fontSize: '0.85rem', padding: '0.6rem 1rem' }}>
                        &#128241; Get the Mobile App
                      </button>
                    </div>
                    {showMobilePrompt && (
                      <div className={styles.onboardingDesc} style={{ marginTop: 8, padding: '0.75rem', background: 'rgba(77,216,208,0.06)', borderRadius: 8, border: '1px solid rgba(77,216,208,0.15)' }}>
                        The CommsLink Android app lets you share your phone as a terminal that AI agents can control.
                        Ask your room admin for the install link, or visit <strong>commslink.net</strong> on desktop to download the agent for your computer.
                      </div>
                    )}
                    <div className={styles.onboardingSteps}>
                      <div><span className={styles.stepNum}>1</span> Install the CommsLink Android app</div>
                      <div><span className={styles.stepNum}>2</span> Open a room and tap &quot;Share This Phone&quot;</div>
                      <div><span className={styles.stepNum}>3</span> AI agents can now run commands on your device</div>
                    </div>
                  </>
                )}

                {/* Desktop browser: show download buttons including Android */}
                {!isNativeApp && !isMobileBrowser && (
                  <>
                    <div className={styles.onboardingDesc}>
                      Download the CommsLink agent for any device to control it from here.
                    </div>
                    <div className={styles.downloadButtons}>
                      <a href="/api/v1/terminal/download/win" className={styles.downloadBtn}><span>&#9881;</span> Windows</a>
                      <a href="/api/v1/terminal/download/linux" className={styles.downloadBtn}><span>&#128039;</span> Linux</a>
                      <a href="/api/v1/terminal/download/macos" className={styles.downloadBtn}><span>&#63743;</span> macOS</a>
                      <button className={styles.downloadBtn} onClick={() => setShowMobilePrompt(true)}>
                        <span>&#128241;</span> Android
                      </button>
                    </div>
                    {showMobilePrompt && (
                      <div className={styles.mobilePrompt}>
                        <div className={styles.mobilePromptTitle}>Connect Your Android Phone</div>
                        <div className={styles.onboardingSteps}>
                          <div><span className={styles.stepNum}>1</span> Install the CommsLink app on your Android phone</div>
                          <div><span className={styles.stepNum}>2</span> Sign in with your account</div>
                          <div><span className={styles.stepNum}>3</span> Open this room and tap the terminal icon</div>
                          <div><span className={styles.stepNum}>4</span> Tap &quot;Share This Phone as Terminal&quot;</div>
                        </div>
                        <div className={styles.mobilePromptNote}>
                          Your phone will appear as a connected machine. AI agents can then run shell commands on it.
                        </div>
                        <button className={styles.mobilePromptClose} onClick={() => setShowMobilePrompt(false)}>Got it</button>
                      </div>
                    )}
                    {!showMobilePrompt && (
                      <div className={styles.onboardingSteps}>
                        <div><span className={styles.stepNum}>1</span> Download the agent for your OS</div>
                        <div><span className={styles.stepNum}>2</span> Open Room Settings and click &quot;Set Up New Terminal&quot;</div>
                        <div><span className={styles.stepNum}>3</span> Run the agent with the setup code provided</div>
                      </div>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <div className={styles.onboardingTitle}>Remote Terminals</div>
                <div className={styles.onboardingDesc}>
                  The room creator can connect machines to this room. Once a machine is connected,
                  you can talk to AI agents who will run commands on your behalf.
                </div>
                <div className={styles.onboardingSteps}>
                  <div><span className={styles.stepNum}>1</span> Ask the room creator to set up a terminal agent</div>
                  <div><span className={styles.stepNum}>2</span> Mention an AI agent by name in chat</div>
                  <div><span className={styles.stepNum}>3</span> The AI will execute commands and report back</div>
                </div>
              </>
            )}
          </div>
        ) : activeEntries.length === 0 ? (
          <div className={styles.empty}>
            {tab === 'terminal'
              ? 'Terminal commands and output will appear here.'
              : 'Claude prompts, status updates, and responses will appear here.'}
          </div>
        ) : null}
        {activeEntries.map((entry, i) => (
          <div key={i} className={styles.entry}>
            <div className={getEntryClass(entry.type)}>{entry.text}</div>
          </div>
        ))}
        {tab === 'terminal' && terminalBusy && <div className={styles.systemLine}>Running...</div>}
      </div>

      {/* Input area — only for terminal tab, creator only */}
      {tab === 'terminal' && isCreator && (
        <div className={styles.inputArea}>
          <span className={styles.prompt}>$</span>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter command..."
            disabled={!isOnline}
          />
          <button className={styles.sendBtn} onClick={handleSubmit} disabled={!input.trim() || !isOnline}>
            Run
          </button>
        </div>
      )}
    </div>
  );
};

export default TerminalPanel;
