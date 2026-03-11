#!/usr/bin/env node

import { program } from 'commander';
import { io, Socket } from 'socket.io-client';
import { exec } from 'child_process';
import { platform, hostname, type as osType } from 'os';
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import * as pty from 'node-pty';

// ┌──────────────────────────────────────────┐
// │ Log file + pause on exit                 │
// └──────────────────────────────────────────┘

const LOG_FILE = join(homedir(), '.commslink-agent.log');

const writeLog = (msg: string): void => {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
};

const waitForEnter = (): Promise<void> =>
  new Promise((resolve) => {
    console.log('\nPress Enter to exit...');
    const rl2 = createInterface({ input: process.stdin, output: process.stdout });
    rl2.question('', () => { rl2.close(); resolve(); });
  });

const die = async (msg: string): Promise<never> => {
  console.error(msg);
  writeLog(`FATAL: ${msg}`);
  await waitForEnter();
  process.exit(1);
};

// Global error handlers so the exe never crashes silently
process.on('uncaughtException', async (err) => {
  const msg = `Uncaught exception: ${err.message}\n${err.stack || ''}`;
  writeLog(msg);
  console.error(`\n${msg}`);
  await waitForEnter();
  process.exit(1);
});
process.on('unhandledRejection', async (reason) => {
  const msg = `Unhandled rejection: ${reason}`;
  writeLog(msg);
  console.error(`\n${msg}`);
  await waitForEnter();
  process.exit(1);
});

// ┌──────────────────────────────────────────┐
// │ Config                                   │
// └──────────────────────────────────────────┘

type SavedConfig = {
  server: string;
  token: string;
  machineName: string;
  username: string;
};

const CONFIG_PATH = join(homedir(), '.commslink-agent.json');

const loadConfig = (): SavedConfig | null => {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch { /* ignore */ }
  return null;
};

const saveConfig = (config: SavedConfig): void => {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
};

// ┌──────────────────────────────────────────┐
// │ CLI Arguments                            │
// └──────────────────────────────────────────┘

program
  .name('commslink-agent')
  .description('CommsLink Terminal Agent — connects your machine to CommsLink for remote command execution and Claude Code sessions')
  .option('-s, --server <url>', 'CommsLink server URL')
  .option('-t, --token <jwt>', 'JWT authentication token')
  .option('-n, --name <name>', 'Machine name')
  .option('-S, --shell <shell>', 'Shell to use', platform() === 'win32' ? 'cmd.exe' : '/bin/bash')
  .option('--setup <code>', 'Setup code from CommsLink room settings')
  .option('--no-claude', 'Skip launching Claude Code after connecting')
  .parse();

const opts = program.opts<{
  server?: string;
  token?: string;
  name?: string;
  shell: string;
  setup?: string;
  claude: boolean;
}>();

// ┌──────────────────────────────────────────┐
// │ Interactive Prompt                       │
// └──────────────────────────────────────────┘

const rl = createInterface({ input: process.stdin, output: process.stdout });

const ask = (question: string, defaultVal?: string): Promise<string> =>
  new Promise((resolve) => {
    const suffix = defaultVal ? ` [${defaultVal}]` : '';
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '');
    });
  });

const askPassword = (question: string): Promise<string> =>
  new Promise((resolve) => {
    rl.question(`${question}: `, (answer) => {
      resolve(answer.trim());
    });
  });

// ┌──────────────────────────────────────────┐
// │ Logging                                  │
// └──────────────────────────────────────────┘

const log = (msg: string): void => {
  const ts = new Date().toISOString().slice(11, 19);
  const line = `[${ts}] ${msg}`;
  // Don't console.log during Claude interactive mode — it would mess up the TUI
  writeLog(msg);
};

// Log to console only when Claude is not running interactively
let claudeInteractiveRunning = false;

const consoleLog = (msg: string): void => {
  if (!claudeInteractiveRunning) {
    const ts = new Date().toISOString().slice(11, 19);
    console.log(`[${ts}] ${msg}`);
  }
  writeLog(msg);
};

const AGENT_VERSION = '1.2.1';
const osInfo = `${osType()} ${platform()}`;

