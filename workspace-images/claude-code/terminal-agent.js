#!/usr/bin/env node
/**
 * terminal-agent — runs inside each workspace container.
 *
 * Owns all PTY sessions for the workspace. Opus Command connects to this
 * process to proxy terminal I/O. Sessions survive Opus Command restarts
 * because they live here, not in the main app.
 *
 * HTTP REST API:
 *   GET  /health
 *   GET  /sessions
 *   POST /sessions              body: { sessionId, name, cols, rows }
 *   DELETE /sessions/:id
 *   POST /sessions/:id/resize   body: { cols, rows }
 *
 * WebSocket API (one connection per session):
 *   ws://host:7681/sessions/:id
 *
 *   Client → Agent:
 *     { type: 'input',  data: string }
 *     { type: 'resize', cols: number, rows: number }
 *
 *   Agent → Client:
 *     { type: 'scrollback', data: string }   — sent once on attach
 *     { type: 'attached',   sessionId }
 *     { type: 'output',     data: string }
 *     { type: 'exit',       exitCode: number }
 *     { type: 'error',      message: string }
 */
'use strict';

const http   = require('http');
const { WebSocketServer } = require('ws');
const pty    = require('node-pty');
const { randomUUID } = require('crypto');
const url    = require('url');

const PORT       = parseInt(process.env.TERMINAL_AGENT_PORT || '7681', 10);
const MAX_BUFFER = 500_000; // bytes of raw terminal sequences to keep

// Map<sessionId, SessionEntry>
const sessions = new Map();

// ── Session management ───────────────────────────────────────────────────────

function createSession({ sessionId, name, cols = 80, rows = 24 } = {}) {
  const id   = sessionId || randomUUID();
  const sName = name || 'Terminal';

  const ptyProcess = pty.spawn('/bin/bash', [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: '/workspace',
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  const entry = {
    id,
    name: sName,
    pty:  ptyProcess,
    buffer: '',            // raw sequences for scrollback replay
    clients: new Set(),   // connected WebSocket clients
  };
  sessions.set(id, entry);

  ptyProcess.onData(data => {
    const s = sessions.get(id);
    if (!s) return;

    s.buffer += data;
    if (s.buffer.length > MAX_BUFFER) {
      s.buffer = s.buffer.slice(s.buffer.length - MAX_BUFFER / 2);
    }

    const msg = JSON.stringify({ type: 'output', data });
    for (const ws of s.clients) {
      if (ws.readyState === 1 /* OPEN */) ws.send(msg);
    }
  });

  ptyProcess.onExit(({ exitCode }) => {
    const s = sessions.get(id);
    if (s) {
      const msg = JSON.stringify({ type: 'exit', exitCode });
      for (const ws of s.clients) {
        if (ws.readyState === 1) ws.send(msg);
      }
      s.pty = null;
    }
    sessions.delete(id);
    console.log(`[agent] session ${id.slice(0, 8)} exited (code ${exitCode})`);
  });

  console.log(`[agent] created session ${id.slice(0, 8)} (${sName}) cols=${cols} rows=${rows}`);
  return { sessionId: id, name: sName };
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ── HTTP server ──────────────────────────────────────────────────────────────

const httpServer = http.createServer(async (req, res) => {
  const { pathname } = url.parse(req.url || '/');
  const method = req.method || 'GET';

  // GET /health
  if (method === 'GET' && pathname === '/health') {
    return send(res, 200, { status: 'ok', sessions: sessions.size });
  }

  // GET /sessions
  if (method === 'GET' && pathname === '/sessions') {
    const list = [...sessions.values()].map(s => ({
      id:    s.id,
      name:  s.name,
      alive: s.pty !== null,
    }));
    return send(res, 200, { sessions: list });
  }

  // POST /sessions — create a new PTY session
  if (method === 'POST' && pathname === '/sessions') {
    const body = await readBody(req);
    try {
      const result = createSession(body);
      return send(res, 201, result);
    } catch (err) {
      console.error('[agent] create session error:', err.message);
      return send(res, 500, { error: err.message });
    }
  }

  // DELETE /sessions/:id — kill a session
  const killMatch = pathname.match(/^\/sessions\/([^/]+)$/);
  if (method === 'DELETE' && killMatch) {
    const s = sessions.get(killMatch[1]);
    if (s) {
      s.pty?.kill();
      sessions.delete(killMatch[1]);
    }
    return send(res, 200, { success: true });
  }

  // POST /sessions/:id/resize
  const resizeMatch = pathname.match(/^\/sessions\/([^/]+)\/resize$/);
  if (method === 'POST' && resizeMatch) {
    const { cols, rows } = await readBody(req);
    const s = sessions.get(resizeMatch[1]);
    if (s?.pty && cols > 0 && rows > 0) {
      s.pty.resize(cols, rows);
    }
    return send(res, 200, { success: true });
  }

  send(res, 404, { error: 'Not found' });
});

// ── WebSocket server ─────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws, req) => {
  const { pathname } = url.parse(req.url || '/');
  const sessionMatch = pathname.match(/^\/sessions\/([^/]+)$/);
  if (!sessionMatch) {
    ws.close(1008, 'Invalid path');
    return;
  }

  const sessionId = sessionMatch[1];
  const entry     = sessions.get(sessionId);

  if (!entry) {
    ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
    ws.close(1011, 'Session not found');
    return;
  }

  entry.clients.add(ws);

  // Replay scrollback to the newly attached client
  if (entry.buffer) {
    ws.send(JSON.stringify({ type: 'scrollback', data: entry.buffer }));
  }
  ws.send(JSON.stringify({ type: 'attached', sessionId }));

  console.log(`[agent] client attached to session ${sessionId.slice(0, 8)}`);

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      const s   = sessions.get(sessionId);
      if (!s?.pty) return;

      if (msg.type === 'input') {
        s.pty.write(msg.data);
      } else if (msg.type === 'resize' && msg.cols > 0 && msg.rows > 0) {
        s.pty.resize(msg.cols, msg.rows);
      }
    } catch (_) {}
  });

  const cleanup = () => {
    const s = sessions.get(sessionId);
    if (s) s.clients.delete(ws);
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);
});

// ── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[terminal-agent] Listening on port ${PORT}`);
});

process.on('uncaughtException', err => {
  console.error('[terminal-agent] uncaughtException:', err.message);
});

process.on('unhandledRejection', err => {
  console.error('[terminal-agent] unhandledRejection:', err?.message || err);
});
