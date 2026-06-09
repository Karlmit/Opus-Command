import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ProjectAvatar } from '../components/ProjectsSidebar';
import { useMobileUI } from '../context/MobileUIContext';
import { useDevice } from '../context/DeviceContext';
import { getSocket } from '../lib/socket';
import MobileTerminalView from '../components/MobileTerminalView';
import SyntaxHighlightedEditor from '../components/SyntaxHighlightedEditor';
import GitPage from './Git';
import '@xterm/xterm/css/xterm.css';
import './ProjectCockpit.css';

/* ── File tree ─────────────────────────────────── */
const FILE_COLORS = {
  // Web
  js:   '#f0db4f', mjs: '#f0db4f', cjs: '#f0db4f',
  ts:   '#3178c6',
  jsx:  '#61dafb', tsx: '#61dafb',
  css:  '#6699ff', scss: '#cc6699', sass: '#cc6699',
  html: '#e34c26', htm: '#e34c26',
  // Data / config
  json: '#f5a623', jsonc: '#f5a623',
  yaml: '#cb171e', yml: '#cb171e',
  toml: '#9c4221', ini: '#9c4221', env: '#5bb974',
  xml:  '#d97706',
  // Docs
  md: '#4b9eff', mdx: '#4b9eff', txt: '#aaa',
  // Scripts
  sh: '#4eaa25', bash: '#4eaa25', zsh: '#4eaa25', ps1: '#0178d4',
  // Languages
  py: '#3572A5', rb: '#cc342d', go: '#00add8', rs: '#ce4a2e',
  java: '#b07219', kt: '#A97BFF', swift: '#F05138',
  c: '#55a1b7', cpp: '#f34b7d', h: '#55a1b7',
  cs: '#178600', php: '#4F5D95',
  sql: '#e38c00',
  // Images (shown but not editable)
  png: '#b088f0', jpg: '#b088f0', jpeg: '#b088f0',
  gif: '#b088f0', svg: '#ffb13b', webp: '#b088f0',
};

function FileIcon({ name, isDir, open }) {
  if (isDir) {
    return (
      <svg className="fi-icon fi-dir" viewBox="0 0 16 16" fill="currentColor">
        {open
          ? <path d="M1.5 3a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5V6a.5.5 0 0 0-.5-.5H7.621a.5.5 0 0 1-.44-.265L6.161 3.5H1.5z"/>
          : <path d="M.54 3.87.5 3a2 2 0 0 1 2-2h3.672a2 2 0 0 1 1.414.586l.828.828A2 2 0 0 0 9.828 3h3.982a2 2 0 0 1 1.992 2.181L15.546 12a2 2 0 0 1-1.992 1.819H1.546a2 2 0 0 1-1.992-1.82L.54 3.87z"/>}
      </svg>
    );
  }
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  const color = FILE_COLORS[ext] || '#888';
  return (
    <svg className="fi-icon fi-file" viewBox="0 0 16 16" style={{ color }} fill="currentColor">
      <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.707A1 1 0 0 0 13.707 4L10 .293A1 1 0 0 0 9.293 0H4zm5.5 1.5v2a1 1 0 0 0 1 1h2l-3-3z"/>
    </svg>
  );
}