// ┌──────────────────────────────────────────┐
// │ Login via API                            │
// └──────────────────────────────────────────┘

const login = async (server: string, username: string, password: string): Promise<string> => {
  const apiBase = server
    .replace('wss://', 'https://')
    .replace('ws://', 'http://');

  const apiUrl = `${apiBase}/api/v1/auth/login`;
  consoleLog(`Logging in to ${apiUrl}...`);

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ username, password });
    const url = new URL(apiUrl);
    const isHttps = url.protocol === 'https:';
    const reqFn = isHttps ? httpsRequest : httpRequest;

    const req = reqFn(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          log(`Login response: HTTP ${res.statusCode}`);
          try {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Login failed (HTTP ${res.statusCode}): ${body}`));
              return;
            }
            const data = JSON.parse(body) as { token?: string; user?: unknown; data?: { token?: string; result?: string; message?: string } };
            const token = data.token || data.data?.token;
            if (!token) {
              reject(new Error(data.data?.message || 'Login failed: no token in response'));
              return;
            }
            resolve(token);
          } catch (err) {
            reject(new Error(`Failed to parse login response: ${body}`));
          }
        });
      },
    );

    req.on('error', (err: Error) => {
      reject(new Error(`Connection error: ${err.message}`));
    });

    req.write(postData);
    req.end();
  });
};

// ┌──────────────────────────────────────────┐
// │ Setup via Code                           │
// └──────────────────────────────────────────┘

const setupFromCode = async (code: string): Promise<SavedConfig> => {
  try {
    const decoded = JSON.parse(Buffer.from(code, 'base64').toString('utf-8'));
    const { server, username, machineName } = decoded;

    console.log(`\nSetup code decoded:`);
    console.log(`  Server:  ${server}`);
    console.log(`  User:    ${username}`);
    console.log(`  Machine: ${machineName}\n`);

    const password = await askPassword('Enter your password to confirm');
    const token = await login(server, username, password);

    console.log('Login successful!\n');

    return { server, token, machineName, username };
  } catch (err) {
    if ((err as Error).message.includes('Login failed')) throw err;
    throw new Error('Invalid setup code. Copy the code from Room Settings in CommsLink.');
  }
};

// ┌──────────────────────────────────────────┐
// │ Launch Interactive Claude Code (PTY)     │
// └──────────────────────────────────────────┘

// Active PTY process — used by both local typing and remote commands
let activePty: pty.IPty | null = null;

const launchInteractiveClaude = (socket: Socket, machineName: string): void => {
  claudeInteractiveRunning = true;

  console.log('\n  ╔═══════════════════════════════════════╗');
  console.log('  ║   Claude Code — Interactive Session    ║');
  console.log('  ║   Output is mirrored to CommsLink      ║');
  console.log('  ║   Ctrl+C to exit Claude                ║');
  console.log('  ╚═══════════════════════════════════════╝\n');

  const shell = platform() === 'win32' ? 'claude.cmd' : 'claude';

  // Spawn Claude in a real pseudo-terminal (PTY)
  // This gives Claude a real TTY so it renders the full TUI with colors, thinking, etc.
  // We can read output (mirror to web) AND write input (remote commands) at the same time.
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: (process.stdout as { columns?: number }).columns || 120,
    rows: (process.stdout as { rows?: number }).rows || 40,
    cwd: homedir(),
    env: process.env as Record<string, string>,
  });

  activePty = ptyProcess;

  // Forward PTY output to local terminal AND mirror to CommsLink
  ptyProcess.onData((data: string) => {
    process.stdout.write(data);
    // Mirror to web panel (raw terminal data — the panel can render it)
    socket.emit('claude_terminal_data', { machineName, data });
  });

  // Forward local keyboard input to PTY
  if (typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();

  const stdinHandler = (data: Buffer) => {
    if (activePty) {
      activePty.write(data.toString());
    }
  };
  process.stdin.on('data', stdinHandler);

  // Handle terminal resize
  const resizeHandler = () => {
    if (activePty) {
      const cols = (process.stdout as { columns?: number }).columns || 120;
      const rows = (process.stdout as { rows?: number }).rows || 40;
      activePty.resize(cols, rows);
    }
  };
  process.stdout.on('resize', resizeHandler);

  ptyProcess.onExit(({ exitCode }) => {
    claudeInteractiveRunning = false;
    activePty = null;

    // Restore stdin
    process.stdin.removeListener('data', stdinHandler);
    if (typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(false);
    }
    process.stdout.removeListener('resize', resizeHandler);

    log(`Claude Code exited (code: ${exitCode})`);
    console.log(`\nClaude Code exited. Agent is still connected to CommsLink.`);
    console.log('Type "claude" to relaunch, or Ctrl+C to stop the agent.\n');

    // After Claude exits, listen for user typing "claude" to relaunch
    const relaunchRl = createInterface({ input: process.stdin, output: process.stdout });
    const promptUser = () => {
      relaunchRl.question('> ', (answer) => {
        const cmd = answer.trim().toLowerCase();
        if (cmd === 'claude' || cmd === 'claude code') {
          relaunchRl.close();
          launchInteractiveClaude(socket, machineName);
        } else if (cmd === 'exit' || cmd === 'quit') {
          relaunchRl.close();
          socket.disconnect();
          process.exit(0);
        } else {
          console.log('Commands: "claude" to relaunch Claude Code, "exit" to quit');
          promptUser();
        }
      });
    };
    promptUser();
  });
};

// ┌──────────────────────────────────────────┐
// │ Connect                                  │
// └──────────────────────────────────────────┘

const connect = (config: SavedConfig): void => {
  consoleLog(`Connecting to ${config.server} as "${config.machineName}" (${osInfo})...`);

  const socket: Socket = io(config.server, {
    auth: { token: config.token },
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 30000,
    reconnectionAttempts: Infinity,
    transports: ['websocket', 'polling'],
  });

  consoleLog('Socket.IO client created, waiting for connection...');

  socket.on('connect', () => {
    consoleLog(`Connected (socket ${socket.id})`);
    socket.emit('machine_register', {
      name: config.machineName,
      os: osInfo,
      version: AGENT_VERSION,
    });
    consoleLog(`Sent machine_register (v${AGENT_VERSION})`);
  });

  let hasRegistered = false;

  socket.on('machine_registered', (data: { id: string; name: string; status: string }) => {
    consoleLog(`Machine registered: ${data.name} (${data.id}) — status: ${data.status}`);

    if (!hasRegistered) {
      hasRegistered = true;

      if (opts.claude !== false) {
        // Check if claude is available before launching
        exec('claude --version', { timeout: 10_000 }, (error, stdout) => {
          if (error) {
            console.log('\nClaude Code not found. Install it with:');
            console.log('  npm install -g @anthropic-ai/claude-code\n');
            console.log('Agent is still connected for remote terminal commands.\n');
          } else {
            console.log(`\nClaude Code found: ${stdout.trim()}`);
            launchInteractiveClaude(socket, config.machineName);
          }
        });
      } else {
        console.log('\nListening for commands... (Ctrl+C to stop)\n');
      }
    }
  });

  socket.on('machine_error', (data: { error: string }) => {
    consoleLog(`Machine error: ${data.error}`);
  });

  // ┌──────────────────────────────────────────┐
  // │ Command Execution                        │
  // └──────────────────────────────────────────┘

  socket.on('terminal_exec', (data: { execId: string; command: string }) => {
    const { execId, command } = data;
    log(`Executing [${execId}]: ${command}`);

    exec(command, {
      shell: opts.shell,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, TERM: 'dumb' },
    }, (error, stdout, stderr) => {
      const exitCode = error ? (error as NodeJS.ErrnoException).code : 0;
      const output = ((stdout || '') + (stderr ? `\n[stderr]: ${stderr}` : '')).substring(0, 4000);
      log(`[${execId}] done (exit: ${exitCode})`);

      socket.emit(`terminal_output:${execId}`, {
        output: output || '(no output)',
        exitCode: typeof exitCode === 'number' ? exitCode : 1,
      });
    });
  });

  // ┌──────────────────────────────────────────┐
  // │ Claude Code — PTY Input (Web Panel/AI)   │
  // └──────────────────────────────────────────┘

  // Both web panel and AI commands are routed through the running interactive Claude PTY.
  // When `collectResponse` is true (AI use), output is accumulated and returned once Claude
  // finishes responding (detected by an inactivity timeout after output starts flowing).

  socket.on('claude_session_input', (data: {
    sessionKey: string;
    input: string;
    approved?: boolean;
    collectResponse?: boolean;
    execId?: string;
  }) => {
    const { input: userInput } = data;
    log(`[Claude PTY Input] collect=${!!data.collectResponse} ${userInput.substring(0, 100)}...`);

    if (!activePty) {
      log('[Claude PTY Input] No active PTY — Claude is not running');
      socket.emit('claude_session_output', {
        sessionKey: data.sessionKey,
        data: '[Error] Claude is not running on this machine. Launch it from the terminal first.\n',
      });
      if (data.collectResponse && data.execId) {
        socket.emit(`claude_pty_response:${data.execId}`, {
          output: 'Error: Claude is not running on this machine.',
          exitCode: 1,
        });
      }
      return;
    }

    if (data.collectResponse && data.execId) {
      // AI mode: accumulate output and detect when Claude is done
      const execId = data.execId;
      const isApproved = !!data.approved;
      let collected = '';
      let hasOutput = false;
      let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
      let totalTimer: ReturnType<typeof setTimeout> | null = null;
      const INACTIVITY_MS = 5_000; // 5s of silence after output starts = done
      const MAX_WAIT_MS = 180_000; // 3 min absolute max

      let disposable: { dispose: () => void } | null = null;
      let finished = false;
      let approvalCount = 0; // track how many approval prompts we've auto-responded to (allow multiple)

      // Strip ANSI escape sequences for pattern matching — comprehensive version
      const stripAnsi = (s: string): string =>
        s
          // OSC sequences (title bar, etc.)
          .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
          // CSI sequences (colors, cursor movement, etc.)
          .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
          // Other ESC sequences
          .replace(/\x1b[^[\]].?/g, '')
          // Remaining control chars except newline/tab
          // eslint-disable-next-line no-control-regex
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
          // Collapse whitespace runs
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n');

      // Detect if Claude is waiting for an approval prompt (1/2/3 or Yes/No)
      const checkForApprovalPrompt = (): boolean => {
        const clean = stripAnsi(collected);
        // Look at the last ~800 chars for the prompt pattern
        const tail = clean.slice(-800);

        // Debug: log what we see so we can diagnose matching issues
        log(`[Claude PTY Collect] Approval check tail (${tail.length} chars): ${tail.slice(-300).replace(/\n/g, '\\n')}`);

        // Claude Code approval patterns (various forms):
        // "Yes", "Yes, and don't ask again for this tool", "No"
        // "Allow once", "Allow always", "Deny"
        // "y/n", numbered options like "1. Yes  2. No"
        // The key indicator is Claude stopped and is waiting with a question
        const patterns = [
          /\bYes\b.*\bNo\b/i,                    // "Yes ... No" on same stretch
          /\bAllow\b.*\bDeny\b/i,                 // "Allow ... Deny"
          /\bAllow once\b/i,                       // "Allow once"
          /\bAllow always\b/i,                     // "Allow always"
          /[12]\.\s*Yes/i,                         // "1. Yes" or "2. Yes"
          /[23]\.\s*No\b/i,                        // "2. No" or "3. No"
          /\bDo you want to\b/i,                   // "Do you want to ..."
          /\bWould you like to\b/i,                // "Would you like to ..."
          /\bProceed\?\s*\(/i,                     // "Proceed? (y/n)"
          /\by\/n\b/i,                             // "y/n"
          /\ballow.*\bthis tool\b/i,               // "allow ... this tool"
          /\bpermission\b.*\b(grant|allow|run)\b/i, // permission prompts
        ];

        return patterns.some((p) => p.test(tail));
      };

      // Read clipboard contents (platform-specific)
      const readClipboard = (): Promise<string> => {
        return new Promise((resolve) => {
          const cmd = platform() === 'win32'
            ? 'powershell -command "Get-Clipboard"'
            : platform() === 'darwin'
              ? 'pbpaste'
              : 'xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null';

          exec(cmd, { timeout: 5_000 }, (error, stdout) => {
            resolve(error ? '' : stdout.trim());
          });
        });
      };

      const finish = async () => {
        if (finished) return;

        // Emit debug info to server so we can diagnose via claude_log
        const debugTail = stripAnsi(collected).slice(-500);
        socket.emit('claude_debug', { execId, phase: 'finish_check', stripped: debugTail });

        // Before finishing, check if Claude is actually waiting for approval
        if (checkForApprovalPrompt()) {
          approvalCount++;
          const choice = isApproved ? '2' : '1'; // 2 = "Yes, always" when approved; 1 = "Yes" otherwise
          log(`[Claude PTY Collect] Detected approval prompt #${approvalCount}, auto-responding with ${choice} (approved=${isApproved})`);
          socket.emit('claude_debug', { execId, phase: 'auto_approve', choice, approvalCount });
          if (activePty) {
            // Claude Code's TUI responds to the digit keypress alone — no Enter needed
            activePty.write(choice);
          }
          // Reset state — Claude will start outputting again after approval
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = null;
          hasOutput = false; // reset so new output restarts inactivity detection
          collected = ''; // clear buffer so we don't re-detect the same prompt
          // Safety net: if Claude goes completely silent after approval (e.g., another
          // approval prompt with no cursor blinks), force a finish check after INACTIVITY_MS
          setTimeout(() => {
            if (!finished && !inactivityTimer) {
              log(`[Claude PTY Collect] Post-approval safety net firing for ${execId}`);
              inactivityTimer = setTimeout(finish, INACTIVITY_MS);
            }
          }, INACTIVITY_MS + 2000);
          return; // don't finish yet — wait for the actual response
        }

        finished = true;
        if (inactivityTimer) clearTimeout(inactivityTimer);
        if (totalTimer) clearTimeout(totalTimer);
        if (disposable) disposable.dispose();

        // Send /copy to Claude PTY — this copies Claude's last response to clipboard
        log(`[Claude PTY Collect] Sending /copy to grab response for ${execId}`);
        if (activePty) {
          activePty.write('/copy\r');
        }

        // Wait for /copy to execute and clipboard to be populated
        await new Promise((r) => setTimeout(r, 1500));

        // Read the clipboard
        const clipboardContent = await readClipboard();
        log(`[Claude PTY Collect] Clipboard for ${execId}: ${clipboardContent.length} chars`);

        const output = clipboardContent || '(no response captured)';

        log(`[Claude PTY Collect] done for ${execId}, ${output.length} chars`);
        const responsePayload = { output: output.substring(0, 16000), exitCode: 0 };
        // Emit with execId for the AI path (executeClaudePrompt listener)
        socket.emit(`claude_pty_response:${execId}`, responsePayload);
        // Also emit generic event for the web panel path (system message posting)
        socket.emit('claude_pty_response', responsePayload);
      };

      disposable = activePty.onData((chunk: string) => {
        collected += chunk;
        // Only treat chunks > 10 bytes as "real" output for inactivity detection.
        // Claude's terminal emits constant tiny cursor blink/position sequences (3-6 bytes)
        // that would otherwise prevent the inactivity timer from ever expiring.
        if (chunk.length > 10) {
          hasOutput = true;
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(finish, INACTIVITY_MS);
        } else if (hasOutput && !inactivityTimer) {
          // If we already got real output but timer isn't running, start it
          inactivityTimer = setTimeout(finish, INACTIVITY_MS);
        }
      });

      // Start absolute timeout
      totalTimer = setTimeout(() => {
        if (!hasOutput) {
          finish();
        }
        // If we have output, let inactivity timer handle it
      }, MAX_WAIT_MS);

      // Write the prompt into the PTY
      activePty.write(userInput + '\r');
    } else {
      // Web panel mode: just type into the PTY, output is mirrored in real-time
      activePty.write(userInput + '\r');
      socket.emit('claude_session_output', { sessionKey: data.sessionKey, data: `> ${userInput}\n` });
    }
  });

  socket.on('claude_session_stop', () => {
    // Send Ctrl+C to the PTY to interrupt Claude
    if (activePty) {
      log('[Claude PTY] Sending Ctrl+C');
      activePty.write('\x03');
    }
  });

  // ┌──────────────────────────────────────────┐
  // │ Connection Lifecycle                     │
  // └──────────────────────────────────────────┘

  socket.on('disconnect', (reason: string) => {
    log(`Disconnected: ${reason}`);
  });

  socket.on('reconnect', () => {
    log('Reconnected');
    socket.emit('machine_register', {
      name: config.machineName,
      os: osInfo,
      version: AGENT_VERSION,
    });
  });

  socket.on('connect_error', (err: Error) => {
    log(`Connection error: ${err.message}`);
    if (err.message === 'Authentication error') {
      log('Token may have expired. Delete ~/.commslink-agent.json and re-run.');
    }
  });

  socket.on('error', (err: Error) => {
    log(`Socket error: ${err.message}`);
  });

  const shutdown = (): void => {
    log('Shutting down...');
    socket.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    // If Claude is running interactively, let it handle Ctrl+C
    // Only shut down if Claude is not running
    if (!claudeInteractiveRunning) {
      shutdown();
    }
  });
  process.on('SIGTERM', shutdown);

  // Keep process alive
  setInterval(() => {
    if (!socket.connected) {
      log('Waiting for reconnection...');
    }
  }, 60_000);
};

