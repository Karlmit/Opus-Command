import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ProjectAvatar } from '../components/ProjectsSidebar';
import '@xterm/xterm/css/xterm.css';
import './ProjectCockpit.css';

/* ── Socket singleton ─────────────────────────────────── */
let socket = null;
function getSocket() {
  if (!socket) socket = io({ autoConnect: true, reconnection: true, reconnectionDelay: 1000 });
  return socket;
}

/* ── File tree ────────────────────────────────────────── */
function FileIcon({ name, isDir }) {
  if (isDir) return <span className="fi dir">▶</span>;
  const ext = name.split('.').pop()?.toLowerCase();
  const m = { js:'js', ts:'ts', jsx:'jsx', tsx:'tsx', py:'py', json:'{}', md:'md', css:'css', html:'html', sh:'sh' };
  return <span className="fi">{m[ext] || '·'}</span>;
}

function FileNode({ node, depth, projectId, onOpenFile, activeFilePath }) {
  const [open, setOpen] = useState(depth === 0);
  const [menu, setMenu] = useState(null);
  const { csrfToken } = useAuth();
  const { addToast } = useToast();
  const isDir = node.type === 'dir';
  const isActive = activeFilePath === node.path;

  async function create(type) {
    setMenu(null);
    const name = prompt(type === 'dir' ? 'Folder name:' : 'File name:');
    if (!name) return;
    const res = await fetch(`/api/projects/${projectId}/files/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ filePath: node.type === 'dir' ? `${node.path}/${name}` : name, type }),
    });
    if (!(await res.json()).success) addToast('Create failed.', 'error');
  }

  async function remove() {
    setMenu(null);
    if (!confirm(`Delete "${node.name}"?`)) return;
    await fetch(`/api/projects/${projectId}/files`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ path: node.path }),
    });
  }

  return (
    <div>
      <div
        className={`file-node${isActive ? ' active' : ''}`}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={() => isDir ? setOpen(o => !o) : onOpenFile(node)}
        onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}
      >
        {isDir && <span className={`chevron${open ? ' open' : ''}`}>›</span>}
        <FileIcon name={node.name} isDir={isDir} />
        <span className="file-node-name">{node.name}</span>
      </div>
      {isDir && open && node.children?.map(child => (
        <FileNode key={child.path} node={child} depth={depth + 1}
          projectId={projectId} onOpenFile={onOpenFile} activeFilePath={activeFilePath} />
      ))}
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

/* ── Terminal instance (one per session) ──────────────── */
function TerminalInstance({ sessionId, active }) {
  const divRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const sessionRef = useRef(sessionId);

  useEffect(() => {
    if (!divRef.current || xtermRef.current) return;
    const term = new XTerm({
      theme: { background: '#1E2024', foreground: '#E8EAED', cursor: '#3B82F6', selectionBackground: 'rgba(59,130,246,0.30)' },
      fontFamily: "'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace",
      fontSize: 14, lineHeight: 1.5, cursorBlink: true, cursorStyle: 'block', scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(divRef.current);
    xtermRef.current = term;
    fitRef.current = fit;

    term.onData(data => {
      const sock = getSocket();
      if (sock.connected) sock.emit('terminal:input', { sessionId: sessionRef.current, data });
    });

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch (_) {}
      if (xtermRef.current) {
        getSocket().emit('terminal:resize', { sessionId: sessionRef.current, cols: term.cols, rows: term.rows });
      }
    });
    ro.observe(divRef.current);

    return () => { ro.disconnect(); term.dispose(); xtermRef.current = null; fitRef.current = null; };
  }, []);

  // Fit when becoming active
  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try { fitRef.current?.fit(); } catch (_) {}
        xtermRef.current?.focus();
      }));
    }
  }, [active]);

  // Expose write method
  divRef.write = (data) => xtermRef.current?.write(data);
  divRef.clear = () => xtermRef.current?.clear();
  divRef.getSize = () => xtermRef.current ? { cols: xtermRef.current.cols, rows: xtermRef.current.rows } : null;

  return (
    <div
      ref={divRef}
      className="terminal-instance"
      style={{ display: active ? 'block' : 'none' }}
    />
  );
}

/* ── Main cockpit ─────────────────────────────────────── */
export default function ProjectCockpit() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const { csrfToken } = useAuth();
  const { addToast } = useToast();

  const [project, setProject] = useState(null);
  const [tree, setTree] = useState([]);

  // Tabs: { id, type: 'terminal'|'file', label, sessionId?, filePath?, icon }
  const [tabs, setTabs] = useState([]);
  const [activeTab, setActiveTab] = useState(null);

  // File editor state
  const [fileContent, setFileContent] = useState({});   // filePath → content
  const [dirtyFiles, setDirtyFiles] = useState({});     // filePath → bool

  // Terminal refs map
  const termRefs = useRef({});  // sessionId → div element ref

  // Socket state
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectSecs, setReconnectSecs] = useState(0);
  const activeTabRef = useRef(null);

  // Delete
  const [deleting, setDeleting] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  /* ── Load project + file tree ── */
  useEffect(() => {
    loadProject();
    loadTree();
    const t1 = setInterval(loadProject, 5000);
    const t2 = setInterval(loadTree, 2000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [projectId]);

  async function loadProject() {
    try {
      const r = await fetch(`/api/projects/${projectId}`);
      if (r.ok) setProject(await r.json());
    } catch (_) {}
  }

  async function loadTree() {
    try {
      const r = await fetch(`/api/projects/${projectId}/files`);
      const d = await r.json();
      setTree(d.tree || []);
    } catch (_) {}
  }

  /* ── Socket setup ── */
  useEffect(() => {
    loadSessions();
    const sock = getSocket();

    const onConnect = () => {
      setReconnecting(false);
      if (activeTabRef.current) {
        const tab = tabs.find(t => t.id === activeTabRef.current);
        if (tab?.type === 'terminal') sock.emit('terminal:join', { sessionId: tab.sessionId });
      }
    };
    const onDisconnect = () => { setReconnecting(true); setReconnectSecs(0); };

    const onData = ({ sessionId, data }) => {
      const div = termRefs.current[sessionId];
      if (div?.write) div.write(data);
    };
    const onScrollback = ({ sessionId, data }) => {
      const div = termRefs.current[sessionId];
      if (div?.clear) div.clear();
      if (div?.write) div.write(data);
    };
    const onExit = ({ sessionId }) => {
      setTabs(prev => prev.filter(t => !(t.type === 'terminal' && t.sessionId === sessionId)));
    };
    const onAiState = ({ sessionId, state }) => {
      setTabs(prev => prev.map(t => t.sessionId === sessionId ? { ...t, aiState: state } : t));
    };

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('terminal:data', onData);
    sock.on('terminal:scrollback', onScrollback);
    sock.on('terminal:exit', onExit);
    sock.on('terminal:ai-state', onAiState);

    return () => {
      sock.off('connect', onConnect); sock.off('disconnect', onDisconnect);
      sock.off('terminal:data', onData); sock.off('terminal:scrollback', onScrollback);
      sock.off('terminal:exit', onExit); sock.off('terminal:ai-state', onAiState);
    };
  }, [projectId]);

  // Reconnect timer
  useEffect(() => {
    if (!reconnecting) return;
    const t = setInterval(() => setReconnectSecs(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [reconnecting]);

  async function loadSessions() {
    try {
      const r = await fetch(`/api/projects/${projectId}/terminals`);
      const d = await r.json();
      const sessions = d.sessions || [];
      const termTabs = sessions.map(s => ({
        id: `term-${s.id}`, type: 'terminal', label: s.name,
        sessionId: s.id, aiState: s.aiState || 'none',
      }));
      setTabs(termTabs);
      if (termTabs.length > 0) activateTab(termTabs[0]);
      else createTerminal();
    } catch (_) {}
  }

  function activateTab(tab) {
    activeTabRef.current = tab.id;
    setActiveTab(tab.id);
    if (tab.type === 'terminal') {
      const sock = getSocket();
      const join = () => {
        sock.emit('terminal:join', { sessionId: tab.sessionId });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const div = termRefs.current[tab.sessionId];
          if (div?.getSize) {
            const size = div.getSize();
            if (size) sock.emit('terminal:resize', { sessionId: tab.sessionId, ...size });
          }
        }));
      };
      sock.connected ? join() : sock.once('connect', join);
    }
  }

  async function createTerminal() {
    try {
      const r = await fetch(`/api/projects/${projectId}/terminals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: '{}',
      });
      const d = await r.json();
      if (d.sessionId) {
        const tab = { id: `term-${d.sessionId}`, type: 'terminal', label: d.name, sessionId: d.sessionId, aiState: 'none' };
        setTabs(prev => [...prev, tab]);
        setTimeout(() => activateTab(tab), 50);
      } else {
        addToast(d.error || 'Failed to create terminal.', 'error');
      }
    } catch (err) { addToast(err.message, 'error'); }
  }

  async function openFile(node) {
    const existingTab = tabs.find(t => t.type === 'file' && t.filePath === node.path);
    if (existingTab) { activateTab(existingTab); return; }

    // Load file content
    const ext = node.name.split('.').pop()?.toLowerCase();
    const imageExts = ['png','jpg','jpeg','gif','svg','webp'];
    if (imageExts.includes(ext)) {
      const tab = { id: `file-${node.path}`, type: 'image', label: node.name, filePath: node.path };
      setTabs(prev => [...prev, tab]);
      activateTab(tab);
      return;
    }

    try {
      const r = await fetch(`/api/projects/${projectId}/files/read?path=${encodeURIComponent(node.path)}`);
      const d = await r.json();
      if (d.content !== undefined) {
        setFileContent(prev => ({ ...prev, [node.path]: d.content }));
        const tab = { id: `file-${node.path}`, type: 'file', label: node.name, filePath: node.path };
        setTabs(prev => [...prev, tab]);
        activateTab(tab);
      }
    } catch { addToast('Could not open file.', 'error'); }
  }

  async function saveFile(filePath) {
    try {
      const r = await fetch(`/api/projects/${projectId}/files/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ filePath, content: fileContent[filePath] || '' }),
      });
      if ((await r.json()).success) {
        setDirtyFiles(prev => ({ ...prev, [filePath]: false }));
      } else addToast('Save failed.', 'error');
    } catch { addToast('Save failed.', 'error'); }
  }

  function closeTab(tab) {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== tab.id);
      if (activeTab === tab.id && next.length > 0) activateTab(next[next.length - 1]);
      else if (next.length === 0) { setActiveTab(null); activeTabRef.current = null; }
      return next;
    });
    if (tab.type === 'terminal') {
      fetch(`/api/projects/${projectId}/terminals/${tab.sessionId}`, {
        method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken },
      });
    }
  }

  async function deleteProject() {
    setDeleting(true);
    try {
      const r = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken },
      });
      if (r.ok) navigate('/');
      else addToast('Delete failed.', 'error');
    } catch { addToast('Delete failed.', 'error'); }
    finally { setDeleting(false); setShowDelete(false); }
  }

  const activeTabData = tabs.find(t => t.id === activeTab);

  /* ── Render ── */
  return (
    <div className="cockpit">
      {/* File tree sidebar */}
      <div className="cockpit-filetree">
        <div className="filetree-header">
          <span className="filetree-title">FILES</span>
          <div className="filetree-actions">
            <button className="ft-btn" title="New file"
              onClick={async () => {
                const name = prompt('File name:'); if (!name) return;
                await fetch(`/api/projects/${projectId}/files/create`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                  body: JSON.stringify({ filePath: name, type: 'file' }),
                }); loadTree();
              }}>+F</button>
            <button className="ft-btn" title="New folder"
              onClick={async () => {
                const name = prompt('Folder name:'); if (!name) return;
                await fetch(`/api/projects/${projectId}/files/create`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                  body: JSON.stringify({ filePath: name, type: 'dir' }),
                }); loadTree();
              }}>+D</button>
          </div>
        </div>
        <div className="filetree-scroll">
          {tree.length === 0 && <p className="filetree-empty">Empty project</p>}
          {tree.map(node => (
            <FileNode key={node.path} node={node} depth={0} projectId={projectId}
              onOpenFile={openFile}
              activeFilePath={activeTabData?.filePath}
            />
          ))}
        </div>

        {/* Project info + delete */}
        <div className="cockpit-project-info">
          {project && <ProjectAvatar project={project} size={24} />}
          <span className="cockpit-project-name truncate">{project?.name}</span>
          <button className="cockpit-delete-btn" onClick={() => setShowDelete(true)} title="Delete project">🗑</button>
        </div>
      </div>

      {/* Main area */}
      <div className="cockpit-main">
        {/* Tab bar */}
        <div className="cockpit-tabs" role="tablist">
          {/* Terminal tabs */}
          {tabs.filter(t => t.type === 'terminal').map(tab => (
            <div key={tab.id}
              className={`cockpit-tab${activeTab === tab.id ? ' active' : ''}${tab.aiState === 'waiting' ? ' ai-waiting' : tab.aiState === 'active' ? ' ai-active' : ''}`}
              role="tab" aria-selected={activeTab === tab.id}
              onClick={() => activateTab(tab)}
            >
              <span className="tab-icon term-icon">⌨</span>
              <span className="tab-label">{tab.label}</span>
              {tab.aiState === 'waiting' && <span className="tab-ai-badge badge-ai">Waiting</span>}
              <button className="tab-close" onClick={e => { e.stopPropagation(); closeTab(tab); }}>×</button>
            </div>
          ))}

          {/* Add terminal button */}
          <button className="cockpit-new-term" onClick={createTerminal} title="New terminal">+ Terminal</button>

          {/* Divider if files open */}
          {tabs.some(t => t.type === 'file' || t.type === 'image') && (
            <div className="tab-divider" aria-hidden="true" />
          )}

          {/* File tabs */}
          {tabs.filter(t => t.type === 'file' || t.type === 'image').map(tab => (
            <div key={tab.id}
              className={`cockpit-tab file-tab${activeTab === tab.id ? ' active' : ''}`}
              role="tab" aria-selected={activeTab === tab.id}
              onClick={() => activateTab(tab)}
            >
              <span className="tab-icon">📄</span>
              <span className="tab-label">
                {tab.label}{dirtyFiles[tab.filePath] ? ' ·' : ''}
              </span>
              <button className="tab-close" onClick={e => { e.stopPropagation(); closeTab(tab); }}>×</button>
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="cockpit-content">
          {/* Terminal panels — all mounted, show/hide */}
          <div className="terminals-layer" style={{ display: activeTabData?.type === 'terminal' ? 'flex' : 'none' }}>
            {tabs.filter(t => t.type === 'terminal').map(tab => (
              <TerminalInstance
                key={tab.sessionId}
                sessionId={tab.sessionId}
                active={activeTab === tab.id}
                ref={el => { if (el) termRefs.current[tab.sessionId] = el; }}
              />
            ))}
            {reconnecting && (
              <div className="terminal-reconnect-overlay">
                <span>{reconnectSecs > 5 ? `Connection lost. Retrying… ${reconnectSecs}s` : 'Reconnecting…'}</span>
              </div>
            )}
          </div>

          {/* File editor */}
          {activeTabData?.type === 'file' && (
            <div className="file-editor"
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(activeTabData.filePath); } }}
            >
              <div className="file-editor-toolbar">
                <button className="btn btn-ghost" onClick={() => activateTab(tabs.find(t => t.type === 'terminal') || tabs[0])}>
                  ← Back to Terminal
                </button>
                <span className="file-editor-name">{activeTabData.label}</span>
                <button className="btn btn-primary" onClick={() => saveFile(activeTabData.filePath)}>Save</button>
              </div>
              <textarea
                className="file-editor-area"
                value={fileContent[activeTabData.filePath] || ''}
                onChange={e => {
                  setFileContent(prev => ({ ...prev, [activeTabData.filePath]: e.target.value }));
                  setDirtyFiles(prev => ({ ...prev, [activeTabData.filePath]: true }));
                }}
                spellCheck={false}
              />
            </div>
          )}

          {/* Image viewer */}
          {activeTabData?.type === 'image' && (
            <div className="image-viewer-cockpit">
              <div className="file-editor-toolbar">
                <button className="btn btn-ghost" onClick={() => activateTab(tabs.find(t => t.type === 'terminal') || tabs[0])}>
                  ← Back to Terminal
                </button>
                <span className="file-editor-name">{activeTabData.label}</span>
              </div>
              <div className="image-viewer-body">
                <img src={`/api/projects/${projectId}/files/read?path=${encodeURIComponent(activeTabData.filePath)}`}
                  alt={activeTabData.label} />
              </div>
            </div>
          )}

          {/* Empty state */}
          {!activeTabData && (
            <div className="cockpit-empty">
              <button className="btn btn-primary" onClick={createTerminal}>Open Terminal</button>
            </div>
          )}
        </div>
      </div>

      {/* Delete modal */}
      {showDelete && (
        <div className="modal-backdrop" onClick={e => !deleting && e.target === e.currentTarget && setShowDelete(false)}>
          <div className="modal" role="dialog" aria-modal="true">
            <div className="modal-header">
              <h2 className="modal-title">Delete project?</h2>
            </div>
            <div className="modal-body">
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
                The workspace container and home volume will be removed.<br />
                <strong>Project files on disk are not deleted.</strong>
              </p>
              {deleting && (
                <div className="delete-loading">
                  <span className="delete-spinner" />
                  Removing workspace…
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowDelete(false)} disabled={deleting}>Cancel</button>
              <button className="btn btn-danger" onClick={deleteProject} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete Project'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
