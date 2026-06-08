const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const { getSQLite } = require('../db');
const { DATA_DIR, PROJECTS_DIR } = require('../config');

const CONNECTOR_PROTOCOL_VERSION = 1;
const clients = new Map();
const pendingJobs = new Map();

function now() {
  return Date.now();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(16).toString('hex')}`;
}

function randomSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function normalizeLabels(labels) {
  if (typeof labels === 'string') {
    labels = labels.split(',');
  }
  if (!Array.isArray(labels)) return [];
  return [...new Set(labels
    .map(label => String(label || '').trim().toLowerCase())
    .filter(Boolean)
    .map(label => label.replace(/[^\w.-]/g, '-'))
  )].slice(0, 20);
}

function parseLabels(value) {
  try {
    return normalizeLabels(JSON.parse(value || '[]'));
  } catch (_) {
    return [];
  }
}

function publicConnector(row) {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    hostname: row.hostname,
    version: row.version,
    labels: parseLabels(row.labels),
    status: clients.has(row.id) ? 'online' : row.status,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

function createPairingToken({ name, createdBy, ttlMinutes = 30 }) {
  const sqlite = getSQLite();
  const token = `opus_pair_${crypto.randomBytes(24).toString('base64url')}`;
  const id = randomId('pair');
  const createdAt = now();
  sqlite.prepare(`
    INSERT INTO connector_pairing_tokens
      (id, token_hash, name, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sha256(token), name || null, createdAt + ttlMinutes * 60 * 1000, createdBy || null, createdAt);
  return { id, token, expiresAt: createdAt + ttlMinutes * 60 * 1000 };
}

function registerConnector({ pairingToken, name, platform, hostname, version, labels }) {
  const sqlite = getSQLite();
  const tokenHash = sha256(pairingToken || '');
  const pairing = sqlite.prepare(`
    SELECT * FROM connector_pairing_tokens
    WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
  `).get(tokenHash, now());

  if (!pairing) {
    const err = new Error('Invalid or expired pairing token.');
    err.status = 401;
    throw err;
  }

  const connectorId = randomId('conn');
  const secret = randomSecret();
  const createdAt = now();
  sqlite.prepare(`
    INSERT INTO connectors
      (id, name, secret_hash, platform, hostname, version, labels, status, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', NULL, ?)
  `).run(
    connectorId,
    name || pairing.name || hostname || os.hostname(),
    sha256(secret),
    platform || 'windows',
    hostname || '',
    version || '',
    JSON.stringify(normalizeLabels(labels)),
    createdAt
  );
  sqlite.prepare('UPDATE connector_pairing_tokens SET used_at = ? WHERE id = ?').run(createdAt, pairing.id);

  return {
    connectorId,
    connectorSecret: secret,
    protocolVersion: CONNECTOR_PROTOCOL_VERSION,
  };
}

function authenticateConnector(connectorId, connectorSecret) {
  if (!connectorId || !connectorSecret) return null;
  const sqlite = getSQLite();
  const row = sqlite.prepare('SELECT * FROM connectors WHERE id = ?').get(connectorId);
  if (!row || row.secret_hash !== sha256(connectorSecret)) return null;
  return row;
}

function listConnectors() {
  const sqlite = getSQLite();
  return sqlite.prepare('SELECT * FROM connectors ORDER BY created_at DESC').all().map(publicConnector);
}

function getConnector(connectorId) {
  const sqlite = getSQLite();
  const row = sqlite.prepare('SELECT * FROM connectors WHERE id = ?').get(connectorId);
  return row ? publicConnector(row) : null;
}

function updateConnector(connectorId, { name, labels }) {
  const sqlite = getSQLite();
  const row = sqlite.prepare('SELECT * FROM connectors WHERE id = ?').get(connectorId);
  if (!row) {
    const err = new Error('Connector not found.');
    err.status = 404;
    throw err;
  }

  const nextName = name !== undefined ? String(name || '').trim() : row.name;
  if (!nextName) {
    const err = new Error('Connector name is required.');
    err.status = 400;
    throw err;
  }

  const nextLabels = labels !== undefined ? normalizeLabels(labels) : parseLabels(row.labels);
  sqlite.prepare('UPDATE connectors SET name = ?, labels = ? WHERE id = ?')
    .run(nextName, JSON.stringify(nextLabels), connectorId);
  return getConnector(connectorId);
}

function createJob({ connectorId, userId, projectId, shell, command, cwd, timeoutMs = 30 * 60 * 1000 }) {
  const sqlite = getSQLite();
  const connector = sqlite.prepare('SELECT id FROM connectors WHERE id = ?').get(connectorId);
  if (!connector) {
    const err = new Error('Connector not found.');
    err.status = 404;
    throw err;
  }
  const client = clients.get(connectorId);
  if (!client || client.ws.readyState !== 1) {
    const err = new Error('Connector is offline.');
    err.status = 409;
    throw err;
  }

  const id = randomId('job');
  const createdAt = now();
  sqlite.prepare(`
    INSERT INTO connector_jobs
      (id, connector_id, project_id, user_id, shell, command, cwd, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
  `).run(id, connectorId, projectId || null, userId || null, shell || 'powershell', command, cwd || null, createdAt);

  const job = { id, shell: shell || 'powershell', command, cwd: cwd || null, timeoutMs };
  const completion = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingJobs.delete(id);
      sqlite.prepare(`
        UPDATE connector_jobs
        SET status = 'timeout', ended_at = ?
        WHERE id = ?
      `).run(now(), id);
      reject(new Error('Connector job timed out.'));
    }, timeoutMs);
    pendingJobs.set(id, { resolve, reject, timeout });
  });

  client.ws.send(JSON.stringify({ type: 'job:start', job }));
  return { job, completion };
}