// ┌──────────────────────────────────────────┐
// │ Main                                     │
// └──────────────────────────────────────────┘

const main = async (): Promise<void> => {
  console.log('');
  console.log(`  CommsLink Terminal Agent v${AGENT_VERSION}`);
  console.log('  =======================');
  console.log(`  Log file: ${LOG_FILE}\n`);

  writeLog('--- Agent started ---');

  try {
    // Priority 1: CLI args (all provided)
    if (opts.server && opts.token && opts.name) {
      consoleLog('Using CLI arguments');
      rl.close();
      connect({ server: opts.server, token: opts.token, machineName: opts.name, username: '' });
      return;
    }

    // Priority 2: Setup code
    if (opts.setup) {
      consoleLog('Using setup code');
      const config = await setupFromCode(opts.setup);
      saveConfig(config);
      console.log(`Config saved to ${CONFIG_PATH}\n`);
      rl.close();
      connect(config);
      return;
    }

    // Priority 3: Saved config
    const saved = loadConfig();
    if (saved) {
      consoleLog('Found saved config');
      console.log(`  Found saved config:`);
      console.log(`    Server:  ${saved.server}`);
      console.log(`    User:    ${saved.username}`);
      console.log(`    Machine: ${saved.machineName}\n`);

      const useExisting = await ask('Use saved config? (y/n)', 'y');
      if (useExisting.toLowerCase() === 'y' || useExisting.toLowerCase() === 'yes') {
        rl.close();
        connect(saved);
        return;
      }
    }

    // Priority 4: Interactive setup
    consoleLog('Starting interactive setup');
    console.log('  No configuration found. Let\'s set up.\n');

    const username = await ask('CommsLink Username');
    const password = await askPassword('Password');
    const server = await ask('Server (press Enter for default)', 'wss://commslink.net');

    if (!username || !password) {
      await die('Username and password are required.');
    }

    console.log('\nLogging in...');
    consoleLog(`Attempting login for user: ${username}`);

    const token = await login(server, username, password);
    consoleLog('Login successful');
    console.log('Login successful!\n');

    const machineName = await ask('Machine name', hostname().toLowerCase());
    consoleLog(`Machine name: ${machineName}`);

    const config: SavedConfig = { server, token, machineName, username };
    saveConfig(config);
    consoleLog(`Config saved to ${CONFIG_PATH}`);
    console.log(`Config saved to ${CONFIG_PATH}\n`);

    rl.close();
    consoleLog('Starting connection...');
    connect(config);
  } catch (err) {
    await die(`Error: ${(err as Error).message}`);
  }
};

main();
