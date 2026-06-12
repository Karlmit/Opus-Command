/**
 * unraid-agent.service.js — client for the Opus Connect Unraid plugin agent.
 *
 * The secure alternative to ssh.service: instead of holding a root SSH key,
 * Opus Command calls named, pre-approved actions on the Opus Connect agent
 * (POST /v1/rpc) over TLS with a Bearer API key. The agent validates every
 * argument server-side (container-name prefix, share-path boundary) and owns
 * all host-side command construction.
 *
 * TLS trust: the agent uses a self-signed certificate, so identity comes from
 * SHA-256 fingerprint pinning. The TLS handshake completes and the peer
 * certificate is verified against the pinned fingerprint BEFORE any HTTP bytes
 * (including the API key header) are written. The first successful connection
 * test pins the fingerprint (trust-on-first-use); a later mismatch hard-fails
 * until the user resets the pin in Settings.
 */

const tls = require('tls');
const http = require('http');
const net = require('net');
const lxcConfig = require('./unraid-lxc.config');

const DEFAULT_AGENT_PORT = 9123;
const DEFAULT_TIMEOUT_MS = 120_000;

/** Parse the configured agent URL into { host, port }. Accepts
 *  "https://host:port", "host:port", or a bare host (default port 9123). */
function agentTarget(cfg) {
  let raw = String(cfg.agentUrl || '').trim();
  if (!raw) throw new Error('Opus Connect agent URL is not configured.');
  if (/^http:\/\//i.test(raw)) throw new Error('The Opus Connect agent only speaks HTTPS — use https:// (or just host:port).');
  if (!/^https:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid agent URL: ${cfg.agentUrl}`);
  }
  return { host: url.hostname, port: parseInt(url.port, 10) || DEFAULT_AGENT_PORT };
}

function normalizeFp(fp) {
  return String(fp || '').replace(/[^a-fA-F0-9]/g, '').toUpperCase();
}

/**
 * Open a TLS connection and verify the peer certificate fingerprint before
 * resolving. Nothing application-level is sent until this resolves, so a
 * mismatched (possibly MITM'd) endpoint never sees the API key.
 */
function pinnedTlsConnect(host, port, pinnedFingerprint, timeoutMs) {
  return new Promise((resolve, reject) => {
    const options = { host, port, rejectUnauthorized: false };
    // SNI is only valid for hostnames, not IP literals.
    if (!net.isIP(host)) options.servername = host;
    const socket = tls.connect(options);
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(err);
    };
    socket.setTimeout(timeoutMs, () => fail(new Error(`Agent connection timed out after ${timeoutMs}ms`)));
    socket.once('error', (err) => fail(new Error(`Agent connection failed: ${err.message}`)));
    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate();
      const fingerprint = cert && cert.fingerprint256;
      if (!fingerprint) return fail(new Error('Could not read the agent TLS certificate.'));
      if (pinnedFingerprint && normalizeFp(fingerprint) !== normalizeFp(pinnedFingerprint)) {
        return fail(new Error(
          'Agent TLS certificate changed — refusing to send credentials. ' +
          'If you reinstalled the Opus Connect plugin, reset the pinned certificate in Settings and test again.',
        ));
      }
      settled = true;
      socket.setTimeout(0);
      resolve({ socket, fingerprint });
    });
  });
}

/**
 * Low-level request. Resolves with { data, fingerprint }. Rejects on transport
 * errors, fingerprint mismatch, or non-JSON responses; HTTP-level errors are
 * surfaced via the parsed body's `error` field by callers.
 */
function rawRequest(body, { override, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const cfg = override ? { ...lxcConfig.getConfig(), ...override } : lxcConfig.getConfig();
  if (!cfg.agentApiKey) return Promise.reject(new Error('Opus Connect API key is not configured.'));
  const { host, port } = agentTarget(cfg);
  const payload = Buffer.from(JSON.stringify(body), 'utf8');

  return new Promise(async (resolve, reject) => {
    let socket;
    let fingerprint;
    try {
      ({ socket, fingerprint } = await pinnedTlsConnect(host, port, cfg.agentFingerprint, Math.min(timeoutMs, 15_000)));
    } catch (err) {
      return reject(err);
    }

    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch (_) {}
      fn(arg);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(`Agent request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const req = http.request({
      createConnection: () => socket,
      host,
      port,
      path: '/v1/rpc',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.agentApiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
        Connection: 'close',
      },
    }, (res) => {
      let raw = '';
      res.on('data', (d) => { raw += d.toString('utf8'); });
      res.on('end', () => {
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          return finish(reject, new Error(`Agent returned a non-JSON response (HTTP ${res.statusCode}).`));
        }
        finish(resolve, { data, status: res.statusCode, fingerprint });
      });
    });
    req.on('error', (err) => finish(reject, new Error(`Agent request failed: ${err.message}`)));
    req.end(payload);
  });
}

/**
 * Call a named agent action. Resolves with the agent's response payload
 * (e.g. { code, stdout, stderr } for command-backed actions). Throws on
 * transport failures and on { ok: false } responses.
 */
async function rpc(action, params = {}, { timeoutMs } = {}) {
  const { data } = await rawRequest({ action, params }, { timeoutMs });
  if (!data.ok) throw new Error(data.error || `agent action ${action} failed`);
  return data;
}

/** Connectivity probe — returns { ok, hostname?, agentVersion?, fingerprint?, error? }. */
async function testConnection(override) {
  try {
    const { data, fingerprint } = await rawRequest(
      { action: 'host.ping', params: {} },
      { override, timeoutMs: 15_000 },
    );
    if (!data.ok) return { ok: false, error: data.error || 'agent rejected the request', fingerprint };
    return { ok: true, hostname: data.hostname, agentVersion: data.agentVersion, fingerprint };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  DEFAULT_AGENT_PORT,
  rpc,
  testConnection,
};
