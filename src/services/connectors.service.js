const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const { getSQLite } = require('../db');
const { DATA_DIR, PROJECTS_DIR } = require('../config');

const CONNECTOR_PROTOCOL_VERSION = 2;
const clients = new Map();
const pendingJobs = new Map();
const pendingRequests = new Map();
const pendingTransfers = new Map();
const TRANSFER_CHUNK_SIZE = 256 * 1024;

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

function normalizeCapabilities(capabilities) {
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) return {};
  try {
    return JSON.parse(JSON.stringify(capabilities));
  } catch (_) {
    return {};
  }
}

function parseCapabilities(value) {
  try {
    const parsed = JSON.parse(value || '{}');
    return normalizeCapabilities(parsed);
  } catch (_) {
    return {};
  }
}

// Feature negotiation. Scripts, file transfer, and job cancellation depend on
// the richer "v2" connector protocol. A v2 connector advertises
// `capabilities.protocol >= 2`; the first-generation Linux connector shipped
// these features before the marker existed, so it is grandfathered in.
function connectorProtocol(row) {
  if (!row) return 0;
  const caps = typeof row.capabilities === 'string'
    ? parseCapabilities(row.capabilities)
    : normalizeCapabilities(row.capabilities);
  const proto = Number(caps.protocol) || 0;
  if (proto >= 2) return proto;
  if (row.platform === 'linux') return 2;
  return proto || 1;
}

function connectorSupportsV2(row) {
  return connectorProtocol(row) >= 2;
}

function publicConnector(row) {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    hostname: row.hostname,
    version: row.version,
    labels: parseLabels(row.labels),
    capabilities: parseCapabilities(row.capabilities),
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

function registerConnector({ pairingToken, name, platform, hostname, version, labels, capabilities }) {
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
      (id, name, secret_hash, platform, hostname, version, labels, capabilities, status, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offline', NULL, ?)
  `).run(
    connectorId,
    name || pairing.name || hostname || os.hostname(),
    sha256(secret),
    platform || 'windows',
    hostname || '',
    version || '',
    JSON.stringify(normalizeLabels(labels)),
    JSON.stringify(normalizeCapabilities(capabilities)),
    createdAt
  );
  sqlite.prepare('UPDATE connector_pairing_tokens SET used_at = ? WHERE id = ?').run(createdAt, pairing.id);

  return {
    connectorId,
    connectorSecret: secret,
    protocolVersion: CONNECTOR_PROTOCOL_VERSION,
  };
}

function updateConnectorRuntime(connectorId, { hostname, version, capabilities } = {}) {
  const sqlite = getSQLite();
  const updates = ['last_seen_at = ?'];
  const params = [now()];
  if (hostname) {
    updates.push('hostname = ?');
    params.push(String(hostname));
  }
  if (version) {
    updates.push('version = ?');
    params.push(String(version));
  }
  if (capabilities && typeof capabilities === 'object') {
    updates.push('capabilities = ?');
    params.push(JSON.stringify(normalizeCapabilities(capabilities)));
  }
  params.push(connectorId);
  sqlite.prepare(`UPDATE connectors SET ${updates.join(', ')} WHERE id = ?`).run(...params);
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

function createJob({ connectorId, userId, projectId, shell, command, cwd, env, args, stdin, script, timeoutMs = 30 * 60 * 1000 }) {
  const sqlite = getSQLite();
  const connector = sqlite.prepare('SELECT * FROM connectors WHERE id = ?').get(connectorId);
  if (!connector) {
    const err = new Error('Connector not found.');
    err.status = 404;
    throw err;
  }
  if ((script?.content || typeof stdin === 'string') && !connectorSupportsV2(connector)) {
    const err = new Error('Script/stdin execution requires a v2 connector.');
    err.status = 400;
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
  const displayCommand = command || script?.name || '[script]';
  sqlite.prepare(`
    INSERT INTO connector_jobs
      (id, connector_id, project_id, user_id, shell, command, cwd, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
  `).run(id, connectorId, projectId || null, userId || null, shell || 'powershell', displayCommand, cwd || null, createdAt);

  const job = {
    id,
    shell: shell || 'powershell',
    command: command || '',
    cwd: cwd || null,
    env: env && typeof env === 'object' ? env : undefined,
    args: Array.isArray(args) ? args : undefined,
    stdin: typeof stdin === 'string' ? stdin : undefined,
    script: script && typeof script === 'object' ? script : undefined,
    timeoutMs,
  };
  const completion = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingJobs.delete(id);
      sqlite.prepare(`
        UPDATE connector_jobs
        SET status = 'timeout', ended_at = ?
        WHERE id = ?
      `).run(now(), id);
      if (client.ws.readyState === 1) {
        client.ws.send(JSON.stringify({ type: 'job:cancel', jobId: id }));
      }
      resolve(getJob(id));
    }, timeoutMs);
    pendingJobs.set(id, { resolve, reject, timeout });
  });

  client.ws.send(JSON.stringify({ type: 'job:start', job }));
  return { job, completion };
}

function listJobs({ connectorId, projectId, limit = 50 } = {}) {
  const sqlite = getSQLite();
  const where = [];
  const params = [];
  if (connectorId) {
    where.push('connector_id = ?');
    params.push(connectorId);
  }
  if (projectId) {
    where.push('project_id = ?');
    params.push(projectId);
  }
  params.push(Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200));
  const rows = sqlite.prepare(`
    SELECT id FROM connector_jobs
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params);
  return rows.map(row => getJob(row.id)).filter(Boolean);
}

function cancelJob(jobId) {
  const sqlite = getSQLite();
  const row = sqlite.prepare('SELECT * FROM connector_jobs WHERE id = ?').get(jobId);
  if (!row) {
    const err = new Error('Job not found.');
    err.status = 404;
    throw err;
  }
  if (['succeeded', 'failed', 'timeout', 'canceled', 'lost'].includes(row.status)) {
    return getJob(jobId);
  }
  const connector = sqlite.prepare('SELECT platform, capabilities FROM connectors WHERE id = ?').get(row.connector_id);
  if (!connectorSupportsV2(connector)) {
    const err = new Error('Job cancellation requires a v2 connector.');
    err.status = 400;
    throw err;
  }

  sqlite.prepare('UPDATE connector_jobs SET status = ? WHERE id = ?').run('canceling', jobId);
  const client = clients.get(row.connector_id);
  if (client?.ws?.readyState === 1) {
    client.ws.send(JSON.stringify({ type: 'job:cancel', jobId }));
  }
  return getJob(jobId);
}

function sendConnectorRequest(connectorId, message, timeoutMs = 60 * 1000) {
  const client = clients.get(connectorId);
  if (!client || client.ws.readyState !== 1) {
    const err = new Error('Connector is offline.');
    err.status = 409;
    throw err;
  }

  const requestId = randomId('req');
  const payload = { ...message, requestId };
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Connector request timed out.'));
    }, timeoutMs);
    pendingRequests.set(requestId, { resolve, reject, timeout });
  });
  client.ws.send(JSON.stringify(payload));
  return promise;
}

