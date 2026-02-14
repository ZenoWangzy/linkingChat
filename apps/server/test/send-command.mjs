/**
 * Simulates a mobile client sending a command to the desktop.
 * Usage: node test/send-command.mjs
 *
 * Prerequisites:
 *   - Server running (pnpm --filter server dev)
 *   - Desktop running and connected (pnpm --filter desktop dev)
 */

import { io } from 'socket.io-client';

const API_BASE = 'http://localhost:3008';
const EMAIL = 'test@linkingchat.com';
const PASSWORD = 'Test1234x';
const TARGET_DEVICE = 'device-yehui-win32';

async function main() {
  // 1. Login to get JWT
  console.log('[1] Logging in...');
  const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (!res.ok) {
    console.error('Login failed:', await res.text());
    process.exit(1);
  }

  const { accessToken } = await res.json();
  console.log('[1] Login OK, token obtained');

  // 2. Connect to WS as mobile client
  console.log('[2] Connecting to /device namespace...');
  const socket = io(`${API_BASE}/device`, {
    auth: { token: accessToken, deviceType: 'mobile' },
    transports: ['websocket'],
  });

  socket.on('connect', () => {
    console.log('[2] Connected as mobile client');

    // 3. Send a safe command
    const command = process.argv[2] || 'echo Hello from LinkingChat!';
    console.log(`[3] Sending command: "${command}" → ${TARGET_DEVICE}`);

    socket.emit(
      'device:command:send',
      {
        requestId: `test-${Date.now()}`,
        timestamp: new Date().toISOString(),
        data: {
          targetDeviceId: TARGET_DEVICE,
          type: 'shell',
          action: command,
          timeout: 10000,
        },
      },
      (ack) => {
        console.log('[3] ACK:', JSON.stringify(ack, null, 2));
      },
    );
  });

  // 4. Listen for result
  socket.on('device:result:delivered', (result) => {
    console.log('\n[4] Result received:');
    console.log('    Status:', result.status);
    console.log('    Output:', result.data?.output?.trim());
    console.log('    Exit code:', result.data?.exitCode);
    console.log('    Time:', result.executionTimeMs, 'ms');
    console.log('\n--- Full chain verified! ---');
    socket.disconnect();
    process.exit(0);
  });

  socket.on('connect_error', (err) => {
    console.error('WS error:', err.message);
    process.exit(1);
  });

  // Timeout
  setTimeout(() => {
    console.error('Timeout: no result in 15 seconds');
    socket.disconnect();
    process.exit(1);
  }, 15000);
}

main();
