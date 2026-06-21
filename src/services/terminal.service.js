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
const { Terminal: HeadlessTerminal } = require('@xterm/headless');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { terminalSessions, projects } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { containerName } = require('./docker.service');
const lxc = require('./unraid-lxc.service');
const {
  AGENT_STATUS,
  AGENT_STATUS_PRIORITY,
  agentStatusLabel,
  normalizeAgentStatus,
  pickMostImportantAgentStatus,
  legacyAIStateToAgentStatus,
} = require('./agent-status.service');

// Look up a project row by id (used to pick the terminal backend).
function _getProject(projectId) {
  try {
    return getDB().select().from(projects).where(eq(projects.id, projectId)).all()[0] || null;
  } catch {
    return null;
  }
}

function _isLxcProject(project) {
  return project?.workspaceBackend === 'unraid_lxc';
}

const AGENT_PORT   = parseInt(process.env.TERMINAL_AGENT_PORT || '7681', 10);
const MAX_BUFFER   = 500_000; // bytes
const CONNECT_TIMEOUT_MS = 5_000;
const AI_IDLE_TIMEOUT_MS = 3500;
const AGENT_OUTPUT_ACTIVE_MS = 5000;

// Mobile read-only viewer rendering (headless terminal emulator → text snapshots)
const SNAPSHOT_MAX_LINES = 600;        // lines pushed to mobile (screen + recent scrollback)
const SNAPSHOT_DEBOUNCE_MS = 100;      // coalesce output bursts
const SNAPSHOT_MAX_INTERVAL_MS = 250;  // but still refresh during continuous output

// Map<sessionId, ProxyEntry>
const activeProxies = new Map();
// Map<sessionId, Set<socketId>> — desktop (raw xterm) clients
const sessionClients = new Map();
// Map<sessionId, Set<socketId>> — mobile read-only viewers (server-rendered snapshots)
const viewerClients = new Map();

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

// ── URL / host / auth helpers ──────────────────────────────────────────────────
// The agent lives inside the workspace, reached at <host>:7681. Docker resolves
// <host> via the internal bridge DNS name; LXC resolves it to the container's
// LAN IP (looked up over SSH). Because the LXC agent is LAN-reachable, every
// request carries the per-workspace bearer token — the proxy is a Node client so
// it can set the header on both REST and the WS upgrade.

function agentHttp(host) {
  return `http://${host}:${AGENT_PORT}`;
}

function agentWs(host, sessionId) {
  return `ws://${host}:${AGENT_PORT}/sessions/${sessionId}`;
}

function _agentHeaders(projectId) {
  const { getTerminalAgentToken } = require('./auth.service');
  return { Authorization: `Bearer ${getTerminalAgentToken(projectId)}` };
}

// Resolve the agent host for a project. Docker → internal bridge DNS name;
// LXC → the running container's IP (may be unavailable until it has booted, so
// callers retry). Throws if an LXC container has no IP yet.
async function _agentHostFor(projectId) {
  const project = _getProject(projectId);
  if (_isLxcProject(project)) {
    const ip = await lxc.getContainerIp(project);
    if (!ip) throw new Error('LXC container has no IP yet (is the workspace running?)');
    return ip;
  }
  return containerName(projectId);
}

// ── Session lifecycle ────────────────────────────────────────────────────────

