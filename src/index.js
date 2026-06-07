const express = require('express');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const { PORT, SESSION_SECRET, NODE_ENV, DATA_DIR, AGENT_PATTERNS_PATH, HOST_PROJECTS_DIR, PROJECTS_DIR } = require('./config');
const { initDB, getSQLite } = require('./db');
const SQLiteSessionStore = require('./middleware/sessionStore');
const { csrfMiddleware } = require('./middleware/csrf');
const { registerRoutes } = require('./routes');

const DEFAULT_AGENT_PATTERNS = {
  version: 1,
  agents: [
    {
      name: 'Claude Code',
      activePatterns: ['╭─', '│ Claude', 'claude>', 'Claude Code'],
      waitingPatterns: ['Do you want to proceed', '❯ Yes', '❯ No', '(Y/n)', 'Allow', 'Deny', 'Approve', 'Continue?']
    },
    {
      name: 'Codex CLI',
      activePatterns: ['codex>', 'Codex', '◇', '◆'],
      waitingPatterns: ['Allow command', 'Approve', 'Deny', '(y/n)', '[y/N]']
    },
    {
      name: 'OpenCode',
      activePatterns: ['opencode', 'OpenCode'],
      waitingPatterns: ['(y/n)', '[yes/no]', 'Approve', 'Continue?']
    }
  ]
};

