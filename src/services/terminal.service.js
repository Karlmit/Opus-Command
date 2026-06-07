const pty = require('node-pty');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { terminalSessions } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { docker } = require('./docker.service');

const MAX_SCROLLBACK_LINES = 5000;

// In-memory registry of active PTY processes
// Map<sessionId, { pty: IPty, projectId: number, buffer: string[] }>
const activePTYs = new Map();

// Map<sessionId, Set<socketId>> for client tracking
const sessionClients = new Map();

function getDB_local() {
  return getDB();
}

function truncateScrollback(lines) {
  if (lines.length > MAX_SCROLLBACK_LINES) {
    return lines.slice(lines.length - MAX_SCROLLBACK_LINES);
  }
  return lines;
}

async function createSession(projectId, io) {
  const db = getDB_local();
  const sessionId = uuidv4();
  const sessionCount = db.select().from(terminalSessions)
    .where(eq(terminalSessions.projectId, projectId))
    .all().length;
  const name = `Terminal ${sessionCount + 1}`;

  // Get the container name for this project
  const { containerName } = require('./docker.service');
  const contName = containerName(projectId);

  let ptyProcess;
  try {
    // Use -it so Docker allocates a real PTY inside the container.
    // Without -t, bash sees no TTY, warns about job control, and behaves oddly.
    // node-pty wraps docker exec in a host PTY (master side); docker exec -t
    // creates a PTY inside the container (slave side) — the chain works correctly.
    ptyProcess = pty.spawn('docker', ['exec', '-it', '-e', 'TERM=xterm-256color', contName, '/bin/bash'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
    });
  } catch (err) {
    // Fallback: create a local shell if docker exec fails (development)
    console.warn(`[terminal] docker exec failed for ${contName}, using local shell:`, err.message);
    ptyProcess = pty.spawn('/bin/bash', [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        PS1: '\\w$ ',
      },
    });
  }

  const sessionData = {
    pty: ptyProcess,
    projectId,
    buffer: [],
    name,
    aiState: 'none',
    lastOutputTime: Date.now(),
  };
  activePTYs.set(sessionId, sessionData);

  // Save to DB
  db.insert(terminalSessions).values({
    id: sessionId,
    projectId,
    name,
    scrollback: '',
    aiState: 'none',
    createdAt: Date.now(),
  }).run();

  // Stream output to connected clients
  ptyProcess.onData(data => {
    const session = activePTYs.get(sessionId);
    if (!session) return;

    session.lastOutputTime = Date.now();

    // Append to scrollback buffer
    session.buffer.push(data);
    // Keep buffer manageable (we store raw terminal sequences, not lines)
    if (session.buffer.join('').length > 500000) {
      // Trim old data
      const full = session.buffer.join('');
      session.buffer = [full.slice(full.length - 250000)];
    }

    // Persist scrollback periodically
    persistScrollback(sessionId, session);

    // Broadcast to all connected clients watching this session
    const clients = sessionClients.get(sessionId);
    if (clients && clients.size > 0) {
      io.to(`session:${sessionId}`).emit('terminal:data', { sessionId, data });
    }

    // AI detection
    detectAIState(sessionId, data, io);
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[terminal] Session ${sessionId} exited with code ${exitCode}`);
    // Clean up but keep DB record for reconnect
    const session = activePTYs.get(sessionId);
    if (session) {
      persistScrollback(sessionId, session, true);
    }
    activePTYs.delete(sessionId);
    sessionClients.delete(sessionId);
    io.to(`session:${sessionId}`).emit('terminal:exit', { sessionId });
  });

  return { sessionId, name };
}

let persistTimer = {};
function persistScrollback(sessionId, session, immediate = false) {
  if (persistTimer[sessionId]) clearTimeout(persistTimer[sessionId]);
  const delay = immediate ? 0 : 2000;
  persistTimer[sessionId] = setTimeout(() => {
    try {
      const db = getDB_local();
      const scrollback = session.buffer.join('');
      db.update(terminalSessions)
        .set({ scrollback: scrollback.slice(-250000) })
        .where(eq(terminalSessions.id, sessionId))
        .run();
    } catch (e) {
      console.error('[terminal] Scrollback persist error:', e.message);
    }
  }, delay);
}

// Pattern detection for AI agents
let waitingTimers = {};
function detectAIState(sessionId, data, io) {
  const session = activePTYs.get(sessionId);
  if (!session) return;

  const { loadPatterns } = require('./patterns.service');
  const patterns = loadPatterns();

  const allActive = patterns.agents.flatMap(a => a.activePatterns || []);
  const allWaiting = patterns.agents.flatMap(a => a.waitingPatterns || []);

  let wasWaiting = session.aiState === 'waiting';

  // Check for active AI patterns
  if (allActive.some(p => data.includes(p))) {
    if (session.aiState !== 'waiting') {
      session.aiState = 'active';
      updateAIState(sessionId, 'active', io);
    }
  }

  // Check for waiting patterns — require 1s silence after
  if (allWaiting.some(p => data.includes(p))) {
    if (waitingTimers[sessionId]) clearTimeout(waitingTimers[sessionId]);
    waitingTimers[sessionId] = setTimeout(() => {
      const s = activePTYs.get(sessionId);
      if (!s) return;
      const silence = Date.now() - s.lastOutputTime;
      if (silence >= 900) {
        s.aiState = 'waiting';
        updateAIState(sessionId, 'waiting', io);
      }
    }, 1000);
  } else if (wasWaiting && data.trim()) {
    // New output after waiting = agent resumed
    session.aiState = 'active';
    updateAIState(sessionId, 'active', io);
    if (waitingTimers[sessionId]) {
      clearTimeout(waitingTimers[sessionId]);
      delete waitingTimers[sessionId];
    }
  }
}

function updateAIState(sessionId, state, io) {
  try {
    const db = getDB_local();
    db.update(terminalSessions).set({ aiState: state }).where(eq(terminalSessions.id, sessionId)).run();
    io.emit('terminal:ai-state', { sessionId, state });
  } catch (_) {}
}

function writeToSession(sessionId, data) {
  const session = activePTYs.get(sessionId);
  if (session && session.pty) {
    session.pty.write(data);
  }
}

function resizeSession(sessionId, cols, rows) {
  const session = activePTYs.get(sessionId);
  if (session && session.pty) {
    session.pty.resize(cols, rows);
  }
}

function killSession(sessionId) {
  const session = activePTYs.get(sessionId);
  if (session && session.pty) {
    session.pty.kill();
  }
  activePTYs.delete(sessionId);
  sessionClients.delete(sessionId);
  try {
    const db = getDB_local();
    db.delete(terminalSessions).where(eq(terminalSessions.id, sessionId)).run();
  } catch (_) {}
}

function getSessionScrollback(sessionId) {
  const session = activePTYs.get(sessionId);
  if (session) return session.buffer.join('');

  // Load from DB
  try {
    const db = getDB_local();
    const rows = db.select().from(terminalSessions).where(eq(terminalSessions.id, sessionId)).all();
    return rows[0]?.scrollback || '';
  } catch {
    return '';
  }
}

function renameSession(sessionId, name) {
  const session = activePTYs.get(sessionId);
  if (session) session.name = name;
  try {
    const db = getDB_local();
    db.update(terminalSessions).set({ name }).where(eq(terminalSessions.id, sessionId)).run();
  } catch (_) {}
}

function listSessions(projectId) {
  const db = getDB_local();
  const dbSessions = db.select().from(terminalSessions)
    .where(eq(terminalSessions.projectId, projectId))
    .all();

  return dbSessions.map(s => ({
    id: s.id,
    name: activePTYs.get(s.id)?.name || s.name,
    active: activePTYs.has(s.id),
    aiState: activePTYs.get(s.id)?.aiState || s.aiState || 'none',
    projectId: s.projectId,
  }));
}

function clientJoinSession(sessionId, socketId) {
  if (!sessionClients.has(sessionId)) {
    sessionClients.set(sessionId, new Set());
  }
  sessionClients.get(sessionId).add(socketId);
}

function clientLeaveSession(sessionId, socketId) {
  const clients = sessionClients.get(sessionId);
  if (clients) {
    clients.delete(socketId);
    if (clients.size === 0) sessionClients.delete(sessionId);
  }
}

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
};