function ensureV2Connector(connectorId, feature) {
  const connector = getSQLite().prepare('SELECT platform, capabilities FROM connectors WHERE id = ?').get(connectorId);
  if (!connector) {
    const err = new Error('Connector not found.');
    err.status = 404;
    throw err;
  }
  if (!connectorSupportsV2(connector)) {
    const err = new Error(`${feature} requires a v2 connector.`);
    err.status = 400;
    throw err;
  }
  return connector;
}

async function readConnectorFile(connectorId, filePath) {
  if (!filePath) {
    const err = new Error('Path is required.');
    err.status = 400;
    throw err;
  }
  ensureV2Connector(connectorId, 'File transfer');
  return readConnectorFileChunked(connectorId, filePath);
}

function streamConnectorFile(connectorId, filePath, writable) {
  if (!filePath) {
    const err = new Error('Path is required.');
    err.status = 400;
    throw err;
  }
  ensureV2Connector(connectorId, 'File transfer');
  const client = clients.get(connectorId);
  if (!client || client.ws.readyState !== 1) {
    const err = new Error('Connector is offline.');
    err.status = 409;
    throw err;
  }

  const transferId = randomId('xfer');
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingTransfers.delete(transferId);
      reject(new Error('Connector file download timed out.'));
    }, 5 * 60 * 1000);
    pendingTransfers.set(transferId, {
      direction: 'download-stream',
      writable,
      timeout,
      resolve,
      reject,
    });
  });
  client.ws.send(JSON.stringify({ type: 'file:download:start', transferId, path: filePath, chunkSize: TRANSFER_CHUNK_SIZE }));
  return promise;
}

async function writeConnectorFile(connectorId, { filePath, contentBase64, mode }) {
  if (!filePath) {
    const err = new Error('Path is required.');
    err.status = 400;
    throw err;
  }
  ensureV2Connector(connectorId, 'File transfer');
  return writeConnectorFileChunked(connectorId, {
    filePath,
    data: Buffer.from(contentBase64 || '', 'base64'),
    mode,
  });
}

