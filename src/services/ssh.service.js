/**
 * ssh.service.js — thin SSH layer for the Unraid LXC backend.
 *
 * All Unraid interaction goes through this single helper so a future V2 can
 * swap SSH/root for a safer local host agent without touching callers. Uses the
 * pure-JS `ssh2` library (no system ssh binary required, works in node:slim).
 *
 * Connection parameters come from unraid-lxc.config (env > stored > default).
 * The private key is read from the configured key file on disk.
 */

const fs = require('fs');
const { Client } = require('ssh2');
const lxcConfig = require('./unraid-lxc.config');

const CONNECT_TIMEOUT_MS = 12_000;
const EXEC_TIMEOUT_MS = 120_000;

function resolveConnection(override) {
  const cfg = override ? { ...lxcConfig.getConfig(), ...override } : lxcConfig.getConfig();
  if (!cfg.host) throw new Error('Unraid host is not configured.');
  if (!cfg.sshKeyPath) throw new Error('SSH key path is not configured.');
  let privateKey;
  try {
    privateKey = fs.readFileSync(cfg.sshKeyPath);
  } catch {
    throw new Error(`SSH private key not found at ${cfg.sshKeyPath}. Upload or paste a key in Settings.`);
  }
  return {
    host: cfg.host,
    port: cfg.sshPort || 22,
    username: cfg.sshUser || 'root',
    privateKey,
    readyTimeout: CONNECT_TIMEOUT_MS,
    // Match the manual workflow: do not depend on known_hosts.
    algorithms: undefined,
  };
}

function connect(override) {
  return new Promise((resolve, reject) => {
    let conn;
    try {
      conn = new Client();
    } catch (err) {
      return reject(err);
    }
    const onError = (err) => {
      conn.removeListener('ready', onReady);
      reject(new Error(`SSH connection failed: ${err.message}`));
    };
    const onReady = () => {
      conn.removeListener('error', onError);
      resolve(conn);
    };
    conn.once('ready', onReady);
    conn.once('error', onError);
    try {
      conn.connect(resolveConnection(override));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Run a command and collect output. Resolves with { code, stdout, stderr }.
 * Never rejects on a non-zero exit code — callers decide what a failure means.
 */
function exec(command, { override, timeoutMs = EXEC_TIMEOUT_MS } = {}) {
  return new Promise(async (resolve, reject) => {
    let conn;
    try {
      conn = await connect(override);
    } catch (err) {
      return reject(err);
    }

    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { conn.end(); } catch (_) {}
      fn(arg);
    };

    const timer = setTimeout(() => {
      finish(reject, new Error(`SSH command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    conn.exec(command, (err, stream) => {
      if (err) return finish(reject, err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => finish(resolve, { code: code == null ? null : code, stdout, stderr }))
        .on('data', (d) => { stdout += d.toString('utf8'); })
        .stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    });
  });
}

/**
 * Pipe a script to `bash -s` over stdin with positional args. Avoids quoting
 * pitfalls of inlining large scripts. Resolves with { code, stdout, stderr }.
 */
function execScript(scriptContents, args = [], opts = {}) {
  const quotedArgs = args.map((a) => `'${String(a).replace(/'/g, `'\\''`)}'`).join(' ');
  const command = `bash -s -- ${quotedArgs}`;
  return new Promise(async (resolve, reject) => {
    let conn;
    try {
      conn = await connect(opts.override);
    } catch (err) {
      return reject(err);
    }
    let settled = false;
    const timeoutMs = opts.timeoutMs || EXEC_TIMEOUT_MS;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { conn.end(); } catch (_) {}
      fn(arg);
    };
    const timer = setTimeout(() => finish(reject, new Error(`SSH script timed out after ${timeoutMs}ms`)), timeoutMs);

    conn.exec(command, (err, stream) => {
      if (err) return finish(reject, err);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => finish(resolve, { code: code == null ? null : code, stdout, stderr }))
        .on('data', (d) => { stdout += d.toString('utf8'); })
        .stderr.on('data', (d) => { stderr += d.toString('utf8'); });
      stream.end(scriptContents);
    });
  });
}

/** Write a file on the remote host via SFTP with the given mode. */
function uploadFile(remotePath, contents, mode = 0o644) {
  return new Promise(async (resolve, reject) => {
    let conn;
    try {
      conn = await connect();
    } catch (err) {
      return reject(err);
    }
    conn.sftp((err, sftp) => {
      if (err) { try { conn.end(); } catch (_) {} return reject(err); }
      const ws = sftp.createWriteStream(remotePath, { mode });
      ws.on('close', () => { try { conn.end(); } catch (_) {} resolve(remotePath); });
      ws.on('error', (e) => { try { conn.end(); } catch (_) {} reject(e); });
      ws.end(Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8'));
    });
  });
}

/** Quick connectivity probe — returns { ok, hostname?, error? }. */
async function testConnection(override) {
  try {
    const { code, stdout, stderr } = await exec('hostname', { override, timeoutMs: 15_000 });
    if (code === 0) return { ok: true, hostname: stdout.trim() };
    return { ok: false, error: stderr.trim() || `exit code ${code}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Open an interactive PTY running `command` on the remote host. Returns an
 * object exposing the live stream plus write/resize/close helpers, used by the
 * terminal service to back LXC terminal sessions over SSH.
 *
 * handlers: { onData(str), onClose(code), onError(err) }
 */
function openShell({ command, cols = 80, rows = 24 }, handlers = {}) {
  return new Promise(async (resolve, reject) => {
    let conn;
    try {
      conn = await connect();
    } catch (err) {
      return reject(err);
    }
    const ptyOpts = { term: 'xterm-256color', cols, rows };
    const cb = (err, stream) => {
      if (err) { try { conn.end(); } catch (_) {} return reject(err); }
      stream.on('data', (d) => handlers.onData && handlers.onData(d.toString('utf8')));
      stream.stderr.on('data', (d) => handlers.onData && handlers.onData(d.toString('utf8')));
      stream.on('close', (code) => {
        try { conn.end(); } catch (_) {}
        handlers.onClose && handlers.onClose(code == null ? 0 : code);
      });
      conn.on('error', (e) => handlers.onError && handlers.onError(e));
      resolve({
        write: (data) => { try { stream.write(data); } catch (_) {} },
        resize: (c, r) => { try { stream.setWindow(r, c, 0, 0); } catch (_) {} },
        close: () => { try { stream.end(); } catch (_) {} try { conn.end(); } catch (_) {} },
      });
    };
    // Run the requested command inside a PTY.
    conn.exec(command, { pty: ptyOpts }, cb);
  });
}

module.exports = {
  exec,
  execScript,
  uploadFile,
  testConnection,
  openShell,
};
