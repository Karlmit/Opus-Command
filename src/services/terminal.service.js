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
const AI_IDLE_TIMEOUT_MS = 3500;

// Map<sessionId, ProxyEntry>
const activeProxies = new Map();
// Map<sessionId, Set<socketId>>
const sessionClients = new Map();

let _io = null; // set on first createSession / reconnectOnStartup call

// ── Startup readiness gate ────────────────────────────────────────────────────
// False until reconnectOnStartup() completes. join/reattach handlers in index.js
// must await waitForProxyReady() before emitting session-dead or session-attached.

let terminalProxyReady = false;
const _proxyReadyResolvers = [];
const _pendingInputQueue = []; // { type, sessionId, data?, cols?, rows? }

function _markProxyReady() {
  if (terminalProxyReady) return;
  terminalProxyReady = true;
  console.log('[terminal] proxy ready — flushing queued input/resize');
  for (const item of _pendingInputQueue) {
    if (item.type === 'input') _doWrite(item.sessionId, item.data);
    else if (item.type === 'resize') _doResize(item.sessionId, item.cols, item.rows);
  }
  _pendingInputQueue.length = 0;
  const resolvers = _proxyReadyResolvers.splice(0);
  for (const resolve of resolvers) resolve();
}

function isProxyReady() {
  return terminalProxyReady;
}

function waitForProxyReady() {
  if (terminalProxyReady) return Promise.resolve();
  return new Promise(resolve => _proxyReadyResolvers.push(resolve));
}

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

  // Ask the workspace terminal-agent to create the PTY session.
  // On a freshly created/started workspace the agent (port 7681) may still be
  // booting, so retry briefly instead of failing the very first terminal —
  // that error previously forced users to refresh the page.
  let response;
  const deadline = Date.now() + 20_000;
  for (let attempt = 1; ; attempt++) {
    try {
      response = await fetch(`${agentHttp(projectId)}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, name, cols: 80, rows: 24 }),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
      break;
    } catch (err) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Cannot reach workspace terminal-agent after several attempts. ` +
          `Make sure the workspace container is running and rebuilt with the latest image. ` +
          `(${err.message})`
        );
      }
      console.log(`[terminal] agent not ready (attempt ${attempt}) for project ${projectId} — retrying: ${err.message}`);
      await _sleep(1500);
    }
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
    aiAgent: null,
    inputBuffer: '',
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
      _setAIState(sessionId, 'none', ioRef, { force: true });
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
  console.log('[terminal] reconnectOnStartup: start');

  const db = getDB();
  let dbSessions;
  try {
    dbSessions = db.select().from(terminalSessions).all();
  } catch {
    dbSessions = [];
  }

  console.log(`[terminal] startup: ${dbSessions.length} session(s) in DB — probing agents`);

  try {
    // Run all reconnect probes in parallel so the startup window is as short as possible
    await Promise.allSettled(dbSessions.map(s => _tryReconnect(s, io)));
    console.log('[terminal] reconnectOnStartup: done');
  } finally {
    _markProxyReady();
  }
}