async function writeConnectorFileBytes(connectorId, { filePath, data, mode }) {
  if (!filePath) {
    const err = new Error('Path is required.');
    err.status = 400;
    throw err;
  }
  ensureV2Connector(connectorId, 'File transfer');
  return writeConnectorFileChunked(connectorId, {
    filePath,
    data: Buffer.isBuffer(data) ? data : Buffer.from(data || ''),
    mode,
  });
}

function streamUploadConnectorFile(connectorId, { filePath, readable, mode }) {
  if (!filePath) {
    const err = new Error('Path is required.');
    err.status = 400;
    throw err;
  }
  ensureV2Connector(connectorId, 'File transfer');
  const client = clients.get(connectorId);
  if (!client || client.ws.readyState !== 1) {
    const err = new Error('Connector is offline.');
    err.status = 409;
    throw err;
  }

  const transferId = randomId('xfer');
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingTransfers.delete(transferId);
      reject(new Error('Connector file upload timed out.'));
    }, 5 * 60 * 1000);
    pendingTransfers.set(transferId, {
      direction: 'upload-stream',
      timeout,
      resolve,
      reject,
    });
  });

  let offset = 0;
  client.ws.send(JSON.stringify({
    type: 'file:upload:start',
    transferId,
    path: filePath,
    mode,
  }));

  readable.on('data', chunk => {
    const data = Buffer.from(chunk);
    client.ws.send(JSON.stringify({
      type: 'file:upload:chunk',
      transferId,
      offset,
      contentBase64: data.toString('base64'),
    }));
    offset += data.length;
  });
  readable.on('end', () => {
    client.ws.send(JSON.stringify({ type: 'file:upload:complete', transferId }));
  });
  readable.on('error', err => {
    rejectTransfer(transferId, err);
  });

  return promise;
}

function createFeedback(connectorId, report) {
  ensureV2Connector(connectorId, 'Connector feedback');
  return sendConnectorRequest(connectorId, {
    type: 'feedback:create',
    report: report && typeof report === 'object' ? report : {},
  });
}

function listFeedback(connectorId, { includeRead = true, limit = 100 } = {}) {
  ensureV2Connector(connectorId, 'Connector feedback');
  return sendConnectorRequest(connectorId, {
    type: 'feedback:list',
    includeRead,
    limit,
  });
}

function markFeedbackRead(connectorId, feedbackId, read = true) {
  ensureV2Connector(connectorId, 'Connector feedback');
  return sendConnectorRequest(connectorId, {
    type: 'feedback:mark-read',
    feedbackId,
    read,
  });
}

function rejectTransfer(transferId, err) {
  const transfer = pendingTransfers.get(transferId);
  if (!transfer) return;
  clearTimeout(transfer.timeout);
  pendingTransfers.delete(transferId);
  transfer.reject(err);
}

function readConnectorFileChunked(connectorId, filePath) {
  const client = clients.get(connectorId);
  if (!client || client.ws.readyState !== 1) {
    const err = new Error('Connector is offline.');
    err.status = 409;
    throw err;
  }
  const transferId = randomId('xfer');
  const chunks = [];
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingTransfers.delete(transferId);
      reject(new Error('Connector file download timed out.'));
    }, 5 * 60 * 1000);
    pendingTransfers.set(transferId, {
      direction: 'download',
      chunks,
      timeout,
      resolve,
      reject,
    });
  });
  client.ws.send(JSON.stringify({ type: 'file:download:start', transferId, path: filePath, chunkSize: TRANSFER_CHUNK_SIZE }));
  return promise;
}

function writeConnectorFileChunked(connectorId, { filePath, data, mode }) {
  const client = clients.get(connectorId);
  if (!client || client.ws.readyState !== 1) {
    const err = new Error('Connector is offline.');
    err.status = 409;
    throw err;
  }
  const transferId = randomId('xfer');
  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingTransfers.delete(transferId);
      reject(new Error('Connector file upload timed out.'));
    }, 5 * 60 * 1000);
    pendingTransfers.set(transferId, {
      direction: 'upload',
      timeout,
      resolve,
      reject,
    });
  });
  client.ws.send(JSON.stringify({
    type: 'file:upload:start',
    transferId,
    path: filePath,
    size: data.length,
    mode,
  }));
  for (let offset = 0; offset < data.length; offset += TRANSFER_CHUNK_SIZE) {
    client.ws.send(JSON.stringify({
      type: 'file:upload:chunk',
      transferId,
      offset,
      contentBase64: data.subarray(offset, offset + TRANSFER_CHUNK_SIZE).toString('base64'),
    }));
  }
  client.ws.send(JSON.stringify({ type: 'file:upload:complete', transferId }));
  return promise;
}

