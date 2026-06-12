import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { getNotificationSocket } from '../context/NotificationsContext';
import './ProjectsSidebar.css';

/* ── Constants ──────────────────────────────────── */
const MIN_WIDTH       = 52;
const COLLAPSE_THRESH = 110;
const DEFAULT_WIDTH   = 210;
const MAX_WIDTH       = 360;

/* ── Avatar helpers ─────────────────────────────── */
const COLORS = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#22c55e','#06b6d4','#3b82f6','#64748b','#92400e'];
const animatedEmojiThumbs = import.meta.glob('../assets/animated-emojis/thumbs/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});
const animatedEmojiFulls = import.meta.glob('../assets/animated-emojis/full/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

function fileName(path) {
  return path.split('/').pop();
}

function emojiCodepoints(value) {
  return Array.from(value)
    .map(char => char.codePointAt(0).toString(16))
    .join('_');
}

const ANIMATED_EMOJIS = Object.entries(animatedEmojiThumbs)
  .map(([path, thumb]) => {
    const file = fileName(path);
    const stem = file.replace(/\.webp$/i, '');
    const [rawName, ...codeParts] = stem.split('_');
    return {
      file,
      code: codeParts.join('_'),
      label: rawName.replace(/-/g, ' '),
      thumb,
      full: animatedEmojiFulls[`../assets/animated-emojis/full/${file}`],
    };
  })
  .filter(option => option.full)
  .sort((a, b) => a.label.localeCompare(b.label));
const ANIMATED_EMOJI_BY_FILE = new Map(ANIMATED_EMOJIS.map(option => [option.file, option]));
const ANIMATED_EMOJI_BY_CODE = new Map(ANIMATED_EMOJIS.map(option => [option.code, option]));
function defaultColor(id) { return COLORS[(id - 1) % COLORS.length]; }

// Parses avatar string into { emoji, color }.
// Formats: "" | "#hex" | "animated:file.webp" | "animated:file.webp|#hex" | legacy emoji
function parseAvatar(avatar, projectId) {
  if (!avatar) return { emoji: '', animated: null, color: defaultColor(projectId) };
  if (avatar.includes('|')) {
    const [e, c] = avatar.split('|');
    if (e.startsWith('animated:')) {
      return { emoji: '', animated: ANIMATED_EMOJI_BY_FILE.get(e.slice('animated:'.length)) || null, color: c };
    }
    return { emoji: e, animated: ANIMATED_EMOJI_BY_CODE.get(emojiCodepoints(e)) || null, color: c };
  }
  if (avatar.startsWith('#')) return { emoji: '', animated: null, color: avatar };
  if (avatar.startsWith('animated:')) {
    return { emoji: '', animated: ANIMATED_EMOJI_BY_FILE.get(avatar.slice('animated:'.length)) || null, color: defaultColor(projectId) };
  }
  return { emoji: avatar, animated: ANIMATED_EMOJI_BY_CODE.get(emojiCodepoints(avatar)) || null, color: defaultColor(projectId) };
}

function AnimatedEmojiImage({ option, className = '', animated = false }) {
  return (
    <img
      className={`avatar-animated-image${className ? ` ${className}` : ''}`}
      src={animated ? option.full : option.thumb}
      alt=""
      draggable="false"
    />
  );
}

export function ProjectAvatar({ project, size = 36 }) {
  const { emoji, animated, color } = parseAvatar(project.avatar, project.id);
  const [playing, setPlaying] = useState(false);
  const initials = (project.name || '?').slice(0, 2).toUpperCase();
  return (
    <div className="project-avatar"
      style={{ width: size, height: size, minWidth: size, background: color,
               fontSize: emoji && !animated ? size * 0.5 : size * 0.35 }}
      title={project.name}
      onMouseEnter={() => setPlaying(true)}
      onMouseLeave={() => setPlaying(false)}
    >
      {animated ? <AnimatedEmojiImage option={animated} animated={playing} /> : (emoji || initials)}
    </div>
  );
}

/* ── Sidebar modal ──────────────────────────────── *
 * Centered overlay so it is always fully visible,   *
 * regardless of sidebar height or screen size.      */
function SidebarPopover({ onClose, children, width = 280 }) {
  const popoverRef = useRef(null);

  // Close on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Close when clicking the backdrop (but not the dialog itself)
  function onBackdrop(e) { if (e.target === e.currentTarget) onClose(); }

  return createPortal(
    <div className="sidebar-modal-backdrop" onMouseDown={onBackdrop}>
      <div ref={popoverRef} className="sidebar-popover sidebar-popover-centered"
           style={{ width }} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body
  );
}

/* ── New project form (inline in popover) ───────── */
function NewProjectForm({ csrfToken, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', folder: '', template: 'claude-code', backend: 'docker' });
  const [templates, setTemplates] = useState([]);
  const [backends, setBackends] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const firstRef = useRef(null);

  useEffect(() => { firstRef.current?.focus(); }, []);

  useEffect(() => {
    fetch('/api/projects/templates')
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
      .catch(() => {});
    fetch('/api/projects/backends')
      .then(r => r.json())
      .then(data => setBackends(data.backends || []))
      .catch(() => {});
  }, []);

  const lxcBackend = backends.find(b => b.id === 'unraid_lxc');
  const lxcAvailable = !!lxcBackend?.available;
  const isLxc = form.backend === 'unraid_lxc';

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
        <label className="form-label">Workspace Backend</label>
        <select className="input" value={form.backend}
          onChange={e => setForm(f => ({ ...f, backend: e.target.value }))}>
          <option value="docker">Docker (default)</option>
          <option value="unraid_lxc" disabled={!lxcAvailable}>
            Unraid LXC{lxcAvailable ? '' : ` — ${lxcBackend?.reason || 'unavailable'}`}
          </option>
        </select>
        <p className="form-hint">
          {isLxc
            ? 'Runs as an LXC container on your Unraid server over SSH.'
            : 'Portable Docker workspace.'}
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">Project Folder</label>
        <input className="input" value={form.folder}
          onChange={e => setForm(f => ({ ...f, folder: e.target.value }))} placeholder="my-project" />
        <p className="form-hint">
          {isLxc
            ? <>Folder under the Unraid workspace share, mounted as <code>/workspace</code>.</>
            : <>Subdirectory within <code>/projects</code></>}
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">Workspace Template</label>
        <select className="input" value={form.template}
          onChange={e => setForm(f => ({ ...f, template: e.target.value }))}>
          {(templates.length ? templates : [
            { id: 'claude-code', label: 'Work' },
            { id: 'private', label: 'Private' },
          ]).map(t => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
        <p className="form-hint">Private omits Claude Azure AI Foundry settings.</p>
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
  const parsed = parseAvatar(project.avatar, project.id);
  const [animated, setAnimated] = useState(parsed.animated);
  const [color, setColor] = useState(parsed.color);
  const [customColor, setCustomColor] = useState('');
  const [saving, setSaving] = useState(false);

  const initials = project.name.slice(0, 2).toUpperCase();

  async function save() {
    setSaving(true);
    const avatar = animated ? `animated:${animated.file}|${color}` : color;
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

      <div className="avatar-picker-preview">
        <div className="project-avatar avatar-preview-sm"
          style={{ background: color, fontSize: animated ? 13 : 13 }}>
          {animated ? <AnimatedEmojiImage option={animated} /> : initials}
        </div>
        <span className="avatar-preview-label">{project.name}</span>
      </div>

      <div className="avatar-section-title">Color</div>
      <div className="avatar-color-grid">
        {COLORS.map(c => (
          <button key={c} className={`avatar-color-swatch${color === c && !customColor ? ' selected' : ''}`}
            style={{ background: c }} onClick={() => { setColor(c); setCustomColor(''); }} aria-label={c} />
        ))}
        <label
          className={`avatar-color-swatch color-wheel-btn${customColor ? ' selected' : ''}`}
          htmlFor="sidebar-custom-color"
          aria-label="Custom color"
          title="Custom color"
        >
          <input
            id="sidebar-custom-color"
            type="color"
            value={customColor || color}
            onChange={e => { setCustomColor(e.target.value); setColor(e.target.value); }}
            tabIndex={-1}
          />
        </label>
      </div>

      <div className="avatar-section-title">Emoji</div>
      <div className="avatar-emoji-grid">
        {ANIMATED_EMOJIS.map(option => (
          <button
            key={option.file}
            type="button"
            className={`avatar-emoji-btn${animated?.file === option.file ? ' selected' : ''}`}
            onClick={() => setAnimated(prev => prev?.file === option.file ? null : option)}
            aria-label={option.label}
            title={option.label}
          >
            <AnimatedEmojiImage option={option} />
          </button>
        ))}
        {animated && (
          <button type="button" className="avatar-emoji-btn avatar-clear" onClick={() => setAnimated(null)}>✕</button>
        )}
      </div>

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
function ProjectContextMenu({ project, position, lifecycleBusy, onClose, onOpenAvatar, onLifecycle, navigate }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: position.x, top: position.y });
  useEffect(() => {
    function down(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    function key(e)  { if (e.key === 'Escape') onClose(); }
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown',   key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, []);

  // Keep the menu inside the viewport (flip/clamp near edges).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = position.x, top = position.y;
    if (left + r.width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - r.width - 8);
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - r.height - 8);
    setPos({ left, top });
  }, [position.x, position.y]);

  function go(path) { navigate(path); onClose(); }
  function runLifecycle(action) {
    onLifecycle(project, action);
    onClose();
  }

  const isBusy = lifecycleBusy === project.id;
  const isRunning = project.status === 'running' || project.status === 'starting';

  return createPortal(
    <div ref={ref} className="project-context-menu" style={{ left: pos.left, top: pos.top }} role="menu">
      <button role="menuitem" onClick={() => go(`/project/${project.id}`)}>Open</button>
      <button role="menuitem" onClick={() => go(`/project/${project.id}?tab=settings`)}>Workspace &amp; Logs</button>
      <button role="menuitem" onClick={() => go(`/project/${project.id}?tab=git`)}>Git</button>
      <div className="context-separator" />
      <button role="menuitem" onClick={() => runLifecycle('start')} disabled={isBusy || isRunning}>
        {isBusy && !isRunning ? 'Starting…' : 'Start Workspace'}
      </button>
      <button role="menuitem" onClick={() => runLifecycle('stop')} disabled={isBusy || !isRunning}>
        {isBusy && isRunning ? 'Stopping…' : 'Stop Workspace'}
      </button>
      <div className="context-separator" />
      <button role="menuitem" onClick={() => { onOpenAvatar(); onClose(); }}>Change Avatar</button>
    </div>,
    document.body
  );
}

/* ── Main sidebar ───────────────────────────────── */
export default function ProjectsSidebar() {
  const { id: activeId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { csrfToken } = useAuth();
  const { addToast } = useToast();
  const filesActive = location.pathname === '/files';

  const [projects, setProjects]   = useState([]);
  const [contextMenu, setContext] = useState(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(null);

  // Drag-to-reorder state
  const [dragId, setDragId]   = useState(null);
  const draggingRef = useRef(false);   // pause polling while a drag is in progress
  const projectsRef = useRef(projects); // always-fresh order for persistence on drop

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
  const [mode, setMode] = useState(() => document.documentElement.getAttribute('data-mode') || 'dark');
  useEffect(() => {
    const obs = new MutationObserver(() => setMode(document.documentElement.getAttribute('data-mode') || 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    return () => obs.disconnect();
  }, []);
  const isDark  = mode !== 'light';
  const logoSrc = isCollapsed ? (isDark ? '/mark-dark.svg' : '/mark-light.svg') : (isDark ? '/logo-dark.svg' : '/logo-light.svg');

  /* ── Project data ────────────────────────────── */
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const sock = getNotificationSocket();

    function onProjectAIState({ projectId, terminalCount, aiActive, aiWaiting, aiBusy }) {
      setProjects(prev => prev.map(project => (
        String(project.id) === String(projectId)
          ? { ...project, terminalCount, aiActive, aiWaiting, aiBusy }
          : project
      )));
    }

    sock.on('project:ai-state', onProjectAIState);
    return () => sock.off('project:ai-state', onProjectAIState);
  }, []);

  useEffect(() => {
    const sock = getNotificationSocket();

    function onProjectStatus({ id, status }) {
      setProjects(prev => prev.map(project => (
        String(project.id) === String(id) ? { ...project, status } : project
      )));
    }

    sock.on('project:status', onProjectStatus);
    return () => sock.off('project:status', onProjectStatus);
  }, []);

  async function load() {
    // Don't clobber the optimistic order mid-drag.
    if (draggingRef.current) return;
    try { const r = await fetch('/api/projects'); const d = await r.json(); setProjects(d.projects || []); } catch (_) {}
  }

  // Keep a fresh ref of the current order for persistence at drop time.
  useEffect(() => { projectsRef.current = projects; }, [projects]);

  /* ── Drag to reorder ─────────────────────────── */
  function handleDragStart(e, id) {
    setDragId(id);
    draggingRef.current = true;
    e.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(e, overId) {
    if (dragId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragId === overId) return;
    setProjects(prev => {
      const from = prev.findIndex(p => p.id === dragId);
      const to   = prev.findIndex(p => p.id === overId);
      if (from === -1 || to === -1 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function handleDragEnd() {
    const ordered = projectsRef.current;
    setDragId(null);
    draggingRef.current = false;
    try {
      await fetch('/api/projects/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ order: ordered.map(p => p.id) }),
      });
    } catch (_) {}
  }

  function handleCreated(p) { setProjects(prev => [...prev, p]); navigate(`/project/${p.id}`); }
  function handleAvatarSaved(pid, avatar) { setProjects(prev => prev.map(p => p.id === pid ? { ...p, avatar } : p)); }
  function handleContext(e, project) { e.preventDefault(); e.stopPropagation(); setContext({ project, x: e.clientX, y: e.clientY }); }

  async function runProjectLifecycle(project, action) {
    setLifecycleBusy(project.id);
    setProjects(prev => prev.map(p => (
      p.id === project.id ? { ...p, status: action === 'start' ? 'starting' : p.status } : p
    )));

    try {
      const r = await fetch(`/api/projects/${project.id}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (!d.success) {
        addToast(d.error || `${action === 'start' ? 'Start' : 'Stop'} failed.`, 'error');
        await load();
        return;
      }

      setProjects(prev => prev.map(p => (
        p.id === project.id ? { ...p, status: d.status || (action === 'stop' ? 'stopped' : 'running') } : p
      )));
      addToast(action === 'start' ? 'Workspace started.' : 'Workspace stopped.');
    } catch (e) {
      addToast(e.message || `${action === 'start' ? 'Start' : 'Stop'} failed.`, 'error');
      await load();
    } finally {
      setLifecycleBusy(null);
    }
  }

  /* ── Render ──────────────────────────────────── */
  return (
    <nav className={`projects-sidebar${isCollapsed ? ' collapsed' : ''}`}
         style={{ width, minWidth: width }} aria-label="Projects">

      <div className="sidebar-logo-area">
        <img src={logoSrc} alt="Opus Command" height={28} style={{ maxWidth: isCollapsed ? 32 : 160 }} />
      </div>

      <div className="sidebar-divider" />

      {/* File browser — not a project, kept separate at the top */}
      <button
        className={`sidebar-files-btn${filesActive ? ' active' : ''}`}
        onClick={() => navigate('/files')}
        title={isCollapsed ? 'File browser' : undefined}
      >
        <svg className="sidebar-files-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
        {!isCollapsed && <span className="sidebar-files-label">File browser</span>}
      </button>

      <div className="sidebar-divider" />

      <div className="sidebar-projects">
        {projects.length === 0 && !isCollapsed && <p className="sidebar-empty">No projects yet</p>}
        {projects.map(project => {
          const isActive = String(project.id) === String(activeId);
          const aiWaiting = (project.aiWaiting || 0) > 0;
          const aiActive = !aiWaiting && (project.aiActive || project.aiBusy || 0) > 0;
          return (
            <div key={project.id}
              data-id={project.id}
              draggable
              className={`sidebar-project-item${isActive ? ' active' : ''}${aiActive ? ' ai-active' : ''}${aiWaiting ? ' ai-waiting' : ''}${dragId === project.id ? ' dragging' : ''}`}
              onClick={() => navigate(`/project/${project.id}`)}
              onContextMenu={e => handleContext(e, project)}
              onDragStart={e => handleDragStart(e, project.id)}
              onDragOver={e => handleDragOver(e, project.id)}
              onDragEnd={handleDragEnd}
              title={isCollapsed ? project.name : undefined}
            >
              <div className="sidebar-avatar-wrap">
                <ProjectAvatar project={project} size={34} />
                <span className={`sidebar-status-dot status-${project.status}`} />
                {aiWaiting && <span className="sidebar-ai-dot" />}
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
        <SidebarPopover onClose={() => setNewProjectAnchor(null)}>
          <NewProjectForm
            csrfToken={csrfToken}
            onClose={() => setNewProjectAnchor(null)}
            onCreated={handleCreated}
          />
        </SidebarPopover>
      )}

      {/* Avatar picker popover */}
      {avatarTarget && (
        <SidebarPopover onClose={() => setAvatarTarget(null)} width={390}>
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
          lifecycleBusy={lifecycleBusy}
          onClose={() => setContext(null)}
          onOpenAvatar={() => setAvatarTarget({ project: contextMenu.project })}
          onLifecycle={runProjectLifecycle}
          navigate={navigate}
        />
      )}
    </nav>
  );
}