// Create a PTY session via the in-container terminal-agent. Identical path for
// Docker and LXC — only the agent host differs (resolved per attempt so an LXC
// container that is still acquiring its IP / booting its agent is tolerated).
async function createSession(projectId, io) {
  if (!_io) _io = io;

  const db = getDB();
  const sessionId = uuidv4();
  const sessionCount = db.select().from(terminalSessions)
    .where(eq(terminalSessions.projectId, projectId))
    .all().length;
  const name = `Terminal ${sessionCount + 1}`;
  const headers = { 'Content-Type': 'application/json', ..._agentHeaders(projectId) };

  // On a freshly created/started workspace the agent (port 7681) may still be
  // booting — and an LXC container may not have an IP yet — so retry briefly
  // instead of failing the very first terminal.
  let response;
  let host;
  const deadline = Date.now() + 20_000;
  for (let attempt = 1; ; attempt++) {
    try {
      host = await _agentHostFor(projectId);
      response = await fetch(`${agentHttp(host)}/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId, name, cols: 80, rows: 24 }),
        signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS),
      });
      break;
    } catch (err) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Cannot reach workspace terminal-agent after several attempts. ` +
          `Make sure the workspace is running (and, for Docker, rebuilt with the latest image). ` +
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
  _connectProxy(projectId, sessionId, io, host);

  return { sessionId, name };
}

// ── Shared output handling ────────────────────────────────────────────────────
// Used by both the Docker agent WebSocket proxy and the LXC SSH PTY proxy so
// scrollback, mobile snapshots, and AI-state detection behave identically.
function _ingestOutput(sessionId, entry, data, ioRef) {
  entry.lastOutputTime = Date.now();
  // Raw terminal output is a noisy status signal: TUI agents (Claude Code,
  // Codex) repaint constantly — spinner, blinking caret, token counter, the box
  // border — so "bytes arrived" does not mean "the agent is working", and a
  // re-attach/resize repaint makes an idle agent look busy again. Once a session
  // is governed by lifecycle hooks we trust those events exclusively; the
  // output-based heuristics below would otherwise clobber precise statuses like
  // Done / Waiting-for-input on the very next repaint. Heuristics remain the
  // fallback for plain shells and agents without hooks installed.
  if (!entry.hookGoverned) {
    _setSessionAgentStatus(sessionId, AGENT_STATUS.WORKING, ioRef, {
      source: 'terminal_output',
      idleAfterMs: AGENT_OUTPUT_ACTIVE_MS,
    });
  }
  entry.buffer += data;
  if (entry.buffer.length > MAX_BUFFER) {
    entry.buffer = entry.buffer.slice(entry.buffer.length - MAX_BUFFER / 2);
  }
  _persistScrollback(sessionId, entry);
  ioRef?.to(`session:${sessionId}`).emit('terminal:data', { sessionId, data });
  if (entry.headless) {
    try { entry.headless.write(data); } catch (_) {}
    _scheduleSnapshot(sessionId);
  }
  if (!entry.hookGoverned) _detectAIState(sessionId, data, ioRef);
}

// ── Proxy WebSocket management ───────────────────────────────────────────────

function _connectProxy(projectId, sessionId, io, host) {
  if (!_io && io) _io = io;

  const wsUrl = agentWs(host, sessionId);
  let ws;
  try {
    ws = new WebSocket(wsUrl, { headers: _agentHeaders(projectId) });
  } catch (err) {
    console.error(`[terminal] Failed to open WS for ${sessionId.slice(0, 8)}:`, err.message);
    return;
  }

  const entry = {
    ws,
    projectId,
    agentHost: host,   // remembered so killSession can reach the right agent
    buffer: '',
    name: '',
    aiState: 'none',
    aiAgent: null,
    agentStatus: AGENT_STATUS.READY,
    agentStatusUpdatedAt: Date.now(),
    // Flipped true the first time a lifecycle hook reports for this session.
    // While true, raw PTY output no longer drives status (hooks are authoritative).
    hookGoverned: false,
    inputBuffer: '',
    alive: false,
    lastOutputTime: Date.now(),
    // Mobile viewer rendering: lazily-created headless emulator + snapshot throttle
    headless: null,
    cols: 80,
    rows: 24,
    snapTimer: null,
    lastSnapTime: 0,
  };
  activeProxies.set(sessionId, entry);
  _emitProjectAgentSummary(projectId, io);

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
      // Rebuild the headless screen from the fresh buffer if viewers are watching
      if (entry.headless) {
        _disposeHeadless(entry);
        _ensureHeadless(entry);
        _scheduleSnapshot(sessionId);
      }

    } else if (msg.type === 'attached') {
      entry.alive = true;
      _setSessionAgentStatus(sessionId, AGENT_STATUS.READY, ioRef, { source: 'session_attached' });
      ioRef?.to(`session:${sessionId}`).emit('terminal:session-attached', { sessionId });

    } else if (msg.type === 'output') {
      _ingestOutput(sessionId, entry, msg.data, ioRef);

    } else if (msg.type === 'exit') {
      console.log(`[terminal] session ${sessionId.slice(0, 8)} exited`);
      _setAIState(sessionId, 'none', ioRef, { force: true });
      _setSessionAgentStatus(sessionId, AGENT_STATUS.EXITED, ioRef, { force: true });
      entry.alive = false;
      _persistScrollback(sessionId, entry, true);
      _disposeHeadless(entry);
      activeProxies.delete(sessionId);
      sessionClients.delete(sessionId);
      viewerClients.delete(sessionId);
      ioRef?.to(`session:${sessionId}`).emit('terminal:exit', { sessionId });

    } else if (msg.type === 'error') {
      console.warn(`[terminal] agent error for ${sessionId.slice(0, 8)}:`, msg.message);
      _setSessionAgentStatus(sessionId, AGENT_STATUS.ERROR, ioRef, { message: msg.message });
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

// Probe the in-container agent for a session that existed before this restart.
// Works identically for Docker and LXC now that LXC runs the agent as a service:
// the agent (and its PTYs) survive an Opus Command restart, so a still-alive
// session reconnects. A container restart loses sessions in both backends.
async function _tryReconnect(session, io) {
  const projId = session.projectId;
  const headers = _agentHeaders(projId);

  const deadline = Date.now() + 25_000;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    let host;
    try {
      host = await _agentHostFor(projId);
    } catch (err) {
      // LXC container may be stopped / IP not ready — retry until the deadline.
      const rem = Math.ceil((deadline - Date.now()) / 1000);
      console.log(`[terminal] probe ${session.id.slice(0, 8)}: host unresolved (${err.message}) — retrying (${rem}s left)`);
      await _sleep(2000);
      continue;
    }

    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    console.log(`[terminal] probe attempt ${attempt} for session ${session.id.slice(0, 8)} → ${agentHttp(host)} (${remaining}s left)`);

    try {
      const res = await fetch(`${agentHttp(host)}/sessions`, {
        headers,
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
        _connectProxy(projId, session.id, io, host);
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
  if (!proxy) {
    console.warn(`[terminal] RESIZE DROPPED — no active proxy for session ${sessionId.slice(0, 8)}`);
    return;
  }
  // PTY size is desktop-driven; mirror it into the viewer emulator so mobile
  // renders the same layout the PTY produced.
  const applyToViewer = () => {
    proxy.cols = cols;
    proxy.rows = rows;
    if (proxy.headless) {
      try { proxy.headless.resize(cols, rows); } catch (_) {}
      _scheduleSnapshot(sessionId);
    }
  };
  if (proxy.ws?.readyState === WebSocket.OPEN) {
    applyToViewer();
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
  if (!proxy) return false;
  return proxy.alive === true && proxy.ws?.readyState === WebSocket.OPEN;
}

function killSession(sessionId) {
  const proxy = activeProxies.get(sessionId);
  const projectId = proxy?.projectId || _getSessionProjectId(sessionId);
  if (proxy) {
    _setSessionAgentStatus(sessionId, AGENT_STATUS.EXITED, _io, { force: true, source: 'session_killed' });
    if (proxy.agentStatusTimer) clearTimeout(proxy.agentStatusTimer);
    if (proxy.agentHost) {
      fetch(`${agentHttp(proxy.agentHost)}/sessions/${sessionId}`, {
        method: 'DELETE',
        headers: _agentHeaders(proxy.projectId),
      }).catch(() => {});
    }
    proxy.ws?.close();
    activeProxies.delete(sessionId);
  }
  sessionClients.delete(sessionId);
  _deleteSessionRecord(sessionId);
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
    agentStatus: _sessionAgentStatusPayload(s.id, s, activeProxies.get(s.id)),
    projectId: s.projectId,
  }));
}

function getProjectAISummary(projectId, options = {}) {
  const db = getDB();
  const rows = db.select().from(terminalSessions)
    .where(eq(terminalSessions.projectId, projectId)).all();

  let aiActive = 0;
  let aiWaiting = 0;
  let terminalCount = 0;
  const sessionStatuses = [];
  const statusCounts = {};

  for (const row of rows) {
    terminalCount++;
    const proxy = activeProxies.get(row.id);
    const state = proxy?.aiState || row.aiState || 'none';
    if (state === 'active') aiActive++;
    else if (state === 'waiting') aiWaiting++;
    const statusPayload = _sessionAgentStatusPayload(row.id, row, proxy);
    sessionStatuses.push(statusPayload);
    statusCounts[statusPayload.status] = (statusCounts[statusPayload.status] || 0) + 1;
  }

  let projectStatus = terminalCount > 0
    ? pickMostImportantAgentStatus(sessionStatuses.map(s => s.status))
    : AGENT_STATUS.READY;

  if (options.workspaceStatus === 'error') projectStatus = AGENT_STATUS.ERROR;

  return {
    projectId,
    terminalCount,
    aiActive,
    aiWaiting,
    aiBusy: aiActive + aiWaiting,
    agentStatus: {
      status: projectStatus,
      label: agentStatusLabel(projectStatus),
      priority: AGENT_STATUS_PRIORITY[projectStatus] || AGENT_STATUS_PRIORITY.unknown,
      counts: statusCounts,
      sessions: sessionStatuses,
    },
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

// ── Mobile read-only viewers (server-rendered text snapshots) ─────────────────

// True when at least one desktop (raw xterm) client is attached — used for the
// mobile status label ("Desktop active").
function desktopAttached(sessionId) {
  return (sessionClients.get(sessionId)?.size || 0) > 0;
}

function _ensureHeadless(entry) {
  if (entry.headless) return entry.headless;
  const term = new HeadlessTerminal({
    cols: entry.cols || 80,
    rows: entry.rows || 24,
    scrollback: 1000,
    allowProposedApi: true,
  });
  entry.headless = term;
  // Replay current state so a freshly-joined viewer sees the existing screen
  if (entry.buffer) {
    try { term.write(entry.buffer); } catch (_) {}
  }
  return term;
}

function _disposeHeadless(entry) {
  if (entry.snapTimer) {
    clearTimeout(entry.snapTimer);
    entry.snapTimer = null;
  }
  if (entry.headless) {
    try { entry.headless.dispose(); } catch (_) {}
    entry.headless = null;
  }
}

// Serialize the emulator's active buffer (follows the alternate screen, so a live
// TUI renders as its current screen) to plain text lines.
function _renderSnapshot(entry, maxLines = SNAPSHOT_MAX_LINES) {
  const term = entry.headless;
  if (!term) return { lines: [], cols: entry.cols, rows: entry.rows };
  const buf = term.buffer.active;
  const total = buf.length;
  const start = Math.max(0, total - maxLines);
  const lines = [];
  for (let i = start; i < total; i++) {
    const line = buf.getLine(i);
    lines.push(line ? line.translateToString(true) : '');
  }
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { lines, cols: entry.cols, rows: entry.rows };
}

function _emitSnapshot(sessionId) {
  const entry = activeProxies.get(sessionId);
  if (!entry || !entry.headless || !_io) return;
  entry.lastSnapTime = Date.now();
  const { lines, cols, rows } = _renderSnapshot(entry);
  _io.to(`session:${sessionId}:viewer`).emit('terminal:snapshot', {
    sessionId, lines, cols, rows,
    desktopAttached: desktopAttached(sessionId),
  });
}

// Throttle: coalesce output bursts (debounce) while still refreshing during
// continuous output (max-interval). A render reads the whole buffer, so dropping
// intermediate ticks never loses content.
function _scheduleSnapshot(sessionId) {
  const entry = activeProxies.get(sessionId);
  if (!entry || !entry.headless || entry.snapTimer) return;
  const since = Date.now() - (entry.lastSnapTime || 0);
  const delay = since >= SNAPSHOT_MAX_INTERVAL_MS ? 0 : SNAPSHOT_DEBOUNCE_MS;
  entry.snapTimer = setTimeout(() => {
    entry.snapTimer = null;
    _emitSnapshot(sessionId);
  }, delay);
}

function viewerJoin(sessionId, socketId) {
  if (!viewerClients.has(sessionId)) viewerClients.set(sessionId, new Set());
  viewerClients.get(sessionId).add(socketId);
  const entry = activeProxies.get(sessionId);
  if (entry) _ensureHeadless(entry);
}

function viewerLeave(sessionId, socketId) {
  const set = viewerClients.get(sessionId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) {
    viewerClients.delete(sessionId);
    const entry = activeProxies.get(sessionId);
    if (entry) _disposeHeadless(entry);
  }
}

// Initial snapshot payload for a single viewer on join (null if session not live).
function getSnapshot(sessionId) {
  const entry = activeProxies.get(sessionId);
  if (!entry) return null;
  _ensureHeadless(entry);
  const { lines, cols, rows } = _renderSnapshot(entry);
  return { sessionId, lines, cols, rows, desktopAttached: desktopAttached(sessionId) };
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

function _deleteSessionRecord(sessionId) {
  try {
    getDB().delete(terminalSessions).where(eq(terminalSessions.id, sessionId)).run();
  } catch (_) {}
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
  // Hook-governed sessions get precise UserPromptSubmit/Stop events; skip the
  // input-typing heuristic so it can't flip status on its own.
  if (proxy.hookGoverned) return;

  const chunk = String(data || '');
  if (proxy.aiState === 'waiting' && chunk.includes('\r')) {
    _setAIState(sessionId, 'active', io, { agentName: proxy.aiAgent });
    _setSessionAgentStatus(sessionId, AGENT_STATUS.WORKING, io, {
      source: 'user_input',
      idleAfterMs: AGENT_OUTPUT_ACTIVE_MS,
    });
  }

  for (const char of chunk) {
    if (char === '\r' || char === '\n') {
      const agentName = _agentFromCommand(proxy.inputBuffer);
      proxy.inputBuffer = '';
      if (agentName) {
        _setAIState(sessionId, 'active', io, { agentName });
        _setSessionAgentStatus(sessionId, AGENT_STATUS.WORKING, io, {
          source: 'user_prompt_submit',
          idleAfterMs: AGENT_OUTPUT_ACTIVE_MS,
        });
      }
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
  if (state === 'waiting') {
    _setSessionAgentStatus(sessionId, AGENT_STATUS.WAITING_FOR_INPUT, io, {
      source: 'legacy_waiting_pattern',
    });
  } else if (state === 'active') {
    _setSessionAgentStatus(sessionId, AGENT_STATUS.WORKING, io, {
      source: 'legacy_active_pattern',
      idleAfterMs: AI_IDLE_TIMEOUT_MS,
    });
  } else if (state === 'none' && proxy?.agentStatus !== AGENT_STATUS.EXITED) {
    _setSessionAgentStatus(sessionId, AGENT_STATUS.READY, io, {
      source: 'legacy_idle',
    });
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

function _deriveSessionAgentStatus(row, proxy) {
  if (!proxy && row) return AGENT_STATUS.EXITED;
  if (proxy?.alive !== true && proxy?.agentStatus !== AGENT_STATUS.EXITED && proxy?.agentStatus !== AGENT_STATUS.ERROR) {
    return AGENT_STATUS.UNKNOWN;
  }
  if (proxy?.agentStatus) return normalizeAgentStatus(proxy.agentStatus);
  const aiStatus = legacyAIStateToAgentStatus(proxy?.aiState || row.aiState || 'none');
  if (aiStatus !== AGENT_STATUS.READY) return aiStatus;
  if (proxy?.alive === true) {
    return Date.now() - (proxy.lastOutputTime || 0) <= AGENT_OUTPUT_ACTIVE_MS
      ? AGENT_STATUS.WORKING
      : AGENT_STATUS.READY;
  }
  return AGENT_STATUS.UNKNOWN;
}

function _sessionAgentStatusPayload(sessionId, row, proxy) {
  const status = _deriveSessionAgentStatus(row, proxy);
  return {
    sessionId,
    projectId: proxy?.projectId || row?.projectId || null,
    status,
    label: agentStatusLabel(status),
    priority: AGENT_STATUS_PRIORITY[status] || AGENT_STATUS_PRIORITY.unknown,
    updatedAt: proxy?.agentStatusUpdatedAt || null,
    source: proxy?.agentStatusSource || null,
  };
}

function _setSessionAgentStatus(sessionId, status, io, options = {}) {
  const proxy = activeProxies.get(sessionId);
  const normalized = normalizeAgentStatus(status);
  const previousStatus = proxy?.agentStatus;
  const previousSource = proxy?.agentStatusSource || null;
  const nextSource = options.source || previousSource;

  if (proxy) {
    if (proxy.agentStatusTimer) {
      clearTimeout(proxy.agentStatusTimer);
      proxy.agentStatusTimer = null;
    }
    proxy.agentStatus = normalized;
    proxy.agentStatusSource = nextSource;
    proxy.agentStatusUpdatedAt = Date.now();
    if (options.idleAfterMs && normalized === AGENT_STATUS.WORKING) {
      proxy.agentStatusTimer = setTimeout(() => {
        const px = activeProxies.get(sessionId);
        if (!px || px.agentStatus !== AGENT_STATUS.WORKING) return;
        _setSessionAgentStatus(sessionId, AGENT_STATUS.READY, io || _io, { source: 'output_idle' });
      }, options.idleAfterMs);
    }
  }

  if (!options.force && previousStatus === normalized && previousSource === nextSource) return;

  const rowProjectId = proxy?.projectId || _getSessionProjectId(sessionId);
  const payload = _sessionAgentStatusPayload(sessionId, rowProjectId ? { id: sessionId, projectId: rowProjectId } : null, proxy);
  (io || _io)?.emit('terminal:agent-status', payload);
  if (rowProjectId) _emitProjectAgentSummary(rowProjectId, io || _io);
}

// Future CLI hooks should call this adapter instead of adding CLI-specific
// states to the UI. Map Claude/Codex/Gemini hook events to AgentStatus here.
function applyAgentHookEvent(sessionId, eventName, io, metadata = {}) {
  const event = String(eventName || '');
  // From now on, lifecycle hooks are the source of truth for this session and
  // raw PTY output stops driving status (see _ingestOutput).
  const hookProxy = activeProxies.get(sessionId);
  if (hookProxy) hookProxy.hookGoverned = true;
  if (/^(SessionStart)$/i.test(event)) {
    return _setSessionAgentStatus(sessionId, AGENT_STATUS.READY, io, {
      source: event,
      metadata,
    });
  }
  if (/^(PreToolUse|BeforeTool)$/i.test(event)) {
    return _setSessionAgentStatus(sessionId, AGENT_STATUS.RUNNING_TOOL, io, {
      source: event,
      metadata,
    });
  }
  if (/^(PostToolUse|UserPromptSubmit|BeforeAgent|BeforeModel)$/i.test(event)) {
    return _setSessionAgentStatus(sessionId, AGENT_STATUS.WORKING, io, {
      source: event,
      metadata,
    });
  }
  if (/^(PermissionRequest)$/i.test(event) || metadata.kind === 'permission_prompt') {
    return _setSessionAgentStatus(sessionId, AGENT_STATUS.WAITING_FOR_APPROVAL, io, {
      source: event,
      metadata,
    });
  }
  if (metadata.kind === 'idle_prompt' || /^(Notification)$/i.test(event)) {
    return _setSessionAgentStatus(sessionId, AGENT_STATUS.WAITING_FOR_INPUT, io, {
      source: event,
      metadata,
    });
  }
  if (/^(Stop|AfterAgent)$/i.test(event)) {
    return _setSessionAgentStatus(sessionId, AGENT_STATUS.DONE, io, {
      source: event,
      metadata,
    });
  }
  if (/^(StopFailure)$/i.test(event)) {
    return _setSessionAgentStatus(sessionId, AGENT_STATUS.ERROR, io, {
      source: event,
      metadata,
    });
  }
  if (/^(SessionEnd)$/i.test(event)) {
    return _setSessionAgentStatus(sessionId, AGENT_STATUS.EXITED, io, {
      source: event,
      metadata,
    });
  }
  return _setSessionAgentStatus(sessionId, AGENT_STATUS.UNKNOWN, io, {
    source: event || 'hook_unknown',
    metadata,
  });
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
    const payload = getProjectAISummary(projectId);
    (io || _io)?.emit('project:ai-state', payload);
    (io || _io)?.emit('project:agent-status', {
      projectId,
      ...payload.agentStatus,
    });
  } catch (_) {}
}

function _emitProjectAgentSummary(projectId, io) {
  _emitProjectAISummary(projectId, io);
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
  applyAgentHookEvent,
  clientJoinSession,
  clientLeaveSession,
  viewerJoin,
  viewerLeave,
  getSnapshot,
  isSessionAlive,
  reconnectOnStartup,
  isProxyReady,
  waitForProxyReady,
};
