import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import './ProjectsSidebar.css';

/* ── Constants ──────────────────────────────────── */
const MIN_WIDTH       = 52;
const COLLAPSE_THRESH = 110;
const DEFAULT_WIDTH   = 210;
const MAX_WIDTH       = 360;

/* ── Avatar helpers ─────────────────────────────── */
const COLORS = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#22c55e','#06b6d4','#3b82f6','#64748b','#92400e'];
const EMOJIS = ['🚀','💡','🔥','⚡','🎯','🛠️','🌊','🦋','🌙','⭐','💎','🎮','🧩','🔮','🐉','🌿','🎨','🤖'];
function defaultColor(id) { return COLORS[(id - 1) % COLORS.length]; }

export function ProjectAvatar({ project, size = 36 }) {
  const avatar  = project.avatar || '';
  const isEmoji = avatar.length > 0 && !avatar.startsWith('#');
  const bgColor = isEmoji ? defaultColor(project.id) : (avatar || defaultColor(project.id));
  const initials = (project.name || '?').slice(0, 2).toUpperCase();
  return (
    <div className="project-avatar"
      style={{ width: size, height: size, minWidth: size, background: bgColor,
               fontSize: isEmoji ? size * 0.5 : size * 0.35 }}
      title={project.name}
    >
      {isEmoji ? avatar : initials}
    </div>
  );
}

/* ── Sidebar popover ────────────────────────────── *
 * Appears to the RIGHT of the anchor element.       *
 * Adjusts vertically to stay within the viewport.   */
function SidebarPopover({ anchorEl, onClose, children, width = 280 }) {
  const [style, setStyle] = useState({ visibility: 'hidden' });
  const popoverRef = useRef(null);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const anchor  = anchorEl.getBoundingClientRect();
    const vp      = { w: window.innerWidth, h: window.innerHeight };
    const popH    = popoverRef.current?.offsetHeight || 320;
    const left    = anchor.right + 10;
    let   top     = anchor.top;

    // Clamp so it doesn't go off the bottom of the viewport
    if (top + popH > vp.h - 16) top = Math.max(16, vp.h - popH - 16);

    setStyle({ position: 'fixed', left, top, width, visibility: 'visible' });
  }, [anchorEl, width]);

  // Close on outside click
  useEffect(() => {
    function onDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) onClose();
    }
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div ref={popoverRef} className="sidebar-popover" style={style} role="dialog">
      {children}
    </div>
  );
}

/* ── New project form (inline in popover) ───────── */
function NewProjectForm({ csrfToken, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', folder: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const firstRef = useRef(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  function handleNameChange(name) {
    const folder = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setForm(f => ({ ...f, name, folder: f.folder || folder }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.folder.trim()) return setError('Name and folder required.');
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.id) { onCreated(d); onClose(); }
      else setError(d.error || 'Failed to create project.');
    } catch { setError('An error occurred.'); }
    finally { setLoading(false); }
  }

  return (
    <form onSubmit={submit} className="popover-form">
      <div className="popover-header">
        <span className="popover-title">New Project</span>
        <button type="button" className="popover-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="form-group">
        <label className="form-label">Project Name</label>
        <input ref={firstRef} className="input" value={form.name}
          onChange={e => handleNameChange(e.target.value)} placeholder="My Project" />
      </div>

      <div className="form-group">
        <label className="form-label">Project Folder</label>
        <input className="input" value={form.folder}
          onChange={e => setForm(f => ({ ...f, folder: e.target.value }))} placeholder="my-project" />
        <p className="form-hint">Subdirectory within <code>/projects</code></p>
      </div>

      {error && <p className="error-message">{error}</p>}

      <div className="popover-footer">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary"
          disabled={loading || !form.name || !form.folder}>
          {loading ? 'Creating…' : 'Create'}
        </button>
      </div>
    </form>
  );
}