async function main() {
  const startTime = Date.now();

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Ensure the internal Docker network exists so workspace containers can be
  // reached by name (e.g. opus-workspace-1:7681 for the terminal-agent).
  const dockerService = require('./services/docker.service');

  // Pre-pull the fallback workspace image in the background so it's
  // ready when the user creates their first project.
  const { docker: dockerClient } = require('./services/docker.service');
  const FALLBACK = 'node:20-slim';
  dockerClient.getImage(FALLBACK).inspect()
    .catch(() => {
      console.log(`[startup] Pre-pulling fallback workspace image ${FALLBACK}…`);
      return new Promise((resolve) => {
        dockerClient.pull(FALLBACK, (err, stream) => {
          if (err || !stream) return resolve();
          dockerClient.modem.followProgress(stream, () => {
            console.log(`[startup] ${FALLBACK} ready.`);
            resolve();
          });
        });
      });
    });

  if (!fs.existsSync(AGENT_PATTERNS_PATH)) {
    fs.writeFileSync(AGENT_PATTERNS_PATH, JSON.stringify(DEFAULT_AGENT_PATTERNS, null, 2));
    console.log('[startup] Created default agent-patterns.json');
  }

  const { sqlite } = initDB();

  const app = express();
  const server = http.createServer(app);
  const io = new SocketIO(server, {
    cors: { origin: NODE_ENV === 'development' ? 'http://localhost:5173' : false }
  });

  const sessionMiddleware = session({
    store: new SQLiteSessionStore(sqlite),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      maxAge: 24 * 60 * 60 * 1000,
    },
    name: 'oc.sid',
  });

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(sessionMiddleware);

  // Share session with Socket.io
  io.use((socket, next) => {
    sessionMiddleware(socket.request, socket.request.res || {}, next);
  });

  app.use(csrfMiddleware);

  registerRoutes(app);

  // Serve React frontend
  const staticDir = path.join(__dirname, '../public');
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(staticDir, 'index.html'));
      }
    });
  } else if (NODE_ENV === 'development') {
    console.log('[dev] No public/ dir — expecting Vite dev server on :5173');
  }

  const terminal = require('./services/terminal.service');

  io.on('connection', (socket) => {
    const session = socket.request.session;
    if (!session?.userId) {
      socket.disconnect();
      return;
    }
    console.log(`[socket] client connected: ${socket.id}`);

    // terminal:join — client explicitly wants scrollback (fresh xterm, session switch, project nav).
    socket.on('terminal:join', async ({ sessionId }) => {
      socket.join(`session:${sessionId}`);
      terminal.clientJoinSession(sessionId, socket.id);

      if (!terminal.isProxyReady()) {
        console.log(`[socket] terminal:join before proxy ready — holding, session=${sessionId.slice(0,8)}`);
        socket.emit('terminal:proxy-restoring', { sessionId });
        await terminal.waitForProxyReady();
        if (!socket.connected) return;
      }

      const alive = terminal.isSessionAlive(sessionId);
      console.log(`[socket] join session=${sessionId.slice(0,8)} socket=${socket.id.slice(0,8)} pty_alive=${alive}`);

      const scrollback = terminal.getSessionScrollback(sessionId);
      if (scrollback) {
        console.log(`[socket] replaying ${scrollback.length} bytes for session ${sessionId.slice(0,8)}`);
        socket.emit('terminal:scrollback', { sessionId, data: scrollback });
      }

      if (!alive) {
        console.log(`[socket] emitting terminal:session-dead for ${sessionId.slice(0,8)}`);
        socket.emit('terminal:session-dead', { sessionId });
      } else {
        socket.emit('terminal:session-attached', { sessionId });
      }
    });

    // terminal:reattach — socket reconnect within same browser session.
    // Joins the room for live output but sends NO scrollback (xterm already has it).
    socket.on('terminal:reattach', async ({ sessionId }) => {
      socket.join(`session:${sessionId}`);
      terminal.clientJoinSession(sessionId, socket.id);

      if (!terminal.isProxyReady()) {
        console.log(`[socket] terminal:reattach before proxy ready — holding, session=${sessionId.slice(0,8)}`);
        socket.emit('terminal:proxy-restoring', { sessionId });
        await terminal.waitForProxyReady();
        if (!socket.connected) return;
      }

      const alive = terminal.isSessionAlive(sessionId);
      console.log(`[socket] reattach session=${sessionId.slice(0,8)} socket=${socket.id.slice(0,8)} pty_alive=${alive}`);

      if (!alive) {
        console.log(`[socket] emitting terminal:session-dead for ${sessionId.slice(0,8)}`);
        socket.emit('terminal:session-dead', { sessionId });
      } else {
        socket.emit('terminal:session-attached', { sessionId });
      }
    });

    // Terminal: leave session room
    socket.on('terminal:leave', ({ sessionId }) => {
      socket.leave(`session:${sessionId}`);
      terminal.clientLeaveSession(sessionId, socket.id);
    });

    // Terminal: write input to PTY
    socket.on('terminal:input', ({ sessionId, data }) => {
      terminal.writeToSession(sessionId, data);
    });

    // Terminal: resize PTY
    socket.on('terminal:resize', ({ sessionId, cols, rows }) => {
      terminal.resizeSession(sessionId, cols, rows);
    });

    socket.on('disconnect', () => {
      console.log(`[socket] Client disconnected: ${socket.id}`);
    });
  });

  server.listen(PORT, () => {
    const elapsed = Date.now() - startTime;
    console.log(`[startup] Opus Command v${require('../package.json').version} ready on port ${PORT} (${elapsed}ms)`);
    if (HOST_PROJECTS_DIR !== PROJECTS_DIR) {
      console.log(`[startup] Workspace bind mounts use host path: ${HOST_PROJECTS_DIR}`);
    } else {
      console.log(`[startup] WARNING: HOST_PROJECTS_DIR not set — workspace bind mounts use ${PROJECTS_DIR}`);
      console.log(`[startup] If running in Docker, set HOST_PROJECTS_DIR to the host-side projects path.`);
    }

    // Ensure the internal Docker network exists, then reconnect to surviving
    // terminal-agent sessions. Both must complete before join/reattach handlers
    // will respond with final status — browser sockets that arrive early receive
    // terminal:proxy-restoring and wait via waitForProxyReady().
    (async () => {
      console.log('[startup] ensureInternalNetwork: start');
      try {
        await dockerService.ensureInternalNetwork();
        console.log('[startup] ensureInternalNetwork: done');
      } catch (err) {
        console.warn('[startup] ensureInternalNetwork warning:', err.message);
      }
      await terminal.reconnectOnStartup(io);
    })().catch(err => {
      console.error('[startup] Startup sequence error:', err.message);
      // reconnectOnStartup calls _markProxyReady() in its finally block,
      // so this catch only fires if ensureInternalNetwork itself throws in a
      // way that prevents reconnectOnStartup from running at all.
    });
  });

  // Expose io for use by other modules
  app.set('io', io);
}

main().catch(err => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
