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

function safeSocketWrite(socket, data) {
  if (!socket || socket.destroyed || socket.writableEnded || !socket.writable) return false;
  try {
    socket.write(data);
    return true;
  } catch (_) {
    return false;
  }
}

function safeSocketDestroy(socket) {
  if (!socket || socket.destroyed) return;
  try {
    socket.destroy();
  } catch (_) {}
}

function proxyHeaders(req, workspaceId) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['accept-encoding'];
  headers['x-forwarded-host'] = req.headers.host || '';
  headers['x-forwarded-proto'] = req.protocol || 'http';
  headers['x-forwarded-prefix'] = `/workspaces/${workspaceId}/cdesktop`;
  return headers;
}

function isExternalOrSpecialUrl(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
}

function withPrefix(value, prefix) {
  if (!value || typeof value !== 'string') return value;
  if (isExternalOrSpecialUrl(value) || value.startsWith(`${prefix}/`) || value === prefix) {
    return value;
  }
  if (value.startsWith('/')) return `${prefix}${value}`;
  return value;
}

function cdesktopShim(prefix) {
  return `<script>
(() => {
  const prefix = ${JSON.stringify(prefix)};
  window.__OPUS_CDESKTOP_PREFIX__ = prefix;
  const shouldProxy = value => (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    value !== prefix &&
    !value.startsWith(prefix + '/')
  );
  const proxiedPath = value => shouldProxy(value) ? prefix + value : value;
  const proxiedUrl = value => {
    if (value instanceof URL) {
      if (value.origin === window.location.origin) {
        return new URL(proxiedPath(value.pathname) + value.search + value.hash, window.location.origin);
      }
      return value;
    }
    if (typeof value !== 'string') return value;
    try {
      const url = new URL(value, window.location.href);
      if (url.origin === window.location.origin && shouldProxy(url.pathname)) {
        return proxiedPath(url.pathname) + url.search + url.hash;
      }
    } catch (_) {}
    return proxiedPath(value);
  };
  const proxiedWsUrl = value => {
    if (typeof value !== 'string') return value;
    try {
      const url = new URL(value, window.location.href);
      const sameHost = url.host === window.location.host && /^wss?:$/.test(url.protocol);
      if (sameHost && shouldProxy(url.pathname)) {
        url.pathname = proxiedPath(url.pathname);
        return url.toString();
      }
    } catch (_) {}
    return value;
  };

  const originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function(input, init) {
      if (input instanceof Request) {
        return originalFetch.call(this, new Request(proxiedUrl(input.url), input), init);
      }
      return originalFetch.call(this, proxiedUrl(input), init);
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    return originalOpen.call(this, method, proxiedUrl(url), ...rest);
  };

  if (window.EventSource) {
    const OriginalEventSource = window.EventSource;
    window.EventSource = function(url, config) {
      return new OriginalEventSource(proxiedUrl(url), config);
    };
    window.EventSource.prototype = OriginalEventSource.prototype;
  }

  if (window.WebSocket) {
    const OriginalWebSocket = window.WebSocket;
    window.WebSocket = function(url, protocols) {
      return protocols === undefined
        ? new OriginalWebSocket(proxiedWsUrl(url))
        : new OriginalWebSocket(proxiedWsUrl(url), protocols);
    };
    window.WebSocket.prototype = OriginalWebSocket.prototype;
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function(state, title, url) {
    return originalPushState.call(this, state, title, url === undefined ? url : proxiedUrl(url));
  };
  history.replaceState = function(state, title, url) {
    return originalReplaceState.call(this, state, title, url === undefined ? url : proxiedUrl(url));
  };
})();
</script>`;
}

function rewriteHtml(body, workspaceId) {
  const prefix = `/workspaces/${workspaceId}/cdesktop`;
  const rewritten = body
    .replace(
      /\b(src|href|action)=(["'])(\/(?!\/)[^"']*)\2/g,
      (_, attr, quote, value) => `${attr}=${quote}${withPrefix(value, prefix)}${quote}`
    )
    .replace(
      /\b(srcset)=(["'])([^"']*)\2/g,
      (_, attr, quote, value) => {
        const items = value.split(',').map(item => {
          const trimmed = item.trim();
          const [url, ...descriptors] = trimmed.split(/\s+/);
          return [withPrefix(url, prefix), ...descriptors].join(' ');
        });
        return `${attr}=${quote}${items.join(', ')}${quote}`;
      }
    );
  if (rewritten.includes('window.__OPUS_CDESKTOP_PREFIX__')) return rewritten;
  return rewritten.replace(/<head([^>]*)>/i, match => `${match}\n${cdesktopShim(prefix)}`);
}

function rewriteCss(body, workspaceId) {
  const prefix = `/workspaces/${workspaceId}/cdesktop`;
  return body.replace(
    /url\((["']?)(\/(?!\/)[^)'" ]+)\1\)/g,
    (_, quote, value) => `url(${quote}${withPrefix(value, prefix)}${quote})`
  );
}

function rewriteJs(body, workspaceId) {
  const prefix = `/workspaces/${workspaceId}/cdesktop`;
  return body
    .replace(
      /(["'`])assets\//g,
      (_, quote) => `${quote}${prefix.slice(1)}/assets/`
    )
    .replace(
      /(basepath\s*:\s*)(["'`])\/\2/g,
      (_, key, quote) => `${key}${quote}${prefix}${quote}`
    )
    .replace(
      /(basepath\?\?)(["'`])\/\2/g,
      (_, key, quote) => `${key}${quote}${prefix}${quote}`
    );
}

function rewriteBody(body, contentType, workspaceId) {
  if (contentType.includes('text/html')) return rewriteHtml(body, workspaceId);
  if (contentType.includes('text/css')) return rewriteCss(body, workspaceId);
  if (
    contentType.includes('javascript') ||
    contentType.includes('ecmascript')
  ) {
    return rewriteJs(body, workspaceId);
  }
  return null;
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
    const shouldRewrite = (
      contentType.includes('text/html') ||
      contentType.includes('text/css') ||
      contentType.includes('javascript') ||
      contentType.includes('ecmascript')
    );

    for (const [key, value] of Object.entries(upstreamRes.headers)) {
      if (value === undefined) continue;
      const lower = key.toLowerCase();
      if (shouldRewrite && (lower === 'content-length' || lower === 'content-encoding')) continue;
      res.setHeader(key, value);
    }

    if (!shouldRewrite) {
      upstreamRes.pipe(res);
      return;
    }

    const chunks = [];
    upstreamRes.on('data', chunk => chunks.push(chunk));
    upstreamRes.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const rewritten = rewriteBody(body, contentType, parsed.workspaceId);
      res.end(rewritten === null ? body : rewritten);
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
        safeSocketWrite(socket, 'HTTP/1.1 401 Unauthorized\r\n\r\n');
        safeSocketDestroy(socket);
        return;
      }

      let connected = false;
      const upstream = net.connect(CDESKTOP_PORT, containerName(parsed.workspaceId), () => {
        connected = true;
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
        if (!upstream.destroyed && upstream.writable) upstream.write(headers);
        if (head?.length && !upstream.destroyed && upstream.writable) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });

      upstream.on('error', () => {
        if (!connected) {
          safeSocketWrite(socket, 'HTTP/1.1 502 Bad Gateway\r\n\r\n');
        }
        safeSocketDestroy(socket);
      });

      socket.on('error', () => {
        safeSocketDestroy(upstream);
      });
    });
  });
}

module.exports = { setupCdesktopProxy };
