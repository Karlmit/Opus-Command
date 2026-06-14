#!/usr/bin/env node
'use strict';

const provider = process.argv[2] || process.env.OPUS_AGENT_PROVIDER || 'unknown';
const configuredEvent = process.argv[3] || process.env.OPUS_AGENT_HOOK_EVENT || '';

function readStdin() {
  return new Promise(resolve => {
    const chunks = [];
    process.stdin.on('data', chunk => chunks.push(Buffer.from(chunk)));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  const baseUrl = (process.env.OPUS_COMMAND_URL || 'http://opus-command:3000').replace(/\/+$/, '');
  const token = process.env.OPUS_WORKSPACE_TOKEN || '';
  const terminalSessionId = process.env.OPUS_TERMINAL_SESSION_ID || '';
  const event = payload.hook_event_name || payload.hookEventName || configuredEvent || 'Unknown';

  if (!token || !terminalSessionId) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    await fetch(`${baseUrl}/api/agent-events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        provider,
        event,
        terminalSessionId,
        cliSessionId: payload.session_id || payload.sessionId || null,
        cwd: payload.cwd || process.cwd(),
        payload,
      }),
      signal: controller.signal,
    });
  } catch (_) {
    // Hooks must never interrupt the CLI. Opus falls back to PTY heuristics.
  } finally {
    clearTimeout(timeout);
  }
}

main().finally(() => process.exit(0));
