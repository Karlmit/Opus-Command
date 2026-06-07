/**
 * terminal.service.js — Opus Command proxy layer.
 *
 * Each workspace container runs a terminal-agent process (port 7681) that owns
 * all PTY sessions for that workspace. This service:
 *   - Creates sessions on the terminal-agent via HTTP
 *   - Maintains a WebSocket connection per session to stream output
 *   - Proxies I/O between Socket.io browser clients and the terminal-agent
 *   - Persists session metadata and scrollback to SQLite
 *   - On startup, reconnects to any sessions that survived in a running agent
 *
 * Because PTYs live inside the workspace container, they survive Opus Command
 * restarts. If the workspace container itself restarts, sessions die (expected).
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { terminalSessions } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { containerName } = require('./docker.service');

const AGENT_PORT   = parseInt(process.env.TERMINAL_AGENT_PORT || '7681', 10);
const MAX_BUFFER   = 500_000; // bytes
const CONNECT_TIMEOUT_MS = 5_000;

// Map<sessionId, ProxyEntry>
const activeProxies = new Map();
// Map<sessionId, Set<socketId>>
const sessionClients = new Map();

let _io = null; // set on first createSession / reconnectOnStartup call

// ── URL helpers ──────────────────────────────────────────────────────────────

function agentHttp(projectId) {
  return `http://${containerName(projectId)}:${AGENT_PORT}`;
}

function agentWs(projectId, sessionId) {
  return `ws://${containerName(projectId)}:${AGENT_PORT}/sessions/${sessionId}`;
}

// ── Session lifecycle ────────────────────────────────────────────────────────

async function createSession(projectId, io) {
  if (!_io) _io = io;

  const db = getDB();
  const sessionId = uuidv4();
  const sessionCount = db.select().from(terminalSessions)
    .where(eq(terminalSessions.projectId, projectId))
    .all().length;
  const name = `Terminal ${sessionCount + 1}`;

  // Ask the workspace terminal-agent to create the PTY session
  let response;
  try {
    response = await fetch(`${agentHttp(projectId)}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, name, cols: 80, rows: 24 }),
      signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(
      `Cannot reach workspace terminal-agent. ` +
      `Make sure the workspace container is running and rebuilt with the latest image. ` +
      `(${err.message})`
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`terminal-agent responded ${response.status}: ${text}`);
  }

  // Persist session record
  db.insert(terminalSessions).values({
    id: sessionId,
    projectId,
    name,
    scrollback: '',
    aiState: 'none',
    createdAt: Date.now(),
  }).run();

  // Open proxy WebSocket
  _connectProxy(projectId, sessionId, io);

  return { sessionId, name };
}

// ── Proxy WebSocket management ───────────────────────────────────────────────

function _connectProxy(projectId, sessionId, io) {
  if (!_io && io) _io = io;

  const wsUrl = agentWs(projectId, sessionId);
  let ws;
  try {
    ws = new WebSocket(wsUrl);
  } catch (err) {
    console.error(`[terminal] Failed to open WS for ${sessionId.slice(0, 8)}:`, err.message);
    return;
  }

  const entry = {
    ws,
    projectId,
    buffer: '',
    name: '',
    aiState: 'none',
    alive: false,
    lastOutputTime: Date.now(),
  };
  activeProxies.set(sessionId, entry);

  ws.on('open', () => {
    console.log(`[terminal] proxy WS open for session ${sessionId.slice(0, 8)}`);
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const ioRef = _io;

    if (msg.type === 'scrollback') {
      // Full buffer replay from agent — update our copy and persist
      entry.buffer = msg.data || '';
      _persistScrollback(sessionId, entry);

    } else if (msg.type === 'attached') {
      entry.alive = true;
      ioRef?.to(`session:${sessionId}`).emit('terminal:session-attached', { sessionId });

    } else if (msg.type === 'output') {
      const { data } = msg;
      entry.lastOutputTime = Date.now();

      entry.buffer += data;
      if (entry.buffer.length > MAX_BUFFER) {
        entry.buffer = entry.buffer.slice(entry.buffer.length - MAX_BUFFER / 2);
      }
      _persistScrollback(sessionId, entry);

      ioRef?.to(`session:${sessionId}`).emit('terminal:data', { sessionId, data });

      _detectAIState(sessionId, data, ioRef);

    } else if (msg.type === 'exit') {
      console.log(`[terminal] session ${sessionId.slice(0, 8)} exited`);
      entry.alive = false;
      _persistScrollback(sessionId, entry, true);
      activeProxies.delete(sessionId);
      sessionClients.delete(sessionId);
      ioRef?.to(`session:${sessionId}`).emit('terminal:exit', { sessionId });

    } else if (msg.type === 'error') {
      console.warn(`[terminal] agent error for ${sessionId.slice(0, 8)}:`, msg.message);
    }
  });

  ws.on('close', (code, reason) => {
    const proxy = activeProxies.get(sessionId);
    if (!proxy) return;
    const wasAlive = proxy.alive;
    proxy.alive = false;
    console.log(`[terminal] proxy WS closed for ${sessionId.slice(0, 8)} (code ${code})`);

    // Only emit session-dead when we were confirmed alive — this avoids false
    // alarms during the Opus Command startup reconnect window.
    if (wasAlive) {
      _io?.to(`session:${sessionId}`).emit('terminal:session-dead', { sessionId });
    }
  });

  ws.on('error', err => {
    const proxy = activeProxies.get(sessionId);
    if (proxy) proxy.alive = false;
    console.error(`[terminal] proxy WS error for ${sessionId.slice(0, 8)}:`, err.message);
  });
}

// ── Reconnect on Opus Command restart ────────────────────────────────────────

async function reconnectOnStartup(io) {
  _io = io;

  const db = getDB();
  let dbSessions;
  try {
    dbSessions = db.select().from(terminalSessions).all();
  } catch {
    dbSessions = [];
  }

  console.log(`[terminal] startup: ${dbSessions.length} session(s) in DB — probing agents`);

  // Run all reconnect probes in parallel so the startup window is as short as possible
  await Promise.allSettled(dbSessions.map(s => _tryReconnect(s, io)));
}

async function _tryReconnect(session, io) {
  const projId = session.projectId;
  try {
    const res = await fetch(`${agentHttp(projId)}/sessions`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return;

    const { sessions: agentSessions } = await res.json();
    const agentSession = agentSessions.find(s => s.id === session.id && s.alive);

    if (agentSession) {
      console.log(`[terminal] reconnecting to surviving session ${session.id.slice(0, 8)}`);
      _connectProxy(projId, session.id, io);
    } else {
      console.log(`[terminal] session ${session.id.slice(0, 8)} not found in agent — dead`);
    }
  } catch {
    // workspace container not running — session is dead, leave DB record for dead overlay
  }
}

// ── I/O operations ───────────────────────────────────────────────────────────

function writeToSession(sessionId, data) {
  const proxy = activeProxies.get(sessionId);
  if (proxy?.ws?.readyState === WebSocket.OPEN) {
    proxy.ws.send(JSON.stringify({ type: 'input', data }));
  }
}

function resizeSession(sessionId, cols, rows) {
  if (!cols || !rows || cols < 1 || rows < 1) return;
  const proxy = activeProxies.get(sessionId);
  if (proxy?.ws?.readyState === WebSocket.OPEN) {
    proxy.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}

function isSessionAlive(sessionId) {
  const proxy = activeProxies.get(sessionId);
  return proxy?.alive === true && proxy?.ws?.readyState === WebSocket.OPEN;
}

function killSession(sessionId) {
  const proxy = activeProxies.get(sessionId);
  if (proxy) {
    fetch(`${agentHttp(proxy.projectId)}/sessions/${sessionId}`, {
      method: 'DELETE',
    }).catch(() => {});
    proxy.ws?.close();
    activeProxies.delete(sessionId);
  }
  sessionClients.delete(sessionId);
  try {
    getDB().delete(terminalSessions).where(eq(terminalSessions.id, sessionId)).run();
  } catch (_) {}
}

function getSessionScrollback(sessionId) {
  const proxy = activeProxies.get(sessionId);
  if (proxy) return proxy.buffer;
  try {
    const rows = getDB().select().from(terminalSessions)
      .where(eq(terminalSessions.id, sessionId)).all();
    return rows[0]?.scrollback || '';
  } catch {
    return '';
  }
}

function renameSession(sessionId, name) {
  const proxy = activeProxies.get(sessionId);
  if (proxy) proxy.name = name;
  try {
    getDB().update(terminalSessions).set({ name })
      .where(eq(terminalSessions.id, sessionId)).run();
  } catch (_) {}
}

function listSessions(projectId) {
  const db = getDB();
  const rows = db.select().from(terminalSessions)
    .where(eq(terminalSessions.projectId, projectId)).all();

  return rows.map(s => ({
    id:       s.id,
    name:     activeProxies.get(s.id)?.name || s.name,
    active:   isSessionAlive(s.id),
    aiState:  activeProxies.get(s.id)?.aiState || s.aiState || 'none',
    projectId: s.projectId,
  }));
}

function clientJoinSession(sessionId, socketId) {
  if (!sessionClients.has(sessionId)) sessionClients.set(sessionId, new Set());
  sessionClients.get(sessionId).add(socketId);
}

function clientLeaveSession(sessionId, socketId) {
  const clients = sessionClients.get(sessionId);
  if (clients) {
    clients.delete(socketId);
    if (clients.size === 0) sessionClients.delete(sessionId);
  }
}

// ── Scrollback persistence ───────────────────────────────────────────────────

const _persistTimers = {};

function _persistScrollback(sessionId, proxy, immediate = false) {
  if (_persistTimers[sessionId]) clearTimeout(_persistTimers[sessionId]);
  const delay = immediate ? 0 : 2000;
  _persistTimers[sessionId] = setTimeout(() => {
    try {
      getDB().update(terminalSessions)
        .set({ scrollback: proxy.buffer.slice(-250_000) })
        .where(eq(terminalSessions.id, sessionId)).run();
    } catch (_) {}
  }, delay);
}

// ── AI state detection ───────────────────────────────────────────────────────

const _waitingTimers = {};

function _detectAIState(sessionId, data, io) {
  const proxy = activeProxies.get(sessionId);
  if (!proxy) return;

  const { loadPatterns } = require('./patterns.service');
  const patterns  = loadPatterns();
  const allActive  = patterns.agents.flatMap(a => a.activePatterns  || []);
  const allWaiting = patterns.agents.flatMap(a => a.waitingPatterns || []);
  const wasWaiting = proxy.aiState === 'waiting';

  if (allActive.some(p => data.includes(p))) {
    if (proxy.aiState !== 'waiting') {
      proxy.aiState = 'active';
      _updateAIState(sessionId, 'active', io);
    }
  }

  if (allWaiting.some(p => data.includes(p))) {
    if (_waitingTimers[sessionId]) clearTimeout(_waitingTimers[sessionId]);
    _waitingTimers[sessionId] = setTimeout(() => {
      const px = activeProxies.get(sessionId);
      if (!px) return;
      if (Date.now() - px.lastOutputTime >= 900) {
        px.aiState = 'waiting';
        _updateAIState(sessionId, 'waiting', io || _io);
      }
    }, 1000);
  } else if (wasWaiting && data.trim()) {
    proxy.aiState = 'active';
    _updateAIState(sessionId, 'active', io);
    if (_waitingTimers[sessionId]) {
      clearTimeout(_waitingTimers[sessionId]);
      delete _waitingTimers[sessionId];
    }
  }
}

function _updateAIState(sessionId, state, io) {
  try {
    getDB().update(terminalSessions).set({ aiState: state })
      .where(eq(terminalSessions.id, sessionId)).run();
    (io || _io)?.emit('terminal:ai-state', { sessionId, state });
  } catch (_) {}
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createSession,
  writeToSession,
  resizeSession,
  killSession,
  getSessionScrollback,
  renameSession,
  listSessions,
  clientJoinSession,
  clientLeaveSession,
  isSessionAlive,
  reconnectOnStartup,
};