function safeArtifactName(name) {
  return path.basename(String(name || 'artifact.bin')).replace(/[^\w.-]/g, '_') || 'artifact.bin';
}

function artifactBaseForJob(row) {
  if (row.project_id) {
    const project = getSQLite().prepare('SELECT folder_path FROM projects WHERE id = ?').get(row.project_id);
    if (project) {
      return path.join(PROJECTS_DIR, project.folder_path, '.opus', 'artifacts', row.id);
    }
  }
  return path.join(DATA_DIR, 'connector-artifacts', row.id);
}

function storeArtifact(message, connectorId) {
  const sqlite = getSQLite();
  const row = sqlite.prepare('SELECT * FROM connector_jobs WHERE id = ?').get(message.jobId);
  if (!row) return;

  const name = safeArtifactName(message.name);
  const baseDir = artifactBaseForJob(row);
  fs.mkdirSync(baseDir, { recursive: true });

  const artifactId = randomId('artifact');
  const targetPath = path.join(baseDir, name);
  const data = Buffer.from(message.contentBase64 || '', 'base64');
  fs.writeFileSync(targetPath, data);

  sqlite.prepare(`
    INSERT INTO connector_artifacts
      (id, job_id, connector_id, name, path, size, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(artifactId, message.jobId, connectorId, name, targetPath, data.length, now());
}

function appendJobOutput(jobId, stream, data) {
  const sqlite = getSQLite();
  const column = stream === 'stderr' ? 'stderr' : 'stdout';
  sqlite.prepare(`
    UPDATE connector_jobs
    SET status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
        started_at = COALESCE(started_at, ?),
        ${column} = COALESCE(${column}, '') || ?
    WHERE id = ?
  `).run(now(), data, jobId);
}

function completeJob(message) {
  const sqlite = getSQLite();
  const endedAt = now();
  const status = message.exitCode === 0 ? 'succeeded' : 'failed';
  sqlite.prepare(`
    UPDATE connector_jobs
    SET status = ?, exit_code = ?, ended_at = ?, started_at = COALESCE(started_at, ?)
    WHERE id = ?
  `).run(status, message.exitCode, endedAt, endedAt, message.jobId);

  const row = sqlite.prepare('SELECT * FROM connector_jobs WHERE id = ?').get(message.jobId);
  const pending = pendingJobs.get(message.jobId);
  if (pending) {
    clearTimeout(pending.timeout);
    pendingJobs.delete(message.jobId);
    pending.resolve(getJob(message.jobId));
  }
}

function setupConnectorWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/api/connectors/ws') return;

    const connector = authenticateConnector(
      url.searchParams.get('connectorId'),
      url.searchParams.get('secret')
    );

    if (!connector) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, connector);
    });
  });

  wss.on('connection', (ws, request, connector) => {
    const sqlite = getSQLite();
    clients.set(connector.id, { ws, connectedAt: now() });
    sqlite.prepare(`
      UPDATE connectors
      SET status = 'online', last_seen_at = ?
      WHERE id = ?
    `).run(now(), connector.id);
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: CONNECTOR_PROTOCOL_VERSION }));

    ws.on('message', (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON message.' }));
        return;
      }

      if (message.type === 'job:output') {
        appendJobOutput(message.jobId, message.stream, message.data || '');
      } else if (message.type === 'job:complete') {
        completeJob(message);
      } else if (message.type === 'artifact:file') {
        storeArtifact(message, connector.id);
      } else if (message.type === 'heartbeat') {
        sqlite.prepare('UPDATE connectors SET last_seen_at = ? WHERE id = ?').run(now(), connector.id);
        ws.send(JSON.stringify({ type: 'heartbeat:ack', at: now() }));
      }
    });

    ws.on('close', () => {
      const current = clients.get(connector.id);
      if (current && current.ws === ws) {
        clients.delete(connector.id);
        sqlite.prepare(`
          UPDATE connectors
          SET status = 'offline', last_seen_at = ?
          WHERE id = ?
        `).run(now(), connector.id);
      }
    });
  });
}

function getJob(jobId) {
  const sqlite = getSQLite();
  const row = sqlite.prepare('SELECT * FROM connector_jobs WHERE id = ?').get(jobId);
  if (!row) return null;
  const artifacts = sqlite.prepare('SELECT id, name, path, size, created_at FROM connector_artifacts WHERE job_id = ? ORDER BY created_at ASC')
    .all(jobId)
    .map(artifact => ({
      id: artifact.id,
      name: artifact.name,
      path: artifact.path,
      size: artifact.size,
      createdAt: artifact.created_at,
    }));

  return {
    id: row.id,
    connectorId: row.connector_id,
    projectId: row.project_id,
    shell: row.shell,
    command: row.command,
    cwd: row.cwd,
    status: row.status,
    stdout: row.stdout || '',
    stderr: row.stderr || '',
    exitCode: row.exit_code,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    artifacts,
  };
}

module.exports = {
  createPairingToken,
  registerConnector,
  listConnectors,
  getConnector,
  updateConnector,
  createJob,
  getJob,
  setupConnectorWebSocket,
};
