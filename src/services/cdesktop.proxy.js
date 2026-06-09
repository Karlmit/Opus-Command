const http = require('http');
const net = require('net');
const { requireAuth } = require('../middleware/auth');
const { getDB } = require('../db');
const { projects } = require('../db/schema');
const { eq } = require('drizzle-orm');
const { containerName } = require('./docker.service');
const { CDESKTOP_PORT } = require('./cdesktop.service');

function parseWorkspacePath(url) {
  const parsed = new URL(url, 'http://localhost');
  const match = parsed.pathname.match(/^\/workspaces\/(\d+)\/cdesktop(?:\/(.*))?$/);
  if (!match) return null;
  const workspaceId = parseInt(match[1], 10);
  const rest = match[2] ? `/${match[2]}` : '/';
  return { workspaceId, targetPath: `${rest}${parsed.search}` };
}

function projectExists(projectId) {
  const db = getDB();
  return !!db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).all()[0];
}

function proxyHeaders(req, workspaceId) {
  const headers = { ...req.headers };
  delete headers.host;
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.protocol || 'http';
  headers['x-forwarded-prefix'] = `/workspaces/${workspaceId}/cdesktop`;
  return headers;
}

function rewriteHtml(body, workspaceId) {
  const prefix = `/workspaces/${workspaceId}/cdesktop`;
  return body.replace(
    /\b(src|href|action)=(["'])\/(?!\/|workspaces\/)/g,
    (_, attr, quote) => `${attr}=${quote}${prefix}/`
  );
}

function proxyHttp(req, res) {
  const parsed = parseWorkspacePath(req.originalUrl || req.url);
  if (!parsed || !projectExists(parsed.workspaceId)) {
    res.status(404).json({ error: 'Workspace not found.' });
    return;
  }

  const upstream = http.request({
    hostname: containerName(parsed.workspaceId),
    port: CDESKTOP_PORT,
    method: req.method,
    path: parsed.targetPath,
    headers: proxyHeaders(req, parsed.workspaceId),
  }, upstreamRes => {
    res.statusCode = upstreamRes.statusCode || 502;
    const contentType = String(upstreamRes.headers['content-type'] || '');
    const shouldRewrite = contentType.includes('text/html');

    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined) continue;
      if (shouldRewrite && key.toLowerCase() === 'content-length') continue;
      res.setHeader(key, value);
    }

    if (!shouldRewrite) {
      upstreamRes.pipe(res);
      return;
    }

    const chunks = [];
    upstreamRes.on('data', chunk => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const html = Buffer.concat(chunks).toString('utf8');
      res.end(rewriteHtml(html, parsed.workspaceId));
    });
  });

  upstream.on('error', err => {
    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(502).send(`cdesktop is not reachable. ${err.message}`);
  });

  req.pipe(upstream);
}

function setupCdesktopProxy(app, server, sessionMiddleware) {
  app.use('/workspaces/:workspaceId/cdesktop', requireAuth, proxyHttp);

  server.on('upgrade', (request, socket, head) => {
    const parsed = parseWorkspacePath(request.url);
    if (!parsed) return;

    sessionMiddleware(request, {}, () => {
      if (!request.session?.userId || !projectExists(parsed.workspaceId)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      const upstream = net.connect(CDESKTOP_PORT, containerName(parsed.workspaceId), () => {
        const headers = [
          `GET ${parsed.targetPath} HTTP/1.1`,
          `Host: ${containerName(parsed.workspaceId)}:${CDESKTOP_PORT}`,
          `X-Forwarded-Host: ${request.headers.host || ''}`,
          `X-Forwarded-Proto: http`,
          `X-Forwarded-Prefix: /workspaces/${parsed.workspaceId}/cdesktop`,
          ...Object.entries(request.headers)
            .filter(([key]) => key.toLowerCase() !== 'host')
            .map(([key, value]) => `${key}: ${value}`),
          '',
          '',
        ].join('\r\n');
        upstream.write(headers);
        if (head?.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });

      upstream.on('error', () => {
        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        socket.destroy();
      });
    });
  });
}

module.exports = { setupCdesktopProxy };
