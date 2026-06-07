import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ProjectAvatar } from '../components/ProjectsSidebar';
import '@xterm/xterm/css/xterm.css';
import './ProjectCockpit.css';

let socket = null;
function getSocket() {
  if (!socket) socket = io({ autoConnect: true, reconnection: true, reconnectionDelay: 1000 });
  return socket;
}

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

function FileNode({ node, depth, projectId, csrfToken, onOpenFile, activeFilePath, onRefresh }) {
  const [open, setOpen] = useState(depth < 1);
  const [menu, setMenu] = useState(null);
  const { addToast } = useToast();
  const isDir = node.type === 'dir';
  const isActive = activeFilePath === node.path;

  async function create(type) {
    setMenu(null);
    const name = prompt(type === 'dir' ? 'Folder name:' : 'File name:');
    if (!name) return;
    const filePath = isDir ? `${node.path}/${name}` : name;
    const r = await fetch(`/api/projects/${projectId}/files/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ filePath, type }),
    });
    if ((await r.json()).success) onRefresh(); else addToast('Create failed.', 'error');
  }

  async function remove() {
    setMenu(null);
    if (!confirm(`Delete "${node.name}"?`)) return;
    const r = await fetch(`/api/projects/${projectId}/files`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ path: node.path }),
    });
    if ((await r.json()).success) onRefresh(); else addToast('Delete failed.', 'error');
  }

  return (
    <div className="file-node-wrap">
      <div
        className={`file-node${isActive ? ' active' : ''}`}
        style={{ paddingLeft: depth * 16 + 6 }}
        onClick={() => isDir ? setOpen(o => !o) : onOpenFile(node)}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }); }}
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
              projectId={projectId} csrfToken={csrfToken}
              onOpenFile={onOpenFile} activeFilePath={activeFilePath} onRefresh={onRefresh} />
          ))}
        </div>
      )}

      {menu && (
        <>
          <div className="context-backdrop" onClick={() => setMenu(null)} />
          <div className="context-menu" style={{ top: menu.y, left: menu.x }} role="menu">
            {isDir && <button role="menuitem" onClick={() => create('file')}>New File</button>}
            {isDir && <button role="menuitem" onClick={() => create('dir')}>New Folder</button>}
            <button role="menuitem" onClick={() => { setMenu(null); navigator.clipboard.writeText(node.path); }}>Copy Path</button>
            <div className="context-separator" />
            <button role="menuitem" className="context-danger" onClick={remove}>Delete</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Terminal instance ─────────────────────────── */
let _xtermInstanceCounter = 0;

function TerminalInstance({ sessionId, active, termRefs }) {
  const divRef = useRef(null);

  useEffect(() => {
    if (!divRef.current || termRefs.current[sessionId]) return;
    const instanceId = ++_xtermInstanceCounter;
    console.log(`[xterm:${instanceId}] Opening for session ${sessionId.slice(0,8)}`);

    const term = new XTerm({
      // Font — Cascadia Mono matches Windows Terminal exactly
      fontFamily: '"Cascadia Mono", monospace',
      fontSize: 16,
      fontWeight: 400,
      fontWeightBold: 700,
      lineHeight: 1.0,
      letterSpacing: 0,

      // Theme
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
    const onWinResize = () => { try { fit.fit(); } catch (_) {} };

    const doFit = () => {
      try { fit.fit(); } catch (_) {}
      const sock = getSocket();
      if (term.cols && term.rows && sock.connected) {
        sock.emit('terminal:resize', { sessionId, cols: term.cols, rows: term.rows });
      }
    };

    // Open terminal — wait for font so glyph width is measured correctly
    const open = () => {
      term.open(divRef.current);
      // rAF: ensures the element is painted before measuring
      requestAnimationFrame(() => {
        doFit();

        // ResizeObserver MUST be set up AFTER open() — before open, there
        // is no canvas to resize, and fit.fit() would throw.
        ro = new ResizeObserver(doFit);
        ro.observe(divRef.current);

        // Also observe the parent container — catches layout changes from
        // sidebar resize and file tree collapse that reflow the flex tree
        const parent = divRef.current?.parentElement;
        if (parent) ro.observe(parent);

        window.addEventListener('resize', onWinResize);
      });
    };

    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(open);
    } else {
      open();
    }

    term.onData(data => {
      if (getSocket().connected) getSocket().emit('terminal:input', { sessionId, data });
    });

    termRefs.current[sessionId] = {
      write:   d  => term.write(d),
      clear:   () => term.clear(),
      focus:   () => term.focus(),
      fit:     () => { try { fit.fit(); } catch (_) {} },
      getSize: () => term.cols ? { cols: term.cols, rows: term.rows } : null,
    };

    return () => {
      console.log(`[xterm:${instanceId}] Disposing for session ${sessionId.slice(0,8)}`);
      ro?.disconnect();
      window.removeEventListener('resize', onWinResize);
      term.dispose();
      delete termRefs.current[sessionId];
    };
  }, []);

  // Refit + focus when tab becomes active
  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const ref = termRefs.current[sessionId];
      if (!ref) return;
      ref.fit();
      ref.focus();
      const size = ref.getSize();
      if (size && getSocket().connected) {
        getSocket().emit('terminal:resize', { sessionId, ...size });
      }
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
  const [activeTab, setActiveTab] = useState(null); // 'term-{id}' | 'file-{path}' | 'settings' | 'git'
  const [reconnecting, setRecon]  = useState(false);
  const [reconSecs, setReconSecs] = useState(0);
  const [deleting, setDeleting]   = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [treeCollapsed, setTreeCollapsed] = useState(false);

  const termRefs         = useRef({});
  const activeRef        = useRef(null);
  // Track which sessions this socket client has already joined (and received scrollback for).
  // Cleared on socket reconnect because the server treats it as a brand-new client.
  const joinedSessions   = useRef(new Set());
  // Guard: scrollback can only be written once per xterm instance.
  // Cleared alongside joinedSessions so a reconnect gets a fresh replay.
  const historyReplayed  = useRef(new Set());

  // Handle ?tab= from context menu
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'settings') { setActiveTab('settings'); setSearchParams({}); }
    else if (tab === 'git') { setActiveTab('git'); setSearchParams({}); }
  }, [searchParams]);

  useEffect(() => { loadProject(); loadTree(); loadSessions();
    const t1 = setInterval(loadProject, 5000);
    const t2 = setInterval(loadTree, 2000);
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
      historyReplayed.current.add(sessionId);
      const bytes = typeof data === 'string' ? data.length : 0;
      console.log(`[terminal] Replaying ${bytes} bytes history for session ${sessionId.slice(0,8)}`);
      const ref = termRefs.current[sessionId];
      if (ref) { ref.clear(); ref.write(data); }
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
    try {
      const r = await fetch(`/api/projects/${projectId}/terminals`);
      const d = await r.json();
      const sessions = d.sessions || [];
      setTermTabs(sessions.map(s => ({ id: s.id, name: s.name, aiState: s.aiState || 'none' })));
      if (sessions.length > 0) activateTerm(sessions[0].id);
      else createTerminal();
    } catch (_) {}
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

  async function createTerminal() {
    try {
      const r = await fetch(`/api/projects/${projectId}/terminals`, { method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}, body:'{}' });
      const d = await r.json();
      if (d.sessionId) { setTermTabs(p => [...p, { id: d.sessionId, name: d.name, aiState: 'none' }]); setTimeout(() => activateTerm(d.sessionId), 50); }
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
  }

  async function saveFile(path) {
    const r = await fetch(`/api/projects/${projectId}/files/write`, { method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken}, body: JSON.stringify({ filePath: path, content: fileContent[path] || '' }) });
    if ((await r.json()).success) setDirty(p => ({ ...p, [path]: false })); else addToast('Save failed.', 'error');
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
  const showOverlay = activeFileTab || activeTab === 'settings' || activeTab === 'git';

  return (
    <div className="cockpit">
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
          {tree.map(n => <FileNode key={n.path} node={n} depth={0} projectId={projectId} csrfToken={csrfToken} onOpenFile={openFile} activeFilePath={activeFileTab?.path} onRefresh={loadTree} />)}
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
            {termTabs.map(t => (
              <TerminalInstance key={t.id} sessionId={t.id} active={activeTab === `term-${t.id}`} termRefs={termRefs} />
            ))}
            {termTabs.length === 0 && !showOverlay && (
              <div className="cockpit-empty">
                <button className="btn btn-primary" onClick={createTerminal}>Open Terminal</button>
              </div>
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
                    <button className="btn btn-ghost" onClick={() => { const t = termTabs[0]; if (t) activateTerm(t.id); else setActiveTab(null); }}>← Terminal</button>
                    <span className="file-editor-name">{activeFileTab.name}</span>
                    <button className="btn btn-primary" onClick={() => saveFile(activeFileTab.path)}>Save</button>
                  </div>
                  <textarea className="file-editor-area" spellCheck={false}
                    value={fileContent[activeFileTab.path] || ''}
                    onChange={e => { setFileContent(p=>({...p,[activeFileTab.path]:e.target.value})); setDirty(p=>({...p,[activeFileTab.path]:true})); }} />
                </div>
              )}

              {/* Image viewer */}
              {activeFileTab?.type === 'image' && (
                <div className="file-editor">
                  <div className="file-editor-toolbar">
                    <button className="btn btn-ghost" onClick={() => { const t = termTabs[0]; if (t) activateTerm(t.id); }}>← Terminal</button>
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

              {/* Git panel */}
              {activeTab === 'git' && (
                <div className="side-panel">
                  <div className="side-panel-header">GIT</div>
                  <GitPanel projectId={projectId} csrfToken={csrfToken} addToast={addToast} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

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
