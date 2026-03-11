/**
 * Test script: Connects as lunaprey, joins "research lab", sends two math
 * problems to Claude via the terminal panel, waits for responses.
 *
 * Usage: npx tsx scripts/test-claude-panel.ts
 */
import { io } from 'socket.io-client';

const SERVER = 'wss://commslink.net';
const ROOM = 'research lab';
const MACHINE = 'lunaprey-pc'; // adjust to actual machine name

// Login first to get a token
async function login(username: string, password: string): Promise<string> {
  const res = await fetch('https://commslink.net/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  const token = data.token || data.data?.token;
  if (!token) throw new Error(`Login failed: ${JSON.stringify(data)}`);
  return token;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Get credentials from env or prompt
  const username = process.env.CL_USER || 'lunaprey';
  const password = process.env.CL_PASS;
  const machineName = process.env.CL_MACHINE || MACHINE;

  if (!password) {
    console.error('Set CL_PASS environment variable with the password');
    process.exit(1);
  }

  console.log(`Logging in as ${username}...`);
  const token = await login(username, password);
  console.log('Login successful');

  console.log(`Connecting to ${SERVER}...`);
  const socket = io(SERVER, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });

  await new Promise<void>((resolve, reject) => {
    socket.on('connect', () => {
      console.log(`Connected (socket ${socket.id})`);
      resolve();
    });
    socket.on('connect_error', (err) => {
      console.error(`Connection error: ${err.message}`);
      reject(err);
    });
  });

  // Join the room
  console.log(`Joining room "${ROOM}"...`);
  socket.emit('join_room', { roomName: ROOM });
  await sleep(2000);

  // Collect all panel output
  const output: string[] = [];
  socket.on('claude_panel_output', (data: { machineName: string; data: string }) => {
    // Strip ANSI for display
    const clean = data.data.replace(
      // eslint-disable-next-line no-control-regex
      /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
      '',
    );
    if (clean.trim()) {
      output.push(clean);
      process.stdout.write(`[PTY] ${clean}`);
    }
  });

  // Helper: send a message and wait for output to settle
  async function sendAndWait(message: string, timeoutMs = 120_000): Promise<string> {
    output.length = 0;
    console.log(`\n>>> Sending: "${message}"`);
    socket.emit('claude_panel_input', { machineName, input: message, approved: false });

    // Wait for output to stop flowing (5s of silence)
    let lastLen = -1;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await sleep(3000);
      if (output.length > 0 && output.length === lastLen) {
        // Output settled
        break;
      }
      lastLen = output.length;
    }

    return output.join('');
  }

  // Test 1: First math problem
  console.log('\n=== TEST 1: First math problem ===');
  const response1 = await sendAndWait('What is 247 * 19? Just give me the number.');
  console.log(`\n--- Response 1 (${response1.length} chars) ---`);
  console.log(response1.substring(0, 500));

  if (response1.length < 5) {
    console.error('FAIL: No response received for first question');
  } else {
    console.log('PASS: Got response for first question');
  }

  // Wait a beat
  await sleep(3000);

  // Test 2: Second math problem
  console.log('\n=== TEST 2: Second math problem ===');
  const response2 = await sendAndWait('What is 1234 + 5678? Just give me the number.');
  console.log(`\n--- Response 2 (${response2.length} chars) ---`);
  console.log(response2.substring(0, 500));

  if (response2.length < 5) {
    console.error('FAIL: No response received for second question');
  } else {
    console.log('PASS: Got response for second question');
  }

  // Check the logs
  console.log('\n=== Checking claude_log table ===');
  // We can't query DB directly, but let's check the chat messages
  await sleep(2000);

  console.log('\n=== RESULTS ===');
  console.log(`Test 1: ${response1.length > 5 ? 'PASS' : 'FAIL'}`);
  console.log(`Test 2: ${response2.length > 5 ? 'PASS' : 'FAIL'}`);

  socket.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
