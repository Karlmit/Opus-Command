const express = require('express');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const session = require('express-session');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

const { PORT, SESSION_SECRET, NODE_ENV, DATA_DIR, AGENT_PATTERNS_PATH } = require('./config');
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
    console.log(`[socket] Client connected: ${socket.id}`);

    // Terminal: join a session room to receive output
    socket.on('terminal:join', ({ sessionId }) => {
      socket.join(`session:${sessionId}`);
      terminal.clientJoinSession(sessionId, socket.id);
      // Send scrollback
      const scrollback = terminal.getSessionScrollback(sessionId);
      if (scrollback) socket.emit('terminal:scrollback', { sessionId, data: scrollback });
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
  });

  // Expose io for use by other modules
  app.set('io', io);
}

main().catch(err => {
  console.error('[startup] Fatal error:', err);
  process.exit(1);
});