async function _tryReconnect(session, io) {
  const projId = session.projectId;
  const deadline = Date.now() + 25_000;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    console.log(`[terminal] probe attempt ${attempt} for session ${session.id.slice(0, 8)} → ${agentHttp(projId)} (${remaining}s left)`);

    try {
      const res = await fetch(`${agentHttp(projId)}/sessions`, {
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) {
        console.log(`[terminal] probe ${session.id.slice(0, 8)}: HTTP ${res.status} — retrying`);
        await _sleep(2000);
        continue;
      }

      const { sessions: agentSessions } = await res.json();
      const agentSession = agentSessions.find(s => s.id === session.id && s.alive);

      if (agentSession) {
        console.log(`[terminal] probe ${session.id.slice(0, 8)}: alive — connecting proxy`);
        _connectProxy(projId, session.id, io);
      } else {
        console.log(`[terminal] probe ${session.id.slice(0, 8)}: not found alive in agent — session dead`);
      }
      return; // definitive answer — stop retrying
    } catch (err) {
      const rem = Math.ceil((deadline - Date.now()) / 1000);
      console.log(`[terminal] probe ${session.id.slice(0, 8)}: ${err.message} — retrying (${rem}s left)`);
      await _sleep(2000);
    }
  }

  console.log(`[terminal] probe ${session.id.slice(0, 8)}: giving up after 25s`);
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── I/O operations ───────────────────────────────────────────────────────────

function _doWrite(sessionId, data) {
  const proxy = activeProxies.get(sessionId);
  if (proxy?.ws?.readyState === WebSocket.OPEN) {
    _detectAICommandInput(sessionId, data, _io);
    proxy.ws.send(JSON.stringify({ type: 'input', data }));
  } else {
    console.warn(`[terminal] INPUT DROPPED — no active proxy for session ${sessionId.slice(0, 8)}`);
  }
}

function _doResize(sessionId, cols, rows) {
  const proxy = activeProxies.get(sessionId);
  if (proxy?.ws?.readyState === WebSocket.OPEN) {
    proxy.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  } else {
    console.warn(`[terminal] RESIZE DROPPED — no active proxy for session ${sessionId.slice(0, 8)}`);
  }
}

function writeToSession(sessionId, data) {
  if (!terminalProxyReady) {
    console.log(`[terminal] input queued (proxy not ready) for session ${sessionId.slice(0, 8)}`);
    _pendingInputQueue.push({ type: 'input', sessionId, data });
    return;
  }
  _doWrite(sessionId, data);
}

function resizeSession(sessionId, cols, rows) {
  if (!cols || !rows || cols < 1 || rows < 1) return;
  if (!terminalProxyReady) {
    console.log(`[terminal] resize queued (proxy not ready) for session ${sessionId.slice(0, 8)}`);
    _pendingInputQueue.push({ type: 'resize', sessionId, cols, rows });
    return;
  }
  _doResize(sessionId, cols, rows);
}

function isSessionAlive(sessionId) {
  const proxy = activeProxies.get(sessionId);
  return proxy?.alive === true && proxy?.ws?.readyState === WebSocket.OPEN;
}

function killSession(sessionId) {
  const proxy = activeProxies.get(sessionId);
  const projectId = proxy?.projectId || _getSessionProjectId(sessionId);
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
  if (projectId) _emitProjectAISummary(projectId, _io);
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
    aiAgent:  activeProxies.get(s.id)?.aiAgent || null,
    projectId: s.projectId,
  }));
}