function FileNode({
  node, depth, onOpenFile, activeFilePath,
  onOpenContextMenu, onOpenRenameDialog,
}) {
  const [open, setOpen] = useState(depth < 1);
  const isDir = node.type === 'dir';
  const isActive = activeFilePath === node.path;

  return (
    <div className="file-node-wrap">
      <div
        className={`file-node${isActive ? ' active' : ''}`}
        style={{ paddingLeft: depth * 16 + 6 }}
        tabIndex={0}
        onClick={() => { isDir ? setOpen(o => !o) : onOpenFile(node); }}
        onContextMenu={e => {
          e.preventDefault();
          e.stopPropagation();
          onOpenContextMenu(node, e.clientX, e.clientY);
        }}
        onKeyDown={e => {
          if (e.key === 'F2') {
            e.preventDefault();
            onOpenRenameDialog(node);
          }
        }}
      >
        {isDir && (
          <span className={`fn-chevron${open ? ' open' : ''}`}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M3 2l4 3-4 3V2z"/>
            </svg>
          </span>
        )}
        {!isDir && <span className="fn-chevron-gap" />}
        <FileIcon name={node.name} isDir={isDir} open={open} />
        <span className="file-node-name">{node.name}</span>
      </div>

      {isDir && open && (
        <div className="file-node-children">
          {node.children?.length === 0 && (
            <div className="file-node-empty" style={{ paddingLeft: (depth + 1) * 16 + 22 }}>
              Empty
            </div>
          )}
          {node.children?.map(c => (
            <FileNode key={c.path} node={c} depth={depth + 1}
              onOpenFile={onOpenFile}
              activeFilePath={activeFilePath}
              onOpenContextMenu={onOpenContextMenu}
              onOpenRenameDialog={onOpenRenameDialog}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Terminal instance ─────────────────────────── */
let _xtermInstanceCounter = 0;

function TerminalInstance({
  sessionId, active, termRefs, pendingScrollback,
  onScrollbackApplied, onTerminalDisposed,
}) {
  const divRef = useRef(null);
  const activeStateRef = useRef(active);

  useEffect(() => {
    activeStateRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!divRef.current || termRefs.current[sessionId]) return;
    let cancelled = false;
    const instanceId = ++_xtermInstanceCounter;
    console.log(`[xterm:${instanceId}] Opening for session ${sessionId.slice(0,8)}`);

    const term = new XTerm({
      fontFamily: '"Cascadia Mono", monospace',
      fontSize: 16,
      fontWeight: 400,
      fontWeightBold: 700,
      lineHeight: 1.0,
      letterSpacing: 0,
      theme: {
        background: '#1E2024',
        foreground: '#E8EAED',
        cursor: '#3B82F6',
        cursorAccent: '#1E2024',
        selectionBackground: 'rgba(59,130,246,0.30)',
        scrollbarSliderBackground: 'rgba(255,255,255,0.10)',
        scrollbarSliderHoverBackground: 'rgba(255,255,255,0.20)',
        scrollbarSliderActiveBackground: 'rgba(255,255,255,0.30)',
      },
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowTransparency: false,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    let ro = null;
    let fitFrame = null;
    let lastEmittedSize = null;
    const isDeviceMobile = () => document.body.classList.contains('mobile-device');
    const onWinResize = () => {
      scheduleFit();
    };
    const doResizeEmit = () => {
      const sock = getSocket();
      if (!activeStateRef.current || isDeviceMobile()) return;
      if (!term.cols || !term.rows || !sock.connected) return;

      const nextSize = `${term.cols}x${term.rows}`;
      if (lastEmittedSize === nextSize) return;
      lastEmittedSize = nextSize;
      sock.emit('terminal:resize', { sessionId, cols: term.cols, rows: term.rows });
    };
    const runFit = () => {
      fitFrame = null;
      if (!activeStateRef.current || cancelled || !divRef.current) return;
      try { fit.fit(); } catch (_) {}
      doResizeEmit();
    };
    const scheduleFit = () => {
      if (fitFrame || !activeStateRef.current) return;
      fitFrame = requestAnimationFrame(runFit);
    };
    const fitActive = () => {
      if (!activeStateRef.current) return;
      try { fit.fit(); } catch (_) {}
      doResizeEmit();
    };
    const getSize = () => {
      if (!activeStateRef.current) return null;
      return term.cols ? { cols: term.cols, rows: term.rows } : null;
    };
    const emitInput = data => {
      const sock = getSocket();
      if (sock.connected) {
        sock.emit('terminal:input', { sessionId, data });
      }
    };
    const emitResize = () => {
      doResizeEmit();
    };

    // open() is called inside fonts.ready so glyph widths are measured with
    // the correct font. If we call term.open() before fonts load (e.g. on a
    // hard refresh where fonts must be re-downloaded), xterm measures character
    // width using the fallback monospace font, which is narrower than Cascadia
    // Mono. FitAddon then calculates too many columns and text overflows the
    // container. Deferring until fonts.ready guarantees correct measurements.
    //
    // The tradeoff: the server can respond to terminal:join with scrollback
    // before open() runs. onScrollback stores that data in pendingScrollback
    // and we replay it immediately after open() below.
    const open = () => {
      if (cancelled || !divRef.current) return;

      term.open(divRef.current);

      term.onData(data => {
        emitInput(data);
      });

      // Register ref so live terminal:data events can write to the terminal.
      termRefs.current[sessionId] = {
        write:   d  => term.write(d),
        clear:   () => term.clear(),
        reset:   () => term.reset(),
        focus:   () => term.focus(),
        fit:     fitActive,
        getSize,
        emitResize,
      };

      // Apply any scrollback that arrived while fonts were still loading.
      const pending = pendingScrollback?.current?.[sessionId];
      if (pending !== undefined) {
        delete pendingScrollback.current[sessionId];
        term.reset();
        term.write(pending);
        onScrollbackApplied?.(sessionId);
      }

      // Double rAF: ensures the flex layout has fully settled before FitAddon
      // measures the container. A single rAF is not enough after a hard refresh
      // because the browser hasn't finished computing flex dimensions yet.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (cancelled || !divRef.current) return;
        fitActive();
        ro = new ResizeObserver(scheduleFit);
        ro.observe(divRef.current);
        const parent = divRef.current?.parentElement;
        if (parent) ro.observe(parent);
        window.addEventListener('resize', onWinResize);
      }));
    };

    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(open);
    } else {
      open();
    }

    return () => {
      cancelled = true;
      if (fitFrame) cancelAnimationFrame(fitFrame);
      console.log(`[xterm:${instanceId}] Disposing for session ${sessionId.slice(0,8)}`);
      ro?.disconnect();
      window.removeEventListener('resize', onWinResize);
      term.dispose();
      delete termRefs.current[sessionId];
      onTerminalDisposed?.(sessionId);
    };
  }, []);

  // Refit + focus when tab becomes active
  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ref = termRefs.current[sessionId];
      if (!ref) return;
      ref.fit();
      ref.emitResize?.();
      ref.focus();
    }));
  }, [active]);

  return (
    <div
      ref={divRef}
      className="terminal-instance"
      // visibility:hidden keeps layout dimensions intact.
      // display:none → FitAddon measures 0×0 → squished rendering when re-shown.
      style={{ visibility: active ? 'visible' : 'hidden' }}
    />
  );
}