function handleTransferMessage(message) {
  const transfer = pendingTransfers.get(message.transferId);
  if (!transfer) return;

  if (message.type === 'file:download:chunk') {
    if (transfer.direction === 'download-stream') {
      transfer.writable.write(Buffer.from(message.contentBase64 || '', 'base64'));
      return;
    }
    transfer.chunks.push(Buffer.from(message.contentBase64 || '', 'base64'));
    return;
  }

  if (message.type === 'file:download:complete') {
    clearTimeout(transfer.timeout);
    pendingTransfers.delete(message.transferId);
    if (transfer.direction === 'download-stream') {
      transfer.writable.end();
      transfer.resolve({
        path: message.path,
        name: message.name,
        size: message.size,
      });
      return;
    }
    const data = Buffer.concat(transfer.chunks);
    transfer.resolve({
      path: message.path,
      name: message.name,
      size: data.length,
      contentBase64: data.toString('base64'),
    });
    return;
  }

  if (message.type === 'file:upload:complete') {
    clearTimeout(transfer.timeout);
    pendingTransfers.delete(message.transferId);
    transfer.resolve(message.result || { path: message.path, size: message.size });
    return;
  }

  if (message.type === 'file:transfer:error') {
    clearTimeout(transfer.timeout);
    pendingTransfers.delete(message.transferId);
    if (transfer.direction === 'download-stream') {
      transfer.writable.destroy(new Error(message.error || 'Connector file transfer failed.'));
    }
    transfer.reject(new Error(message.error || 'Connector file transfer failed.'));
  }
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
  const existing = sqlite.prepare('SELECT status FROM connector_jobs WHERE id = ?').get(message.jobId);
  if (['timeout', 'lost'].includes(existing?.status)) return;
  const status = message.canceled || existing?.status === 'canceling'
    ? 'canceled'
    : message.exitCode === 0 ? 'succeeded' : 'failed';
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

function markConnectorJobsDisconnected(connectorId) {
  const sqlite = getSQLite();
  const endedAt = now();
  const rows = sqlite.prepare(`
    SELECT id FROM connector_jobs
    WHERE connector_id = ? AND status IN ('queued', 'running', 'canceling')
  `).all(connectorId);
  for (const row of rows) {
    sqlite.prepare(`
      UPDATE connector_jobs
      SET status = 'lost', ended_at = COALESCE(ended_at, ?),
          stderr = COALESCE(stderr, '') || ?
      WHERE id = ?
    `).run(endedAt, '\n[opus] connector disconnected before the job completed.\n', row.id);
    const pending = pendingJobs.get(row.id);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingJobs.delete(row.id);
      pending.resolve(getJob(row.id));
    }
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
      } else if (message.type === 'capabilities:update') {
        updateConnectorRuntime(connector.id, { capabilities: message.capabilities });
      } else if (message.type === 'heartbeat') {
        updateConnectorRuntime(connector.id, {
          hostname: message.hostname,
          version: message.version,
          capabilities: message.capabilities,
        });
        ws.send(JSON.stringify({ type: 'heartbeat:ack', at: now() }));
      } else if (message.type === 'response') {
        const pending = pendingRequests.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        pendingRequests.delete(message.requestId);
        if (message.ok === false) pending.reject(new Error(message.error || 'Connector request failed.'));
        else pending.resolve(message.result || {});
      } else if (message.type?.startsWith('file:')) {
        handleTransferMessage(message);
      }
    });

    ws.on('close', () => {
      const current = clients.get(connector.id);
      if (current && current.ws === ws) {
        clients.delete(connector.id);
        markConnectorJobsDisconnected(connector.id);
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

function getArtifact(artifactId) {
  const row = getSQLite().prepare('SELECT id, job_id, name, path, size FROM connector_artifacts WHERE id = ?').get(artifactId);
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id,
    name: row.name,
    path: row.path,
    size: row.size,
  };
}

module.exports = {
  createPairingToken,
  registerConnector,
  listConnectors,
  getConnector,
  updateConnector,
  createJob,
  listJobs,
  cancelJob,
  getJob,
  getArtifact,
  readConnectorFile,
  streamConnectorFile,
  writeConnectorFile,
  writeConnectorFileBytes,
  streamUploadConnectorFile,
  createFeedback,
  listFeedback,
  markFeedbackRead,
  setupConnectorWebSocket,
};