function getProjectAISummary(projectId) {
  const db = getDB();
  const rows = db.select().from(terminalSessions)
    .where(eq(terminalSessions.projectId, projectId)).all();

  let aiActive = 0;
  let aiWaiting = 0;

  for (const row of rows) {
    const state = activeProxies.get(row.id)?.aiState || row.aiState || 'none';
    if (state === 'active') aiActive++;
    else if (state === 'waiting') aiWaiting++;
  }

  return {
    projectId,
    terminalCount: rows.length,
    aiActive,
    aiWaiting,
    aiBusy: aiActive + aiWaiting,
  };
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
const _idleTimers = {};

function _stripAnsi(data) {
  return String(data || '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '');
}

function _findPatternAgent(patterns, type, text) {
  for (const agent of patterns.agents || []) {
    const list = agent[type] || [];
    if (list.some(p => text.includes(p))) return agent;
  }
  return null;
}

function _agentFromCommand(command) {
  if (/^\s*(?:npx\s+)?claude(?:\s|$)/i.test(command)) return 'Claude Code';
  if (/^\s*(?:npx\s+)?codex(?:\s|$)/i.test(command)) return 'Codex CLI';
  return null;
}

function _detectAICommandInput(sessionId, data, io) {
  const proxy = activeProxies.get(sessionId);
  if (!proxy) return;

  const chunk = String(data || '');
  if (proxy.aiState === 'waiting' && chunk.includes('\r')) {
    _setAIState(sessionId, 'active', io, { agentName: proxy.aiAgent });
  }

  for (const char of chunk) {
    if (char === '\r' || char === '\n') {
      const agentName = _agentFromCommand(proxy.inputBuffer);
      proxy.inputBuffer = '';
      if (agentName) _setAIState(sessionId, 'active', io, { agentName });
    } else if (char === '\u007f' || char === '\b') {
      proxy.inputBuffer = proxy.inputBuffer.slice(0, -1);
    } else if (char >= ' ') {
      proxy.inputBuffer += char;
      if (proxy.inputBuffer.length > 300) proxy.inputBuffer = proxy.inputBuffer.slice(-300);
    }
  }
}

function _detectAIState(sessionId, data, io) {
  const proxy = activeProxies.get(sessionId);
  if (!proxy) return;

  const { loadPatterns } = require('./patterns.service');
  const patterns = loadPatterns();
  const text = _stripAnsi(data);
  const wasWaiting = proxy.aiState === 'waiting';
  const activeAgent = _findPatternAgent(patterns, 'activePatterns', text);
  const waitingAgent = _findPatternAgent(patterns, 'waitingPatterns', text);

  if (activeAgent && proxy.aiState !== 'waiting') {
    _setAIState(sessionId, 'active', io, { agentName: activeAgent.name });
  } else if (proxy.aiState === 'active' && text.trim()) {
    _setAIState(sessionId, 'active', io, { agentName: proxy.aiAgent });
  }

  if (waitingAgent) {
    if (_waitingTimers[sessionId]) clearTimeout(_waitingTimers[sessionId]);
    _waitingTimers[sessionId] = setTimeout(() => {
      const px = activeProxies.get(sessionId);
      if (!px) return;
      if (Date.now() - px.lastOutputTime >= 900) {
        _setAIState(sessionId, 'waiting', io || _io, { agentName: waitingAgent.name });
      }
    }, 1000);
  } else if (wasWaiting && text.trim()) {
    _setAIState(sessionId, 'active', io, { agentName: proxy.aiAgent });
    if (_waitingTimers[sessionId]) {
      clearTimeout(_waitingTimers[sessionId]);
      delete _waitingTimers[sessionId];
    }
  }
}

function _setAIState(sessionId, state, io, options = {}) {
  const proxy = activeProxies.get(sessionId);
  const previousState = proxy?.aiState;
  const previousAgent = proxy?.aiAgent || null;
  const agentName = options.agentName || previousAgent;

  if (proxy) {
    proxy.aiState = state;
    proxy.aiAgent = state === 'none' ? null : agentName;
  }

  if (_idleTimers[sessionId]) {
    clearTimeout(_idleTimers[sessionId]);
    delete _idleTimers[sessionId];
  }
  if (state !== 'waiting' && _waitingTimers[sessionId]) {
    clearTimeout(_waitingTimers[sessionId]);
    delete _waitingTimers[sessionId];
  }
  if (state === 'active') {
    _idleTimers[sessionId] = setTimeout(() => {
      const px = activeProxies.get(sessionId);
      if (!px || px.aiState !== 'active') return;
      _setAIState(sessionId, 'none', io || _io);
    }, AI_IDLE_TIMEOUT_MS);
  }

  if (!options.force && previousState === state && previousAgent === (proxy?.aiAgent || null)) return;

  try {
    getDB().update(terminalSessions).set({ aiState: state })
      .where(eq(terminalSessions.id, sessionId)).run();
    const projectId = proxy?.projectId || _getSessionProjectId(sessionId);
    (io || _io)?.emit('terminal:ai-state', {
      sessionId,
      projectId,
      state,
      agent: state === 'none' ? null : agentName,
    });
    if (projectId) _emitProjectAISummary(projectId, io || _io);
  } catch (_) {}
}

function _getSessionProjectId(sessionId) {
  try {
    const rows = getDB().select().from(terminalSessions)
      .where(eq(terminalSessions.id, sessionId)).all();
    return rows[0]?.projectId || null;
  } catch {
    return null;
  }
}

function _emitProjectAISummary(projectId, io) {
  try {
    (io || _io)?.emit('project:ai-state', getProjectAISummary(projectId));
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
  getProjectAISummary,
  clientJoinSession,
  clientLeaveSession,
  isSessionAlive,
  reconnectOnStartup,
  isProxyReady,
  waitForProxyReady,
};
