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
function FileIcon({ name, isDir }) {
  if (isDir) return <span className="fi dir">›</span>;
  const ext = name.split('.').pop()?.toLowerCase();
  const map = { js:'js',ts:'ts',jsx:'jsx',tsx:'tsx',py:'py',json:'{}',md:'md',css:'css',html:'html',sh:'sh' };
  return <span className="fi">{map[ext] || '·'}</span>;
}

function FileNode({ node, depth, projectId, csrfToken, onOpenFile, activeFilePath, onRefresh }) {
  const [open, setOpen] = useState(depth === 0);
  const [menu, setMenu] = useState(null);
  const { addToast } = useToast();
  const isDir = node.type === 'dir';

  async function create(type) {
    setMenu(null);
    const name = prompt(type === 'dir' ? 'Folder name:' : 'File name:');
    if (!name) return;
    const path = node.type === 'dir' ? `${node.path}/${name}` : name;
    const r = await fetch(`/api/projects/${projectId}/files/create`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ filePath: path, type }),
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
    <div>
      <div
        className={`file-node${activeFilePath === node.path ? ' active' : ''}`}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => isDir ? setOpen(o => !o) : onOpenFile(node)}
        onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      >
        {isDir && <span className={`chevron${open ? ' open' : ''}`}>›</span>}
        <FileIcon name={node.name} isDir={isDir} />
        <span className="file-node-name">{node.name}</span>
      </div>
      {isDir && open && node.children?.map(c =>
        <FileNode key={c.path} node={c} depth={depth+1} projectId={projectId} csrfToken={csrfToken}
          onOpenFile={onOpenFile} activeFilePath={activeFilePath} onRefresh={onRefresh} />
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
function TerminalInstance({ sessionId, active, termRefs }) {
  const divRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    if (!divRef.current || xtermRef.current) return;
    const term = new XTerm({
      theme: {
        background: '#1E2024',
        foreground: '#E8EAED',
        cursor: '#3B82F6',
        selectionBackground: 'rgba(59,130,246,0.30)',
        scrollbarSliderBackground: 'rgba(255,255,255,0.10)',
        scrollbarSliderHoverBackground: 'rgba(255,255,255,0.20)',
        scrollbarSliderActiveBackground: 'rgba(255,255,255,0.30)',
      },
      fontFamily: "'JetBrains Mono','Cascadia Code',ui-monospace,monospace",
      fontSize: 14, lineHeight: 1.0, cursorBlink: true, cursorStyle: 'block', scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit); term.loadAddon(new WebLinksAddon());
    term.open(divRef.current);
    xtermRef.current = term; fitRef.current = fit;
    term.onData(data => { if (getSocket().connected) getSocket().emit('terminal:input', { sessionId, data }); });
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch (_) {}
      if (term.cols && term.rows) getSocket().emit('terminal:resize', { sessionId, cols: term.cols, rows: term.rows });
    });
    ro.observe(divRef.current);
    // Expose to parent via ref map
    termRefs.current[sessionId] = { write: d => term.write(d), clear: () => term.clear(), fit: () => { try { fit.fit(); } catch (_) {} }, focus: () => term.focus(), getSize: () => ({ cols: term.cols, rows: term.rows }) };
    return () => { ro.disconnect(); term.dispose(); delete termRefs.current[sessionId]; };
  }, []);

  useEffect(() => {
    if (active) requestAnimationFrame(() => requestAnimationFrame(() => { termRefs.current[sessionId]?.fit(); termRefs.current[sessionId]?.focus(); }));
  }, [active]);

  // Use visibility (not display:none) so the element keeps its dimensions.
  // display:none causes FitAddon to measure 0×0, making the terminal squish
  // when shown again. visibility:hidden keeps layout intact.
  return <div ref={divRef} className="terminal-instance" style={{ visibility: active ? 'visible' : 'hidden' }} />;
}

/* ── Workspace settings panel ──────────────────── */
function WorkspacePanel({ projectId, project, csrfToken, addToast }) {
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

  const termRefs   = useRef({});
  const activeRef  = useRef(null);

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
    const onConnect = () => { setRecon(false); if (activeRef.current?.startsWith('term-')) { const sid = activeRef.current.slice(5); sock.emit('terminal:join', { sessionId: sid }); } };
    const onDisconnect = () => { setRecon(true); setReconSecs(0); };
    const onData = ({ sessionId, data }) => termRefs.current[sessionId]?.write(data);
    const onScrollback = ({ sessionId, data }) => { termRefs.current[sessionId]?.clear(); termRefs.current[sessionId]?.write(data); };
    const onExit = ({ sessionId }) => setTermTabs(p => p.filter(t => t.id !== sessionId));
    const onAi = ({ sessionId, state }) => setTermTabs(p => p.map(t => t.id === sessionId ? { ...t, aiState: state } : t));
    sock.on('connect', onConnect); sock.on('disconnect', onDisconnect);
    sock.on('terminal:data', onData); sock.on('terminal:scrollback', onScrollback);
    sock.on('terminal:exit', onExit); sock.on('terminal:ai-state', onAi);
    return () => { sock.off('connect', onConnect); sock.off('disconnect', onDisconnect); sock.off('terminal:data', onData); sock.off('terminal:scrollback', onScrollback); sock.off('terminal:exit', onExit); sock.off('terminal:ai-state', onAi); };
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
    const join = () => {
      sock.emit('terminal:join', { sessionId });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const ref = termRefs.current[sessionId];
        if (ref) { ref.fit(); const s = ref.getSize(); if (s) sock.emit('terminal:resize', { sessionId, ...s }); ref.focus(); }
      }));
    };
    sock.connected ? join() : sock.once('connect', join);
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
                  <WorkspacePanel projectId={projectId} project={project} csrfToken={csrfToken} addToast={addToast} />
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