/* ── Workspace settings panel ──────────────────── */
function WorkspacePanel({ projectId, project, csrfToken, addToast, onDelete }) {
  const [logs, setLogs] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [busy, setBusy] = useState(null);

  async function runAction(action) {
    setBusy(action);
    try {
      const r = await fetch(`/api/projects/${projectId}/lifecycle`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (!d.success) addToast(d.error || 'Action failed.', 'error');
      else addToast(`${action.charAt(0).toUpperCase() + action.slice(1)} complete.`);
    } catch (e) { addToast(e.message, 'error'); }
    finally { setBusy(null); }
  }

  async function loadLogs() {
    const r = await fetch(`/api/projects/${projectId}/logs`);
    const d = await r.json();
    setLogs(d.logs || 'No logs.');
  }

  const ACTIONS = [
    { id: 'start',    label: 'Start',             danger: false },
    { id: 'stop',     label: 'Stop',              danger: false },
    { id: 'restart',  label: 'Restart',           danger: false },
    { id: 'recreate', label: 'Recreate',          danger: true },
    { id: 'rebuild',  label: 'Rebuild',           danger: true },
    { id: 'reset',    label: 'Reset Environment', danger: true },
  ];

  return (
    <div className="panel-content">
      <div className="panel-section">
        <div className="panel-section-title">WORKSPACE STATUS</div>
        <div className={`ws-status-row status-${project?.status}`}>
          <span className="ws-status-dot" />
          <span className="ws-status-text">{project?.status || 'unknown'}</span>
        </div>
        <div className="panel-hint">Folder: <code>/projects/{project?.folderPath}</code></div>
      </div>

      <div className="panel-section">
        <div className="panel-section-title">WORKSPACE CONTROLS</div>
        <div className="ws-actions">
          {ACTIONS.map(a => (
            <button key={a.id}
              className={`btn btn-ghost${a.danger ? ' ws-danger' : ''}`}
              onClick={() => runAction(a.id)}
              disabled={!!busy}
            >
              {busy === a.id ? `${a.label}ing…` : a.label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">
        <div className="panel-section-header">
          <div className="panel-section-title">CONTAINER LOGS</div>
          <button className="btn btn-ghost" onClick={() => { setShowLogs(s => !s); if (!showLogs) loadLogs(); }}>
            {showLogs ? 'Hide' : 'Show'}
          </button>
        </div>
        {showLogs && <div className="panel-logs"><pre>{logs}</pre></div>}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">DANGER ZONE</div>
        <p className="panel-hint">
          Removes the workspace container and home volume.
          Project files on disk are <strong>not</strong> deleted.
        </p>
        <button className="btn btn-danger" onClick={onDelete}>
          Delete Project
        </button>
      </div>
    </div>
  );
}

function CdesktopPanel({ projectId, csrfToken, addToast }) {
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState('');
  const [busy, setBusy] = useState(null);
  const [autoStarted, setAutoStarted] = useState(false);
  const iframeUrl = `/workspaces/${projectId}/cdesktop/`;

  async function loadStatus() {
    const r = await fetch(`/api/projects/${projectId}/cdesktop/status`);
    const d = await r.json();
    setStatus(d);
    return d;
  }

  async function loadLogs() {
    try {
      const r = await fetch(`/api/projects/${projectId}/cdesktop/logs?tail=120`);
      const d = await r.json();
      setLogs(d.logs || '');
    } catch (_) {
      setLogs('');
    }
  }

  async function runAction(action) {
    setBusy(action);
    try {
      const r = await fetch(`/api/projects/${projectId}/cdesktop/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: '{}',
      });
      const d = await r.json();
      setStatus(d);
      if (!r.ok) {
        addToast(d.error || `cdesktop ${action} failed.`, 'error');
        await loadLogs();
      } else if (action === 'start' || action === 'restart') {
        setTimeout(loadStatus, 1500);
      }
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const d = await loadStatus();
        if (cancelled) return;
        if (!autoStarted && d.status === 'stopped') {
          setAutoStarted(true);
          await runAction('start');
        } else if (d.status === 'error') {
          await loadLogs();
        }
      } catch (err) {
        if (!cancelled) addToast(err.message, 'error');
      }
    }
    init();
    const t = setInterval(() => {
      if (!cancelled) loadStatus().catch(() => {});
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [projectId]);

  const state = status?.status || 'starting';
  const isRunning = state === 'running';
  const isBusy = !!busy || state === 'installing' || state === 'starting';
  const showSetup = !isRunning;

  return (
    <div className="cdesktop-panel">
      <div className="cdesktop-toolbar">
        <div className={`ws-status-row status-${state}`}>
          <span className="ws-status-dot" />
          <span className="ws-status-text">cdesktop {state.replace('_', ' ')}</span>
          {status?.version && <span className="cdesktop-version">v{status.version}</span>}
        </div>
        <div className="cdesktop-actions">
          <button className="btn btn-ghost" onClick={() => runAction('install')} disabled={isBusy}>
            {busy === 'install' ? 'Installing...' : 'Install'}
          </button>
          <button className="btn btn-primary" onClick={() => runAction('start')} disabled={isBusy || isRunning}>
            {busy === 'start' ? 'Starting...' : 'Start'}
          </button>
          <button className="btn btn-ghost" onClick={() => runAction('restart')} disabled={isBusy}>
            Restart
          </button>
          <button className="btn btn-ghost" onClick={() => runAction('stop')} disabled={isBusy || !isRunning}>
            Stop
          </button>
          <button className="btn btn-ghost" onClick={() => window.open(iframeUrl, '_blank', 'noopener,noreferrer')}>
            Open
          </button>
        </div>
      </div>

      {showSetup && (
        <div className="cdesktop-setup">
          <div className="panel-section">
            <div className="panel-section-title">Status</div>
            <p className="panel-hint">
              {status?.error || status?.message || 'Install cdesktop or start the workspace service.'}
            </p>
            {status?.nodeVersion && (
              <p className="panel-hint">Node: <code>{status.nodeVersion}</code></p>
            )}
            <button className="btn btn-ghost" onClick={loadLogs}>Refresh Logs</button>
          </div>
          {(logs || status?.error) && (
            <div className="panel-logs cdesktop-logs">
              <pre>{logs || status?.error}</pre>
            </div>
          )}
        </div>
      )}

      {isRunning && (
        <iframe
          className="cdesktop-frame"
          src={iframeUrl}
          title="cdesktop"
          allow="clipboard-read; clipboard-write"
        />
      )}
    </div>
  );
}

/* ── Git panel ─────────────────────────────────── */
function GitPanel({ projectId, csrfToken, addToast }) {
  const [status, setStatus] = useState(null);
  const [staged, setStaged] = useState(new Set());
  const [msg, setMsg] = useState('');
  const [diff, setDiff] = useState('');
  const [snapshots, setSnaps] = useState([]);

  useEffect(() => { loadStatus(); loadSnaps(); const t = setInterval(loadStatus, 3000); return () => clearInterval(t); }, [projectId]);

  async function loadStatus() {
    try { const r = await fetch(`/api/projects/${projectId}/git/status`); setStatus(await r.json()); } catch (_) {}
  }
  async function loadSnaps() {
    try { const r = await fetch(`/api/projects/${projectId}/git/snapshots`); const d = await r.json(); setSnaps(d.snapshots || []); } catch (_) {}
  }
  async function loadDiff(path) {
    const r = await fetch(`/api/projects/${projectId}/git/diff?path=${encodeURIComponent(path)}`);
    const d = await r.json(); setDiff(d.diff || '');
  }
  async function stage(path, doStage) {
    await fetch(`/api/projects/${projectId}/git/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ files: [path], unstage: !doStage }) });
    setStaged(prev => { const n = new Set(prev); doStage ? n.add(path) : n.delete(path); return n; });
  }
  async function commit() {
    if (!msg.trim()) { addToast('Commit message required.', 'error'); return; }
    const r = await fetch(`/api/projects/${projectId}/git/commit`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ message: msg }) });
    const d = await r.json();
    if (d.success) { addToast('Committed.'); setMsg(''); setStaged(new Set()); loadStatus(); }
    else addToast(d.error || 'Commit failed.', 'error');
  }
  async function snapshot() {
    const label = prompt('Snapshot label (optional):');
    if (label === null) return;
    const r = await fetch(`/api/projects/${projectId}/git/snapshot`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ label }) });
    const d = await r.json();
    if (d.success) { addToast(`Snapshot: ${d.tag}`); loadSnaps(); }
    else addToast(d.error, 'error');
  }
  async function restore(tag) {
    if (!confirm(`Restore to ${tag}? Uncommitted changes will be overwritten.`)) return;
    const r = await fetch(`/api/projects/${projectId}/git/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: JSON.stringify({ tag }) });
    const d = await r.json();
    if (d.success) { addToast(`Restored to ${tag}`); loadStatus(); } else addToast(d.error, 'error');
  }

  if (!status) return <div className="panel-content"><p className="panel-loading">Loading…</p></div>;
  if (!status.initialized) return <div className="panel-content"><p className="panel-hint">Git not initialized. Run <code>git init</code> in the terminal.</p></div>;

  const unstaged = (status.files || []).filter(f => !staged.has(f.path));
  const stagedFiles = (status.files || []).filter(f => staged.has(f.path));

  return (
    <div className="panel-content">
      <div className="panel-section">
        <div className="panel-section-header">
          <div className="panel-section-title">⎇ {status.branch}</div>
          <div style={{ display:'flex', gap: 4 }}>
            <button className="btn btn-ghost" style={{fontSize:'var(--font-size-xs)'}} onClick={snapshot}>Snapshot</button>
          </div>
        </div>
        {status.clean ? <p className="panel-hint">Working tree clean.</p> : (
          <>
            {unstaged.length > 0 && (
              <div className="git-file-list">
                <div className="git-list-label">Unstaged</div>
                {unstaged.map(f => (
                  <div key={f.path} className="git-file-row" onClick={() => loadDiff(f.path)}>
                    <input type="checkbox" checked={false} onChange={() => stage(f.path, true)} onClick={e => e.stopPropagation()} />
                    <span className={`git-badge badge-${f.status}`}>{f.status}</span>
                    <span className="git-file-name">{f.path}</span>
                  </div>
                ))}
              </div>
            )}
            {stagedFiles.length > 0 && (
              <div className="git-file-list">
                <div className="git-list-label">Staged</div>
                {stagedFiles.map(f => (
                  <div key={f.path} className="git-file-row staged" onClick={() => loadDiff(f.path)}>
                    <input type="checkbox" checked onChange={() => stage(f.path, false)} onClick={e => e.stopPropagation()} />
                    <span className={`git-badge badge-${f.status}`}>{f.status}</span>
                    <span className="git-file-name">{f.path}</span>
                  </div>
                ))}
                <div className="git-commit-area">
                  <textarea className="git-commit-input" placeholder="Commit message…" value={msg} onChange={e => setMsg(e.target.value)} />
                  <button className="btn btn-primary" onClick={commit}>Commit</button>
                </div>
              </div>
            )}
            {diff && (
              <div className="git-diff">
                {diff.split('\n').map((line, i) => (
                  <div key={i} className={`diff-line${line.startsWith('+') && !line.startsWith('+++') ? ' added' : line.startsWith('-') && !line.startsWith('---') ? ' removed' : line.startsWith('@@') ? ' hunk' : ''}`}>
                    <code>{line || ' '}</code>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div className="panel-section">
        <div className="panel-section-title">SNAPSHOTS</div>
        {snapshots.length === 0 ? <p className="panel-hint">No snapshots. Create one before an AI session.</p> : snapshots.map(s => (
          <div key={s.tag} className="snapshot-row">
            <div>
              <div className="snapshot-tag">{s.tag}</div>
              {s.label && <div className="snapshot-label">{s.label}</div>}
            </div>
            <button className="btn btn-ghost" style={{fontSize:'var(--font-size-xs)'}} onClick={() => restore(s.tag)}>Restore</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Cockpit ───────────────────────────────────── */
export default function ProjectCockpit() {
  const { id: projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { csrfToken } = useAuth();
  const { addToast } = useToast();

  const [project, setProject]     = useState(null);
  const [tree, setTree]           = useState([]);
  const [termTabs, setTermTabs]   = useState([]);
  const [fileTabs, setFileTabs]   = useState([]);
  const [fileContent, setFileContent] = useState({});
  const [dirtyFiles, setDirty]    = useState({});
  const [activeTab, setActiveTab] = useState(null); // 'term-{id}' | 'file-{path}' | 'settings' | 'git' | 'cdesktop'
  const [reconnecting, setRecon]  = useState(false);
  const [reconSecs, setReconSecs] = useState(0);
  const [deleting, setDeleting]   = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [fileContextMenu, setFileContextMenu] = useState(null); // { node, x, y }
  const [renameDialog, setRenameDialog] = useState(null); // { node, value }
  const renameInputRef = useRef(null);

  const termRefs         = useRef({});
  const activeRef        = useRef(null);
  // Track which sessions this socket client has already joined (and received scrollback for).
  // Cleared on socket reconnect because the server treats it as a brand-new client.
  const joinedSessions   = useRef(new Set());
  // Guard: scrollback can only be written once per xterm instance.
  // Cleared alongside joinedSessions so a reconnect gets a fresh replay.
  const historyReplayed  = useRef(new Set());
  // Scrollback that arrived before TerminalInstance finished opening (fonts still loading).
  // TerminalInstance reads and clears this once term.open() completes.
  const pendingScrollback = useRef({});
  // Tracks the current projectId so async callbacks can detect stale results.
  const currentProjectId = useRef(projectId);

  // Mobile tab context
  const { mobileTab, setMobileTab } = useMobileUI();
  const { isMobile } = useDevice();
  const prevMobileTab = useRef(null);
  const activeTabStateRef = useRef(null);

  useEffect(() => {
    activeTabStateRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (!renameDialog) return;
    requestAnimationFrame(() => renameInputRef.current?.select());
  }, [renameDialog?.node.path]);

  useEffect(() => {
    if (!fileContextMenu) return;
    function closeMenu() { setFileContextMenu(null); }
    function closeOnEscape(e) {
      if (e.key === 'Escape') closeMenu();
    }
    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [!!fileContextMenu]);

  // Handle ?tab= from context menu (desktop right-click)
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'settings') { setActiveTab('settings'); activeRef.current = 'settings'; setSearchParams({}); }
    else if (tab === 'git') { setActiveTab('git'); activeRef.current = 'git'; setSearchParams({}); }
    else if (tab === 'cdesktop') { setActiveTab('cdesktop'); activeRef.current = 'cdesktop'; setSearchParams({}); }
  }, [searchParams]);

  // Sync mobile tab → cockpit activeTab (only on mobile devices)
  useEffect(() => {
    if (prevMobileTab.current === mobileTab) return;
    prevMobileTab.current = mobileTab;
    if (!isMobile) return;
    if (mobileTab === 'terminal') {
      const first = termTabs[0];
      if (first) activateTerm(first.id);
    } else if (mobileTab === 'git') {
      setActiveTab('git');
      activeRef.current = 'git';
    } else if (mobileTab === 'cdesktop') {
      setActiveTab('cdesktop');
      activeRef.current = 'cdesktop';
    } else if (mobileTab === 'settings') {
      setActiveTab('settings');
      activeRef.current = 'settings';
    }
    // 'files' view is CSS-driven via data-mobile-tab attribute
  }, [mobileTab, termTabs]);

  useEffect(() => {
    currentProjectId.current = projectId;
    activeRef.current = null;
    termRefs.current = {};
    pendingScrollback.current = {};
    joinedSessions.current.clear();
    historyReplayed.current.clear();
    setActiveTab(null);
    setTermTabs([]);
    setFileTabs([]);
    setFileContent({});
    setDirty({});
    loadProject(); loadTree(); loadSessions();
    const t1 = setInterval(() => {
      if (!activeTabStateRef.current?.startsWith('term-')) loadProject();
    }, 5000);
    const t2 = setInterval(() => {
      if (!activeTabStateRef.current?.startsWith('term-')) loadTree();
    }, 2000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [projectId]);

  useEffect(() => {
    const sock = getSocket();

    function onConnect() {
      setRecon(false);
      // New socket connection → server has no record of us. Clear client-side join
      // tracking so activateTerm will re-emit terminal:join (with scrollback).
      joinedSessions.current.clear();
      historyReplayed.current.clear();
      console.log('[socket] Connected/reconnected — cleared join & history state');

      // Re-join active session with scrollback (server sees this as a new client)
      if (activeRef.current?.startsWith('term-')) {
        const sid = activeRef.current.slice(5);
        console.log(`[socket] Re-joining session ${sid.slice(0,8)} after reconnect`);
        sock.emit('terminal:join', { sessionId: sid });
        joinedSessions.current.add(sid);
        // historyReplayed stays clear so onScrollback will accept the replay
      }
    }

    function onDisconnect() {
      setRecon(true);
      setReconSecs(0);
      console.log('[socket] Disconnected');
    }

    function onData({ sessionId, data }) {
      termRefs.current[sessionId]?.write(data);
    }

    function onScrollback({ sessionId, data }) {
      if (historyReplayed.current.has(sessionId)) {
        console.log(`[terminal] SKIPPED duplicate scrollback for session ${sessionId.slice(0,8)}`);
        return;
      }
      const bytes = typeof data === 'string' ? data.length : 0;
      console.log(`[terminal] Replaying ${bytes} bytes history for session ${sessionId.slice(0,8)}`);
      const ref = termRefs.current[sessionId];
      if (ref) {
        // Terminal already open — apply immediately.
        // reset() wipes the scrollback buffer before replaying; clear() only
        // scrolls content up into the buffer, causing duplicate output on scroll.
        historyReplayed.current.add(sessionId);
        ref.reset();
        ref.write(data);
      } else {
        // Terminal not open yet (fonts still loading or first render not committed).
        // Store for TerminalInstance to pick up once term.open() completes.
        // Do not mark this replayed yet: fast project switching can unmount the
        // terminal before the pending data is written.
        pendingScrollback.current[sessionId] = data;
      }
    }

    function onExit({ sessionId }) {
      joinedSessions.current.delete(sessionId);
      historyReplayed.current.delete(sessionId);
      setTermTabs(p => p.filter(t => t.id !== sessionId));
    }

    function onAi({ sessionId, state }) {
      setTermTabs(p => p.map(t => t.id === sessionId ? { ...t, aiState: state } : t));
    }

    console.log(`[socket] Attaching listeners for project ${projectId}`);
    sock.on('connect',           onConnect);
    sock.on('disconnect',        onDisconnect);
    sock.on('terminal:data',     onData);
    sock.on('terminal:scrollback', onScrollback);
    sock.on('terminal:exit',     onExit);
    sock.on('terminal:ai-state', onAi);

    return () => {
      console.log(`[socket] Removing listeners for project ${projectId}`);
      sock.off('connect',           onConnect);
      sock.off('disconnect',        onDisconnect);
      sock.off('terminal:data',     onData);
      sock.off('terminal:scrollback', onScrollback);
      sock.off('terminal:exit',     onExit);
      sock.off('terminal:ai-state', onAi);
    };
  }, [projectId]);

  useEffect(() => { if (!reconnecting) return; const t = setInterval(() => setReconSecs(n=>n+1), 1000); return () => clearInterval(t); }, [reconnecting]);

  async function loadProject() { try { const r = await fetch(`/api/projects/${projectId}`); if (r.ok) setProject(await r.json()); } catch (_) {} }
  async function loadTree() { try { const r = await fetch(`/api/projects/${projectId}/files`); const d = await r.json(); setTree(d.tree || []); } catch (_) {} }

  async function loadSessions() {
    const pid = projectId;
    try {
      const r = await fetch(`/api/projects/${pid}/terminals`);
      const d = await r.json();
      // Discard if the user navigated away while this fetch was in flight
      if (currentProjectId.current !== pid) return;
      const sessions = d.sessions || [];
      setTermTabs(sessions.map(s => ({ id: s.id, name: s.name, aiState: s.aiState || 'none' })));
      if (sessions.length > 0) activateTerm(sessions[0].id);
      else createTerminal(pid);
    } catch (_) {}
  }

  function markScrollbackApplied(sessionId) {
    historyReplayed.current.add(sessionId);
  }

  function handleTerminalDisposed(sessionId) {
    joinedSessions.current.delete(sessionId);
    historyReplayed.current.delete(sessionId);
  }

  function activateTerm(sessionId) {
    const tabId = `term-${sessionId}`;
    activeRef.current = tabId;
    setActiveTab(tabId);
    const sock = getSocket();

    function doFitFocus() {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const ref = termRefs.current[sessionId];
        if (!ref) return;
        ref.fit();
        const s = ref.getSize();
        if (s && sock.connected) sock.emit('terminal:resize', { sessionId, ...s });
        ref.focus();
      }));
    }

    function doJoin() {
      const alreadyJoined = joinedSessions.current.has(sessionId);

      if (!alreadyJoined) {
        // First time joining this session — server will send scrollback
        joinedSessions.current.add(sessionId);
        console.log(`[terminal] terminal:join session ${sessionId.slice(0,8)} (will receive scrollback)`);
        sock.emit('terminal:join', { sessionId });
      } else {
        // Already joined this session in this browser session — reattach to live
        // output stream but do NOT replay scrollback (xterm already has the content)
        console.log(`[terminal] terminal:reattach session ${sessionId.slice(0,8)} (no scrollback)`);
        sock.emit('terminal:reattach', { sessionId });
      }
      doFitFocus();
    }

    // Queue until connected if socket isn't ready yet.
    // Do NOT use sock.once('connect', doJoin) in addition to the general onConnect
    // handler — that would cause double joins. Instead, rely solely on the onConnect
    // handler for reconnection, and call doJoin directly when already connected.
    if (sock.connected) {
      doJoin();
    } else {
      // Socket not yet connected on first load. onConnect will fire and call
      // activateTerm for the active session, but we also register once here
      // so the FIRST connection is handled even if activeRef hasn't propagated.
      sock.once('connect', doJoin);
    }
  }

  async function createTerminal(pid = projectId) {
    try {
      const r = await fetch(`/api/projects/${pid}/terminals`, { method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}, body:'{}' });
      const d = await r.json();
      if (currentProjectId.current !== pid) return;
      if (d.sessionId) {
        setTermTabs(p => [...p, { id: d.sessionId, name: d.name, aiState: 'none' }]);
        setTimeout(() => {
          if (currentProjectId.current === pid) activateTerm(d.sessionId);
        }, 50);
      }
      else addToast(d.error || 'Failed.', 'error');
    } catch (e) { addToast(e.message, 'error'); }
  }

  async function openFile(node) {
    const ext = node.name.split('.').pop()?.toLowerCase();
    const images = ['png','jpg','jpeg','gif','svg','webp'];
    if (images.includes(ext)) {
      if (!fileTabs.find(t => t.path === node.path)) setFileTabs(p => [...p, { path: node.path, name: node.name, type: 'image' }]);
      setActiveTab(`file-${node.path}`); activeRef.current = `file-${node.path}`; return;
    }
    if (!fileTabs.find(t => t.path === node.path)) {
      try {
        const r = await fetch(`/api/projects/${projectId}/files/read?path=${encodeURIComponent(node.path)}`);
        const d = await r.json();
        if (d.content !== undefined) {
          setFileContent(p => ({ ...p, [node.path]: d.content }));
          setFileTabs(p => [...p, { path: node.path, name: node.name, type: 'text' }]);
        }
      } catch { addToast('Could not open file.', 'error'); return; }
    }
    setActiveTab(`file-${node.path}`); activeRef.current = `file-${node.path}`;
    if (isMobile) setMobileTab('terminal');
  }

  async function saveFile(path) {
    const r = await fetch(`/api/projects/${projectId}/files/write`, { method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}, body: JSON.stringify({ filePath: path, content: fileContent[path] || '' }) });
    if ((await r.json()).success) setDirty(p => ({ ...p, [path]: false })); else addToast('Save failed.', 'error');
  }

  function openFileContextMenu(node, x, y) {
    setRenameDialog(null);
    setFileContextMenu({ node, x, y });
  }

  function openRenameDialog(node) {
    setFileContextMenu(null);
    setRenameDialog({ node, value: node.name });
  }

  async function createInNode(node, type) {
    const name = prompt(type === 'dir' ? 'Folder name:' : 'File name:');
    if (!name) return;
    const filePath = node.type === 'dir' ? `${node.path}/${name}` : name;
    const r = await fetch(`/api/projects/${projectId}/files/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ filePath, type }),
    });
    if ((await r.json()).success) loadTree();
    else addToast('Create failed.', 'error');
  }

  async function removeFileNode(node) {
    if (!confirm(`Delete "${node.name}"?`)) return;
    const r = await fetch(`/api/projects/${projectId}/files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ path: node.path }),
    });
    if ((await r.json()).success) loadTree();
    else addToast('Delete failed.', 'error');
  }

  async function referenceFileNode(node) {
    try {
      const res = await fetch(`/api/projects/${projectId}/terminals`);
      const data = await res.json();
      const sessions = data.sessions || [];
      if (!sessions.length) { addToast('No terminal sessions open — open a terminal first.', 'error'); return; }
      getSocket().emit('terminal:input', { sessionId: sessions[0].id, data: node.path });
    } catch { addToast('Could not send path to terminal.', 'error'); }
  }

  async function handleFileContextAction(action) {
    const node = fileContextMenu?.node;
    setFileContextMenu(null);
    if (!node) return;

    if (action === 'new-file') await createInNode(node, 'file');
    else if (action === 'new-folder') await createInNode(node, 'dir');
    else if (action === 'rename') openRenameDialog(node);
    else if (action === 'reference') await referenceFileNode(node);
    else if (action === 'copy-path') {
      try { await navigator.clipboard.writeText(node.path); }
      catch { addToast('Could not copy path.', 'error'); }
    } else if (action === 'download') {
      window.open(`/api/projects/${projectId}/files/download?path=${encodeURIComponent(node.path)}`);
    } else if (action === 'delete') {
      await removeFileNode(node);
    }
  }

  async function submitRenameDialog() {
    const node = renameDialog?.node;
    const newName = renameDialog?.value.trim();
    setRenameDialog(null);
    if (!node || !newName || newName === node.name) return;

    const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
    const newPath = parentPath ? `${parentPath}/${newName}` : newName;
    const r = await fetch(`/api/projects/${projectId}/files/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ oldPath: node.path, newPath }),
    });
    if ((await r.json()).success) loadTree();
    else addToast('Rename failed.', 'error');
  }

  function closeFile(path) {
    setFileTabs(p => p.filter(t => t.path !== path));
    if (activeTab === `file-${path}`) { const first = termTabs[0]; if (first) activateTerm(first.id); else setActiveTab(null); }
  }

  async function killTerminal(sessionId) {
    await fetch(`/api/projects/${projectId}/terminals/${sessionId}`, { method:'DELETE', headers:{'X-CSRF-Token':csrfToken} });
    setTermTabs(p => p.filter(t => t.id !== sessionId));
    if (activeTab === `term-${sessionId}`) { const other = termTabs.find(t => t.id !== sessionId); if (other) activateTerm(other.id); else setActiveTab(null); }
  }

  async function deleteProject() {
    setDeleting(true);
    try { const r = await fetch(`/api/projects/${projectId}`, { method:'DELETE', headers:{'X-CSRF-Token':csrfToken} }); if (r.ok) navigate('/'); else addToast('Delete failed.','error'); }
    catch { addToast('Delete failed.','error'); }
    finally { setDeleting(false); setShowDelete(false); }
  }

  const activeFileTab = fileTabs.find(t => `file-${t.path}` === activeTab);
  const showOverlay = activeFileTab || activeTab === 'settings' || activeTab === 'git' || activeTab === 'cdesktop';
  // On mobile, show the active terminal session in the log viewer
  const activeTermId = termTabs.find(t => activeTab === `term-${t.id}`)?.id ?? termTabs[0]?.id ?? null;

  return (
    <div className="cockpit" data-mobile-tab={mobileTab}>
      {/* File tree — collapsible */}
      <div className={`cockpit-filetree${treeCollapsed ? ' collapsed' : ''}`}>
        <div className="filetree-header">
          {!treeCollapsed && <span className="filetree-title">FILES</span>}
          <div className="filetree-actions">
            {!treeCollapsed && <>
              <button className="ft-btn" title="New file" onClick={async () => { const n = prompt('File name:'); if (!n) return; await fetch(`/api/projects/${projectId}/files/create`, { method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}, body: JSON.stringify({ filePath: n, type:'file' }) }); loadTree(); }}>+F</button>
              <button className="ft-btn" title="New folder" onClick={async () => { const n = prompt('Folder name:'); if (!n) return; await fetch(`/api/projects/${projectId}/files/create`, { method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}, body: JSON.stringify({ filePath: n, type:'dir' }) }); loadTree(); }}>+D</button>
            </>}
            <button className="ft-btn ft-collapse-btn" title={treeCollapsed ? 'Expand files' : 'Collapse files'} onClick={() => setTreeCollapsed(c => !c)}>
              {treeCollapsed ? '›' : '‹'}
            </button>
          </div>
        </div>
        <div className="filetree-scroll">
          {tree.length === 0 && <p className="filetree-empty">Empty project</p>}
          {tree.map(n => (
            <FileNode
              key={n.path}
              node={n}
              depth={0}
              onOpenFile={openFile}
              activeFilePath={activeFileTab?.path}
              onOpenContextMenu={openFileContextMenu}
              onOpenRenameDialog={openRenameDialog}
            />
          ))}
        </div>
        <div className="cockpit-project-footer">
          {project && <ProjectAvatar project={project} size={22} />}
          <span className="cockpit-project-name">{project?.name}</span>
          <button className="cockpit-delete-btn" onClick={() => setShowDelete(true)} title="Delete project">🗑</button>
        </div>
      </div>

      {/* Main */}
      <div className="cockpit-main">
        {/* Tab bar */}
        <div className="cockpit-tabs" role="tablist">
          {/* Terminal tabs */}
          {termTabs.map(t => (
            <div key={t.id} className={`cockpit-tab${activeTab === `term-${t.id}` ? ' active' : ''}${t.aiState === 'waiting' ? ' ai-waiting' : t.aiState === 'active' ? ' ai-active' : ''}`}
              role="tab" onClick={() => activateTerm(t.id)}>
              <span className="tab-icon">⌨</span>
              <span className="tab-label">{t.name}</span>
              {t.aiState === 'waiting' && <span className="tab-ai-badge badge-ai" style={{fontSize:9,height:14,padding:'0 4px'}}>!</span>}
              <button className="tab-close" onClick={e => { e.stopPropagation(); killTerminal(t.id); }}>×</button>
            </div>
          ))}
          <button className="cockpit-new-term" onClick={createTerminal}>+ Terminal</button>

          {/* File tabs */}
          {fileTabs.length > 0 && <div className="tab-divider" />}
          {fileTabs.map(t => (
            <div key={t.path} className={`cockpit-tab file-tab${activeTab === `file-${t.path}` ? ' active' : ''}`}
              role="tab" onClick={() => { setActiveTab(`file-${t.path}`); activeRef.current = `file-${t.path}`; }}>
              <span className="tab-icon">📄</span>
              <span className="tab-label">{t.name}{dirtyFiles[t.path] ? ' ·' : ''}</span>
              <button className="tab-close" onClick={e => { e.stopPropagation(); closeFile(t.path); }}>×</button>
            </div>
          ))}

          {/* Panel tabs (right-aligned) */}
          <div className="tabs-spacer" />
          <button className={`cockpit-panel-tab${activeTab === 'cdesktop' ? ' active' : ''}`} onClick={() => { setActiveTab('cdesktop'); activeRef.current = 'cdesktop'; }}>cdesktop</button>
          <button className={`cockpit-panel-tab${activeTab === 'git' ? ' active' : ''}`} onClick={() => { setActiveTab('git'); activeRef.current = 'git'; }}>Git</button>
          <button className={`cockpit-panel-tab${activeTab === 'settings' ? ' active' : ''}`} onClick={() => { setActiveTab('settings'); activeRef.current = 'settings'; }}>Workspace</button>
        </div>

        {/* Content */}
        <div className="cockpit-content">
          {/*
            Terminals layer is ALWAYS rendered and takes full space.
            Files/panels overlay on top using position:absolute.
            This keeps terminal dims stable so FitAddon never measures 0×0.
          */}
          <div className="terminals-layer">
            {isMobile ? (
              /* Mobile: read-only log viewer — never mounts xterm, never resizes PTY */
              activeTermId ? (
                <MobileTerminalView key={activeTermId} sessionId={activeTermId} />
              ) : (
                <div className="cockpit-empty">
                  <button className="btn btn-primary" onClick={createTerminal}>Open Terminal</button>
                </div>
              )
            ) : (
              /* Desktop: full interactive xterm — owns PTY resize */
              <>
                {termTabs.map(t => (
                  <TerminalInstance
                    key={t.id}
                    sessionId={t.id}
                    active={activeTab === `term-${t.id}`}
                    termRefs={termRefs}
                    pendingScrollback={pendingScrollback}
                    onScrollbackApplied={markScrollbackApplied}
                    onTerminalDisposed={handleTerminalDisposed}
                  />
                ))}
                {termTabs.length === 0 && !showOverlay && (
                  <div className="cockpit-empty">
                    <button className="btn btn-primary" onClick={createTerminal}>Open Terminal</button>
                  </div>
                )}
              </>
            )}
            {reconnecting && (
              <div className="terminal-reconnect-overlay">
                {reconSecs > 5 ? `Connection lost. Retrying… ${reconSecs}s` : 'Reconnecting…'}
              </div>
            )}
          </div>

          {/* Overlay: file editor, image viewer, or panel — sits on top of terminals */}
          {showOverlay && (
            <div className="content-overlay">
              {/* File editor */}
              {activeFileTab?.type === 'text' && (
                <div className="file-editor" onKeyDown={e => { if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); saveFile(activeFileTab.path); } }}>
                  <div className="file-editor-toolbar">
                    <button className="btn btn-ghost" onClick={() => { const t = termTabs[0]; if (t) activateTerm(t.id); else setActiveTab(null); if (isMobile) setMobileTab('files'); }}>← Files</button>
                    <span className="file-editor-name">{activeFileTab.name}</span>
                    <button className="btn btn-primary" onClick={() => saveFile(activeFileTab.path)}>Save</button>
                  </div>
                  <SyntaxHighlightedEditor
                    fileName={activeFileTab.name}
                    spellCheck={false}
                    value={fileContent[activeFileTab.path] || ''}
                    onChange={e => { setFileContent(p=>({...p,[activeFileTab.path]:e.target.value})); setDirty(p=>({...p,[activeFileTab.path]:true})); }} />
                </div>
              )}

              {/* Image viewer */}
              {activeFileTab?.type === 'image' && (
                <div className="file-editor">
                  <div className="file-editor-toolbar">
                    <button className="btn btn-ghost" onClick={() => { const t = termTabs[0]; if (t) activateTerm(t.id); if (isMobile) setMobileTab('files'); }}>← Files</button>
                    <span className="file-editor-name">{activeFileTab.name}</span>
                  </div>
                  <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:'var(--color-surface-elevated)', overflow:'auto', padding:'var(--spacing-lg)' }}>
                    <img src={`/api/projects/${projectId}/files/read?path=${encodeURIComponent(activeFileTab.path)}`} alt={activeFileTab.name} style={{ maxWidth:'100%', maxHeight:'100%', objectFit:'contain' }} />
                  </div>
                </div>
              )}

              {/* Workspace settings panel */}
              {activeTab === 'settings' && (
                <div className="side-panel">
                  <div className="side-panel-header">WORKSPACE</div>
                  <WorkspacePanel projectId={projectId} project={project} csrfToken={csrfToken} addToast={addToast} onDelete={() => setShowDelete(true)} />
                </div>
              )}

              {/* cdesktop panel */}
              {activeTab === 'cdesktop' && (
                <div className="side-panel">
                  <div className="side-panel-header">CDESKTOP</div>
                  <CdesktopPanel projectId={projectId} csrfToken={csrfToken} addToast={addToast} />
                </div>
              )}

              {/* Git panel */}
              {activeTab === 'git' && <GitPage />}
            </div>
          )}
        </div>
      </div>

      {fileContextMenu && (
        <div
          className="context-menu"
          style={{ top: fileContextMenu.y, left: fileContextMenu.x }}
          role="menu"
          onClick={e => e.stopPropagation()}
          onContextMenu={e => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {fileContextMenu.node.type === 'dir' && <button role="menuitem" onClick={() => handleFileContextAction('new-file')}>New File</button>}
          {fileContextMenu.node.type === 'dir' && <button role="menuitem" onClick={() => handleFileContextAction('new-folder')}>New Folder</button>}
          <button role="menuitem" onClick={() => handleFileContextAction('rename')}>Rename</button>
          <button role="menuitem" onClick={() => handleFileContextAction('reference')}>Reference</button>
          <button role="menuitem" onClick={() => handleFileContextAction('copy-path')}>Copy Path</button>
          {fileContextMenu.node.type !== 'dir' && <button role="menuitem" onClick={() => handleFileContextAction('download')}>Download</button>}
          <div className="context-separator" />
          <button role="menuitem" className="context-danger" onClick={() => handleFileContextAction('delete')}>Delete</button>
        </div>
      )}

      {renameDialog && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setRenameDialog(null)}>
          <form
            className="modal rename-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-modal-title"
            onSubmit={e => {
              e.preventDefault();
              submitRenameDialog();
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setRenameDialog(null);
              }
            }}
          >
            <div className="modal-header">
              <h2 className="modal-title" id="rename-modal-title">Rename</h2>
            </div>
            <div className="modal-body">
              <label className="rename-modal-label" htmlFor="rename-file-input">Name</label>
              <input
                id="rename-file-input"
                ref={renameInputRef}
                className="rename-modal-input"
                value={renameDialog.value}
                onChange={e => setRenameDialog(d => d ? { ...d, value: e.target.value } : d)}
              />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setRenameDialog(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Rename</button>
            </div>
          </form>
        </div>
      )}

      {/* Delete modal */}
      {showDelete && (
        <div className="modal-backdrop" onClick={e => !deleting && e.target === e.currentTarget && setShowDelete(false)}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-header"><h2 className="modal-title">Delete project?</h2></div>
            <div className="modal-body">
              <p style={{ fontSize:'var(--font-size-sm)', color:'var(--color-text-secondary)', lineHeight:'var(--leading-normal)' }}>
                Removes the workspace container and home volume.<br/>
                <strong>Project files on disk are not deleted.</strong>
              </p>
              {deleting && <div className="delete-loading"><span className="delete-spinner" />Removing workspace…</div>}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowDelete(false)} disabled={deleting}>Cancel</button>
              <button className="btn btn-danger" onClick={deleteProject} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete Project'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
