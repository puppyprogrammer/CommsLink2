'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { IconButton, ToggleButtonGroup, ToggleButton, Button } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import TerminalIcon from '@mui/icons-material/Terminal';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import StopIcon from '@mui/icons-material/Stop';
import type { Socket } from 'socket.io-client';
import '@xterm/xterm/css/xterm.css';
import styles from './TerminalPanel.module.scss';

type Machine = {
  id: string;
  name: string;
  status: string;
  os?: string;
};

type Props = {
  socket: Socket | null;
  machines: Machine[];
  onClose: () => void;
};

const TerminalPanel: React.FC<Props> = ({ socket, machines, onClose }) => {
  const [tab, setTab] = useState<'terminal' | 'claude'>('terminal');
  const [selectedMachine, setSelectedMachine] = useState<string>('');
  const [input, setInput] = useState('');
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [approved, setApproved] = useState(false);

  // Terminal tab: structured entries
  const [terminalEntries, setTerminalEntries] = useState<{ type: 'input' | 'output' | 'error'; text: string }[]>([]);

  // Claude tab: xterm.js instance
  const [claudeSessionActive, setClaudeSessionActive] = useState(false);
  const xtermContainerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<{
    write: (data: string) => void;
    dispose: () => void;
    clear: () => void;
  } | null>(null);
  const fitAddonRef = useRef<{ fit: () => void } | null>(null);
  const xtermInitialized = useRef(false);

  // Debounce buffer for Claude PTY output — batches rapid thinking updates
  const ptyBufferRef = useRef('');
  const ptyFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const DEBOUNCE_MS = 300;

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onlineMachines = machines.filter((m) => m.status === 'online');

  // Auto-select first online machine
  useEffect(() => {
    if (!selectedMachine && onlineMachines.length > 0) {
      setSelectedMachine(onlineMachines[0].name);
    }
  }, [onlineMachines, selectedMachine]);

  // Auto-scroll terminal tab output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [terminalEntries]);

  // Initialize xterm.js when Claude tab is shown
  useEffect(() => {
    if (tab !== 'claude' || xtermInitialized.current) return;

    let cancelled = false;

    const initXterm = async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      if (cancelled || !xtermContainerRef.current) return;

      const fitAddon = new FitAddon();
      const terminal = new Terminal({
        theme: {
          background: '#0d1117',
          foreground: '#c9d1d9',
          cursor: '#58a6ff',
          selectionBackground: '#264f78',
        },
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontSize: 13,
        convertEol: true,
        scrollback: 10000,
        cursorBlink: false,
        disableStdin: true,
      });

      terminal.loadAddon(fitAddon);
      terminal.open(xtermContainerRef.current);
      fitAddon.fit();

      xtermRef.current = terminal;
      fitAddonRef.current = fitAddon;
      xtermInitialized.current = true;
    };

    initXterm();

    return () => {
      cancelled = true;
    };
  }, [tab]);

  // Resize xterm when tab switches or container resizes
  useEffect(() => {
    if (tab !== 'claude' || !fitAddonRef.current) return;

    const handleResize = () => {
      try {
        fitAddonRef.current?.fit();
      } catch {
        /* ignore */
      }
    };

    const timer = setTimeout(handleResize, 50);
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
    };
  }, [tab]);

  // Clean up xterm on unmount
  useEffect(() => {
    return () => {
      if (ptyFlushTimerRef.current) clearTimeout(ptyFlushTimerRef.current);
      if (xtermRef.current) {
        xtermRef.current.dispose();
        xtermRef.current = null;
        fitAddonRef.current = null;
        xtermInitialized.current = false;
      }
    };
  }, []);

  // Listen for terminal output
  useEffect(() => {
    if (!socket) return;

    const handleTerminalOutput = (data: { machineName: string; output: string; isError?: boolean }) => {
      setTerminalEntries((prev) => [...prev, { type: data.isError ? 'error' : 'output', text: data.output }]);
      setTerminalBusy(false);
    };

    socket.on('terminal_panel_output', handleTerminalOutput);
    return () => {
      socket.off('terminal_panel_output', handleTerminalOutput);
    };
  }, [socket]);

  // Flush buffered PTY data to xterm
  const flushPtyBuffer = useCallback(() => {
    if (xtermRef.current && ptyBufferRef.current) {
      xtermRef.current.write(ptyBufferRef.current);
      ptyBufferRef.current = '';
    }
    ptyFlushTimerRef.current = null;
  }, []);

  // Listen for Claude PTY output — debounced writes to absorb thinking animation
  useEffect(() => {
    if (!socket) return;

    const handleClaudeOutput = (data: { machineName: string; data: string }) => {
      setClaudeSessionActive(true);

      // Buffer the data and debounce — this collapses rapid thinking+erase cycles
      // into a single write showing only the final state
      ptyBufferRef.current += data.data;

      if (ptyFlushTimerRef.current) clearTimeout(ptyFlushTimerRef.current);
      ptyFlushTimerRef.current = setTimeout(flushPtyBuffer, DEBOUNCE_MS);
    };

    const handleClaudeDone = (data: { machineName: string; exitCode: number; elapsed: number }) => {
      // Flush any pending buffer immediately
      if (ptyFlushTimerRef.current) {
        clearTimeout(ptyFlushTimerRef.current);
        flushPtyBuffer();
      }
      if (xtermRef.current) {
        xtermRef.current.write(`\r\n\x1b[90m[Done — exit ${data.exitCode}]\x1b[0m\r\n`);
      }
    };

    socket.on('claude_panel_output', handleClaudeOutput);
    socket.on('claude_panel_done', handleClaudeDone);
    return () => {
      socket.off('claude_panel_output', handleClaudeOutput);
      socket.off('claude_panel_done', handleClaudeDone);
    };
  }, [socket, flushPtyBuffer]);

  // Send text to the Claude PTY
  const sendToClaudePty = useCallback(
    (text: string) => {
      if (!socket || !selectedMachine) {
        console.log('[Claude Panel] sendToClaudePty blocked: socket=', !!socket, 'machine=', selectedMachine);
        return;
      }
      console.log('[Claude Panel] Emitting claude_panel_input:', text, 'machine:', selectedMachine);
      // Clear the terminal before each new command for a fresh render
      if (xtermRef.current) {
        xtermRef.current.clear();
      }
      socket.emit('claude_panel_input', { machineName: selectedMachine, input: text, approved });
    },
    [socket, selectedMachine, approved],
  );

  const handleSubmit = useCallback(() => {
    console.log(
      '[Claude Panel] handleSubmit called, input:',
      input,
      'tab:',
      tab,
      'socket:',
      !!socket,
      'machine:',
      selectedMachine,
    );
    if (!input.trim() || !socket || !selectedMachine) {
      console.log('[Claude Panel] handleSubmit blocked: empty input or no socket/machine');
      return;
    }

    const text = input.trim();
    setInput('');

    if (tab === 'terminal') {
      if (terminalBusy) return;
      setTerminalEntries((prev) => [...prev, { type: 'input', text }]);
      setTerminalBusy(true);
      socket.emit('terminal_panel_input', { machineName: selectedMachine, command: text });
    } else {
      // Claude tab: always allow sending — it's a live PTY session
      sendToClaudePty(text);
    }
  }, [input, socket, selectedMachine, terminalBusy, tab, sendToClaudePty]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleStopSession = useCallback(() => {
    if (!socket || !selectedMachine) return;
    socket.emit('claude_panel_stop', { machineName: selectedMachine });
    // Flush buffer and show interrupted message
    if (ptyFlushTimerRef.current) {
      clearTimeout(ptyFlushTimerRef.current);
      ptyBufferRef.current = '';
    }
    if (xtermRef.current) {
      xtermRef.current.write('\r\n\x1b[91m[Interrupted]\x1b[0m\r\n');
    }
  }, [socket, selectedMachine]);

  const machine = machines.find((m) => m.name === selectedMachine);
  const isOnline = machine?.status === 'online';

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

        <select
          className={styles.machineSelect}
          value={selectedMachine}
          onChange={(e) => setSelectedMachine(e.target.value)}
        >
          {onlineMachines.length === 0 && <option value="">No machines online</option>}
          {onlineMachines.map((m) => (
            <option key={m.id} value={m.name}>
              {m.name} ({m.os || 'unknown'})
            </option>
          ))}
        </select>

        <div
          className={`${styles.statusDot} ${isOnline ? styles.online : styles.offline}`}
          title={isOnline ? 'Online' : 'Offline'}
        />

        {tab === 'claude' && claudeSessionActive && (
          <IconButton size="small" onClick={handleStopSession} title="Stop session" sx={{ flexShrink: 0 }}>
            <StopIcon sx={{ fontSize: 16, color: '#f85149' }} />
          </IconButton>
        )}

        <IconButton size="small" onClick={onClose} sx={{ flexShrink: 0 }}>
          <CloseIcon sx={{ fontSize: 16, color: '#8b949e' }} />
        </IconButton>
      </div>

      {/* Terminal tab: structured entries */}
      <div className={styles.output} ref={outputRef} style={{ display: tab === 'terminal' ? 'block' : 'none' }}>
        {terminalEntries.length === 0 && (
          <div className={styles.empty}>Type a command below to execute on the remote machine.</div>
        )}
        {terminalEntries.map((entry, i) => (
          <div key={i} className={styles.entry}>
            {entry.type === 'input' && <div className={styles.inputLine}>{entry.text}</div>}
            {entry.type === 'output' && <div className={styles.outputLine}>{entry.text}</div>}
            {entry.type === 'error' && <div className={styles.errorLine}>{entry.text}</div>}
          </div>
        ))}
        {terminalBusy && <div className={styles.systemLine}>Running...</div>}
      </div>

      {/* Claude tab: xterm.js terminal */}
      <div
        className={styles.xtermContainer}
        ref={xtermContainerRef}
        style={{ display: tab === 'claude' ? 'flex' : 'none' }}
      />

      <div className={styles.inputArea}>
        <span className={styles.prompt}>{tab === 'terminal' ? '$' : '>'}</span>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tab === 'terminal' ? 'Enter command...' : 'Type into Claude session...'}
          disabled={!isOnline}
        />
        {tab === 'claude' && (
          <>
            <div className={styles.quickActions}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => sendToClaudePty('1')}
                disabled={!isOnline}
                sx={{ minWidth: 28, p: '1px 6px', fontSize: '0.65rem', lineHeight: 1.4 }}
              >
                1
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => sendToClaudePty('2')}
                disabled={!isOnline}
                sx={{ minWidth: 28, p: '1px 6px', fontSize: '0.65rem', lineHeight: 1.4 }}
              >
                2
              </Button>
              <Button
                size="small"
                variant="outlined"
                onClick={() => sendToClaudePty('3')}
                disabled={!isOnline}
                sx={{ minWidth: 28, p: '1px 6px', fontSize: '0.65rem', lineHeight: 1.4 }}
              >
                3
              </Button>
            </div>
            <label className={styles.approveToggle} title="Allow Claude to write/edit files and run commands">
              <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
              <span>Full</span>
            </label>
          </>
        )}
        <button className={styles.sendBtn} onClick={handleSubmit} disabled={!input.trim() || !isOnline}>
          {tab === 'terminal' ? 'Run' : 'Send'}
        </button>
      </div>
    </div>
  );
};

export default TerminalPanel;