/* ── Avatar picker (inline in popover) ─────────── */
function AvatarPickerForm({ project, csrfToken, onSaved, onClose }) {
  const existing = project.avatar || '';
  const [emoji, setEmoji] = useState(existing.startsWith('#') || !existing ? '' : existing);
  const [color, setColor] = useState(existing.startsWith('#') ? existing : defaultColor(project.id));
  const [mode,  setMode]  = useState(existing.startsWith('#') || !existing ? 'color' : 'emoji');
  const [saving, setSaving] = useState(false);

  const previewAvatar = mode === 'emoji' && emoji ? emoji : '';
  const previewColor  = mode === 'emoji' && emoji ? defaultColor(project.id) : color;

  async function save() {
    setSaving(true);
    const avatar = mode === 'emoji' && emoji ? emoji : color;
    try {
      await fetch(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ avatar }),
      });
      onSaved(avatar);
      onClose();
    } catch { setSaving(false); }
  }

  return (
    <div className="popover-form">
      <div className="popover-header">
        <span className="popover-title">Avatar</span>
        <button className="popover-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      {/* Mini preview */}
      <div className="avatar-picker-preview">
        <div className="project-avatar avatar-preview-sm"
          style={{ background: previewColor, fontSize: previewAvatar ? 18 : 13 }}>
          {previewAvatar || project.name.slice(0, 2).toUpperCase()}
        </div>
        <span className="avatar-preview-label">{project.name}</span>
      </div>

      {/* Mode tabs */}
      <div className="avatar-mode-tabs">
        <button className={`avatar-mode-btn${mode === 'color' ? ' active' : ''}`} onClick={() => setMode('color')}>Color</button>
        <button className={`avatar-mode-btn${mode === 'emoji' ? ' active' : ''}`} onClick={() => setMode('emoji')}>Emoji</button>
      </div>

      {mode === 'color' && (
        <div className="avatar-color-grid">
          {COLORS.map(c => (
            <button key={c} className={`avatar-color-swatch${color === c ? ' selected' : ''}`}
              style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
      )}

      {mode === 'emoji' && (
        <div className="avatar-emoji-grid">
          {EMOJIS.map(e => (
            <button key={e} className={`avatar-emoji-btn${emoji === e ? ' selected' : ''}`}
              onClick={() => setEmoji(prev => prev === e ? '' : e)}>{e}</button>
          ))}
          {emoji && (
            <button className="avatar-emoji-btn avatar-clear" onClick={() => setEmoji('')}>✕</button>
          )}
        </div>
      )}

      <div className="popover-footer">
        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ── Context menu ───────────────────────────────── */
function ProjectContextMenu({ project, position, onClose, onOpenAvatar, navigate }) {
  const ref = useRef(null);
  useEffect(() => {
    function down(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    function key(e)  { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown',   key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, []);

  function go(path) { navigate(path); onClose(); }

  return (
    <div ref={ref} className="project-context-menu" style={{ top: position.y, left: position.x }} role="menu">
      <button role="menuitem" onClick={() => go(`/project/${project.id}`)}>Open</button>
      <button role="menuitem" onClick={() => go(`/project/${project.id}?tab=settings`)}>Workspace &amp; Logs</button>
      <button role="menuitem" onClick={() => go(`/project/${project.id}?tab=git`)}>Git</button>
      <div className="context-separator" />
      <button role="menuitem" onClick={() => { onOpenAvatar(); onClose(); }}>Change Avatar</button>
    </div>
  );
}

/* ── Main sidebar ───────────────────────────────── */
export default function ProjectsSidebar() {
  const { id: activeId } = useParams();
  const navigate = useNavigate();
  const { csrfToken } = useAuth();

  const [projects, setProjects]   = useState([]);
  const [contextMenu, setContext] = useState(null);

  // Popovers — store anchor element refs so SidebarPopover can position itself
  const [newProjectAnchor, setNewProjectAnchor] = useState(null); // HTMLElement | null
  const [avatarTarget, setAvatarTarget]         = useState(null); // { project, anchor }

  const newBtnRef = useRef(null);

  /* ── Resizable width ─────────────────────────── */
  const [width, setWidth] = useState(() =>
    parseInt(localStorage.getItem('sidebar-width') || String(DEFAULT_WIDTH), 10)
  );
  const widthRef    = useRef(width);
  const isCollapsed = width < COLLAPSE_THRESH;

  useEffect(() => { widthRef.current = width; localStorage.setItem('sidebar-width', String(width)); }, [width]);

  function startDrag(e) {
    e.preventDefault();
    const startX = e.clientX, startW = widthRef.current;
    function onMove(e) { setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, startW + (e.clientX - startX)))); }
    function onUp()   { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.body.style.cursor = document.body.style.userSelect = ''; }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  /* ── Theme-aware logo ────────────────────────── */
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'dark');
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(document.documentElement.getAttribute('data-theme') || 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  const isDark  = theme !== 'light';
  const logoSrc = isCollapsed ? (isDark ? '/mark-dark.svg' : '/mark-light.svg') : (isDark ? '/logo-dark.svg' : '/logo-light.svg');

  /* ── Project data ────────────────────────────── */
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function load() {
    try { const r = await fetch('/api/projects'); const d = await r.json(); setProjects(d.projects || []); } catch (_) {}
  }

  function handleCreated(p) { setProjects(prev => [...prev, p]); navigate(`/project/${p.id}`); }
  function handleAvatarSaved(pid, avatar) { setProjects(prev => prev.map(p => p.id === pid ? { ...p, avatar } : p)); }
  function handleContext(e, project) { e.preventDefault(); e.stopPropagation(); setContext({ project, x: e.clientX, y: e.clientY }); }

  /* ── Render ──────────────────────────────────── */
  return (
    <nav className={`projects-sidebar${isCollapsed ? ' collapsed' : ''}`}
         style={{ width, minWidth: width }} aria-label="Projects">

      <div className="sidebar-logo-area">
        <img src={logoSrc} alt="Opus Command" height={28} style={{ maxWidth: isCollapsed ? 32 : 160 }} />
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-projects">
        {projects.length === 0 && !isCollapsed && <p className="sidebar-empty">No projects yet</p>}
        {projects.map(project => {
          const isActive = String(project.id) === String(activeId);
          return (
            <div key={project.id}
              data-id={project.id}
              className={`sidebar-project-item${isActive ? ' active' : ''}`}
              onClick={() => navigate(`/project/${project.id}`)}
              onContextMenu={e => handleContext(e, project)}
              title={isCollapsed ? project.name : undefined}
            >
              <div className="sidebar-avatar-wrap">
                <ProjectAvatar project={project} size={34} />
                <span className={`sidebar-status-dot status-${project.status}`} />
                {project.aiWaiting > 0 && <span className="sidebar-ai-dot" />}
              </div>
              {!isCollapsed && (
                <div className="sidebar-project-meta">
                  <span className="sidebar-project-name">{project.name}</span>
                  <span className="sidebar-project-status">{project.status}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sidebar-spacer" />

      {/* New project — opens popover to the right */}
      <button ref={newBtnRef} className="sidebar-new-project"
        onClick={() => setNewProjectAnchor(newBtnRef.current)}
        title={isCollapsed ? 'New project' : undefined}
      >
        <span className="sidebar-new-icon">+</span>
        {!isCollapsed && <span className="sidebar-new-label">New project</span>}
      </button>

      <div className="sidebar-divider" />

      <button className="sidebar-settings-btn" onClick={() => navigate('/settings')}
        title={isCollapsed ? 'Settings' : undefined}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        {!isCollapsed && <span className="sidebar-settings-label">Settings</span>}
      </button>

      {/* Drag handle */}
      <div className="sidebar-resize-handle" onMouseDown={startDrag} title="Drag to resize" />

      {/* New project popover */}
      {newProjectAnchor && (
        <SidebarPopover anchorEl={newProjectAnchor} onClose={() => setNewProjectAnchor(null)}>
          <NewProjectForm
            csrfToken={csrfToken}
            onClose={() => setNewProjectAnchor(null)}
            onCreated={handleCreated}
          />
        </SidebarPopover>
      )}

      {/* Avatar picker popover */}
      {avatarTarget && (
        <SidebarPopover anchorEl={avatarTarget.anchor} onClose={() => setAvatarTarget(null)} width={260}>
          <AvatarPickerForm
            project={avatarTarget.project}
            csrfToken={csrfToken}
            onSaved={avatar => handleAvatarSaved(avatarTarget.project.id, avatar)}
            onClose={() => setAvatarTarget(null)}
          />
        </SidebarPopover>
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <ProjectContextMenu
          project={contextMenu.project}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContext(null)}
          onOpenAvatar={() => {
            // Find the project's DOM element to use as anchor
            const el = document.querySelector(
              `.sidebar-project-item[data-id="${contextMenu.project.id}"]`
            ) || newBtnRef.current;
            setAvatarTarget({ project: contextMenu.project, anchor: el });
          }}
          navigate={navigate}
        />
      )}
    </nav>
  );
}
