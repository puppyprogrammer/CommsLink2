#!/usr/bin/env node

import { program } from 'commander';
import { io, Socket } from 'socket.io-client';
import { exec } from 'child_process';
import { platform, hostname, type as osType } from 'os';
import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync, appendFileSync, unlinkSync, renameSync, createWriteStream, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { request as httpsRequest } from 'https';
import { request as httpRequest } from 'http';
import { spawn } from 'child_process';
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

const AGENT_VERSION = '1.7.5';
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
  const ptyProcess = pty.spawn(shell, ['--dangerously-skip-permissions'], {
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
      // AI mode: use `claude -p` (print mode) for clean text output.
      // No TUI, no ANSI, no /btw polling, no /copy clipboard scraping.
      // Just spawn a process, read stdout, done.
      const execId = data.execId;
      const MAX_WAIT_MS = 900_000; // 15 min absolute max
      const HEARTBEAT_INTERVAL = 30_000; // 30s between heartbeat checks
      const HUNG_THRESHOLD = 120_000; // 2 min no output = probably hung

      log(`[Claude Print] Spawning claude -p for ${execId}: ${userInput.substring(0, 100)}...`);

      let stdout = '';
      let stderr = '';
      let finished = false;
      let lastOutputTime = Date.now();
      const startTime = Date.now();
      let heartbeatCount = 0;

      const cleanup = (): void => {
        clearInterval(heartbeatTimer);
      };

      // On Windows, spawn cmd.exe directly with /c instead of using shell: true
      // shell: true wraps as cmd.exe /d /s /c "..." which can cause stdin piping issues
      // where cmd.exe consumes stdin before the child process reads it
      const isWin = platform() === 'win32';
      const claudeProc = isWin
        ? spawn('cmd.exe', ['/c', 'claude', '-p', '--dangerously-skip-permissions'], {
            cwd: homedir(),
            env: process.env as Record<string, string>,
            stdio: ['pipe', 'pipe', 'pipe'],
          })
        : spawn('claude', ['-p', '--dangerously-skip-permissions'], {
            cwd: homedir(),
            env: process.env as Record<string, string>,
            stdio: ['pipe', 'pipe', 'pipe'],
          });

      log(`[Claude Print] Process spawned, pid=${claudeProc.pid}`);

      // Write prompt to stdin and close it so Claude knows input is complete
      // Small delay on Windows to let the process initialize before writing stdin
      const writeStdin = (): void => {
        try {
          claudeProc.stdin.write(userInput + '\n');
          claudeProc.stdin.end();
          log(`[Claude Print] stdin written (${userInput.length} chars) and closed`);
        } catch (stdinErr) {
          log(`[Claude Print] stdin write error: ${stdinErr}`);
        }
      };
      if (isWin) {
        setTimeout(writeStdin, 500);
      } else {
        writeStdin();
      }

      claudeProc.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdout += text;
        lastOutputTime = Date.now();
        heartbeatCount = 0; // Reset consecutive silent heartbeats
        // Mirror progress to web panel
        socket.emit('claude_session_output', { sessionKey: data.sessionKey, data: text });
      });

      claudeProc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        lastOutputTime = Date.now();
        log(`[Claude Print] stderr: ${text.substring(0, 200)}`);
        socket.emit('claude_debug', { execId, type: 'stderr', content: text.substring(0, 500) });
      });

      // Heartbeat: check every 30s if Claude is still producing output
      const heartbeatTimer = setInterval(() => {
        if (finished) { cleanup(); return; }

        const silentMs = Date.now() - lastOutputTime;
        const elapsedS = Math.round((Date.now() - startTime) / 1000);

        if (silentMs >= HUNG_THRESHOLD) {
          // No output for 2+ minutes — Claude is likely hung
          heartbeatCount++;
          if (heartbeatCount >= 2) {
            // 2 consecutive hung heartbeats (4+ min silence) — kill it
            cleanup();
            finished = true;
            log(`[Claude Print] Hung detected for ${execId}, killing after ${elapsedS}s. stderr: ${stderr.substring(0, 200)}`);
            try { claudeProc.kill(); } catch { /* ignore */ }
            const stderrMsg = stderr.trim() ? `\nstderr: ${stderr.trim().substring(0, 500)}` : '';
            const output = stdout.trim() || `(Claude hung — no output for ${Math.round(silentMs / 1000)}s${stderrMsg})`;
            const responsePayload = { output: output.substring(0, 16000), exitCode: 1 };
            socket.emit(`claude_pty_response:${execId}`, responsePayload);
            socket.emit('claude_pty_response', responsePayload);
            return;
          }
          // First hung heartbeat — warn but keep waiting
          log(`[Claude Print] No output for ${Math.round(silentMs / 1000)}s on ${execId}`);
          socket.emit('claude_session_output', {
            sessionKey: data.sessionKey,
            data: `\n⚠ [Heartbeat ${elapsedS}s] No output for ${Math.round(silentMs / 1000)}s — Claude may be hung\n`,
          });
          socket.emit('claude_debug', {
            execId,
            type: 'heartbeat',
            status: 'silent',
            elapsedSeconds: elapsedS,
            silentSeconds: Math.round(silentMs / 1000),
          });
        } else {
          // Claude produced output recently — it's alive
          log(`[Claude Print] Heartbeat OK for ${execId} at ${elapsedS}s (${stdout.length} chars so far)`);
          socket.emit('claude_session_output', {
            sessionKey: data.sessionKey,
            data: `\n✓ [Heartbeat ${elapsedS}s] Claude is working... (${stdout.length} chars)\n`,
          });
        }
      }, HEARTBEAT_INTERVAL);

      claudeProc.on('close', (code: number | null) => {
        if (finished) return;
        finished = true;
        cleanup();

        const elapsedS = Math.round((Date.now() - startTime) / 1000);
        const output = stdout.trim() || stderr.trim() || '(no response)';
        log(`[Claude Print] done for ${execId}, exit=${code}, ${output.length} chars, ${elapsedS}s`);
        const responsePayload = { output: output.substring(0, 16000), exitCode: code || 0 };
        socket.emit(`claude_pty_response:${execId}`, responsePayload);
        socket.emit('claude_pty_response', responsePayload);
      });

      claudeProc.on('error', (err: Error) => {
        if (finished) return;
        finished = true;
        cleanup();

        log(`[Claude Print] spawn error for ${execId}: ${err.message}`);
        const responsePayload = { output: `Error: ${err.message}`, exitCode: 1 };
        socket.emit(`claude_pty_response:${execId}`, responsePayload);
        socket.emit('claude_pty_response', responsePayload);
      });

      // Absolute timeout
      setTimeout(() => {
        if (!finished) {
          finished = true;
          cleanup();
          log(`[Claude Print] Absolute timeout for ${execId}`);
          try { claudeProc.kill(); } catch { /* ignore */ }
          const output = stdout.trim() || '(timed out — no response)';
          const responsePayload = { output: output.substring(0, 16000), exitCode: 1 };
          socket.emit(`claude_pty_response:${execId}`, responsePayload);
          socket.emit('claude_pty_response', responsePayload);
        }
      }, MAX_WAIT_MS);
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
  // │ Auto-Update                              │
  // └──────────────────────────────────────────┘

  let isUpdating = false;

  socket.on('update_required', async (data: { currentVersion: string; newVersion: string; downloadUrl: string }) => {
    if (isUpdating) return;
    isUpdating = true;

    const msg = `Update available: v${data.currentVersion} → v${data.newVersion}`;
    consoleLog(msg);
    log(msg);

    try {
      // Determine the path of the currently running binary
      const currentBinary = process.execPath;
      const isWindows = platform() === 'win32';
      const tempPath = currentBinary + '.update';
      const oldPath = currentBinary + '.old';

      log(`[Update] Downloading from ${data.downloadUrl}`);
      consoleLog('Downloading update...');

      // Download the new binary
      await new Promise<void>((resolve, reject) => {
        const url = new URL(data.downloadUrl);
        const reqFn = url.protocol === 'https:' ? httpsRequest : httpRequest;

        const doRequest = (requestUrl: URL): void => {
          const req = reqFn({
            hostname: requestUrl.hostname,
            port: requestUrl.port || (requestUrl.protocol === 'https:' ? 443 : 80),
            path: requestUrl.pathname + requestUrl.search,
            method: 'GET',
          }, (res) => {
            // Follow redirects
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              doRequest(new URL(res.headers.location, requestUrl.toString()));
              return;
            }

            if (res.statusCode !== 200) {
              reject(new Error(`Download failed: HTTP ${res.statusCode}`));
              return;
            }

            const file = createWriteStream(tempPath);
            res.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
            file.on('error', reject);
          });
          req.on('error', reject);
          req.end();
        };

        doRequest(url);
      });

      log(`[Update] Downloaded to ${tempPath}`);

      // Replace the binary
      if (isWindows) {
        // Windows: can't overwrite running exe — rename current to .old, then rename new to current
        try { unlinkSync(oldPath); } catch { /* .old may not exist */ }
        renameSync(currentBinary, oldPath);
        renameSync(tempPath, currentBinary);
      } else {
        // Unix: can overwrite running binary (inode stays valid for current process)
        renameSync(tempPath, currentBinary);
        chmodSync(currentBinary, 0o755);
      }

      log(`[Update] Binary replaced. Respawning...`);
      consoleLog(`Updated to v${data.newVersion}. Restarting...`);

      // Respawn with the same arguments
      const child = spawn(currentBinary, process.argv.slice(2), {
        detached: true,
        stdio: 'ignore',
        cwd: process.cwd(),
      });
      child.unref();

      // Give the new process a moment to start, then exit
      setTimeout(() => {
        socket.disconnect();
        process.exit(0);
      }, 1000);
    } catch (err) {
      const errMsg = `[Update] Failed: ${err instanceof Error ? err.message : String(err)}`;
      log(errMsg);
      consoleLog(errMsg);
      isUpdating = false;
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
