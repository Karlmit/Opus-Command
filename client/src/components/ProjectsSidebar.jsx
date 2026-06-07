import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import './ProjectsSidebar.css';

/* ── Avatar helpers ─────────────────────────────── */
const COLORS = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#22c55e','#06b6d4','#3b82f6','#64748b','#92400e'];
const EMOJIS = ['🚀','💡','🔥','⚡','🎯','🛠️','🌊','🦋','🌙','⭐','💎','🎮','🧩','🔮','🐉','🌿','🎨','🤖'];

function defaultColor(id) { return COLORS[(id - 1) % COLORS.length]; }

export function ProjectAvatar({ project, size = 36, onClick }) {
  const avatar = project.avatar || '';
  const isEmoji = avatar.length > 0 && !avatar.startsWith('#');
  const bgColor = isEmoji ? defaultColor(project.id) : (avatar || defaultColor(project.id));
  const initials = (project.name || '?').slice(0, 2).toUpperCase();

  return (
    <div
      className="project-avatar"
      style={{ width: size, height: size, minWidth: size, background: bgColor, cursor: onClick ? 'pointer' : 'default', fontSize: isEmoji ? size * 0.5 : size * 0.35 }}
      onClick={onClick}
      title={project.name}
    >
      {isEmoji ? avatar : initials}
    </div>
  );
}

/* ── Avatar Picker ──────────────────────────────── */
function AvatarPicker({ project, csrfToken, onSaved, onClose }) {
  // Keep emoji and color as separate state so picking one doesn't reset the other
  const existing = project.avatar || '';
  const [emoji, setEmoji]   = useState(existing.startsWith('#') || !existing ? '' : existing);
  const [color, setColor]   = useState(existing.startsWith('#') ? existing : defaultColor(project.id));
  const [mode, setMode]     = useState(existing.startsWith('#') || !existing ? 'color' : 'emoji');
  const [saving, setSaving] = useState(false);

  // Preview
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
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal avatar-picker-modal" role="dialog" aria-modal="true" aria-labelledby="ap-title">
        <div className="modal-header">
          <h2 id="ap-title" className="modal-title">Project avatar</h2>
        </div>
        <div className="modal-body">
          {/* Preview */}
          <div className="avatar-preview-row">
            <div className="project-avatar avatar-preview-large"
              style={{ background: previewColor, fontSize: previewAvatar ? 28 : 18 }}>
              {previewAvatar || project.name.slice(0, 2).toUpperCase()}
            </div>
            <span className="avatar-preview-name">{project.name}</span>
          </div>

          {/* Mode toggle */}
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
                  onClick={() => setEmoji(prev => prev === e ? '' : e)}>
                  {e}
                </button>
              ))}
              {emoji && <button className="avatar-emoji-btn avatar-clear" onClick={() => setEmoji('')}>✕ Clear</button>}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

/* ── New project modal ──────────────────────────── */
function NewProjectModal({ csrfToken, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', folder: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      else setError(d.error || 'Failed.');
    } catch { setError('An error occurred.'); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="np-title">
        <div className="modal-header"><h2 id="np-title" className="modal-title">New Project</h2></div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label">Project Name</label>
              <input className="input" autoFocus value={form.name}
                onChange={e => handleNameChange(e.target.value)} placeholder="My Project" />
            </div>
            <div className="form-group">
              <label className="form-label">Project Folder</label>
              <input className="input" value={form.folder}
                onChange={e => setForm(f => ({ ...f, folder: e.target.value }))} placeholder="my-project" />
              <p className="form-hint">Subdirectory within <code>/projects</code></p>
            </div>
            {error && <p className="error-message">{error}</p>}
          </div>
          <div className="modal-footer">
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={loading || !form.name || !form.folder}>
              {loading ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Context menu ───────────────────────────────── */
function ProjectContextMenu({ project, position, onClose, onOpenAvatar, navigate }) {
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) onClose(); }
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', e => e.key === 'Escape' && onClose());
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function go(path) { navigate(path); onClose(); }

  return (
    <div ref={ref} className="project-context-menu" style={{ top: position.y, left: position.x }} role="menu">
      <button role="menuitem" onClick={() => go(`/project/${project.id}`)}>Open</button>
      <button role="menuitem" onClick={() => go(`/project/${project.id}?tab=settings`)}>Settings &amp; Logs</button>
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
  const { addToast } = useToast();

  const [projects, setProjects]     = useState([]);
  const [showNew, setShowNew]       = useState(false);
  const [avatarTarget, setAvatar]   = useState(null);
  const [contextMenu, setContext]   = useState(null); // { project, x, y }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  async function load() {
    try {
      const r = await fetch('/api/projects');
      const d = await r.json();
      setProjects(d.projects || []);
    } catch (_) {}
  }

  function handleCreated(p) {
    setProjects(prev => [...prev, p]);
    navigate(`/project/${p.id}`);
  }

  function handleAvatarSaved(projectId, avatar) {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, avatar } : p));
  }

  function handleContext(e, project) {
    e.preventDefault();
    e.stopPropagation();
    setContext({ project, x: e.clientX, y: e.clientY });
  }

  return (
    <nav className="projects-sidebar" aria-label="Projects">
      {/* Horizontal logo */}
      <div className="sidebar-logo-area" onClick={() => navigate('/')} title="Opus Command" role="button" tabIndex={0}>
        <img src="/logo-dark.svg" alt="Opus Command" height="28" style={{ maxWidth: 160 }} />
      </div>

      <div className="sidebar-divider" />

      {/* Project list */}
      <div className="sidebar-projects">
        {projects.length === 0 && (
          <p className="sidebar-empty">No projects yet</p>
        )}
        {projects.map(project => {
          const isActive = String(project.id) === String(activeId);
          return (
            <div
              key={project.id}
              className={`sidebar-project-item${isActive ? ' active' : ''}`}
              onClick={() => navigate(`/project/${project.id}`)}
              onContextMenu={e => handleContext(e, project)}
              title={project.name}
            >
              <div className="sidebar-avatar-wrap">
                <ProjectAvatar
                  project={project}
                  size={34}
                  onClick={isActive ? e => { e.stopPropagation(); setAvatar(project); } : null}
                />
                <span className={`sidebar-status-dot status-${project.status}`} />
                {project.aiWaiting > 0 && <span className="sidebar-ai-dot" />}
              </div>
              <div className="sidebar-project-meta">
                <span className="sidebar-project-name">{project.name}</span>
                <span className="sidebar-project-status">{project.status}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sidebar-spacer" />

      {/* New project */}
      <button className="sidebar-new-project" onClick={() => setShowNew(true)}>
        <span className="sidebar-new-icon">+</span>
        <span className="sidebar-new-label">New project</span>
      </button>

      <div className="sidebar-divider" />

      {/* Settings */}
      <button className="sidebar-settings-btn" onClick={() => navigate('/settings')} title="Settings">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span className="sidebar-settings-label">Settings</span>
      </button>

      {/* Modals */}
      {showNew && (
        <NewProjectModal csrfToken={csrfToken} onClose={() => setShowNew(false)} onCreated={handleCreated} />
      )}
      {avatarTarget && (
        <AvatarPicker
          project={avatarTarget}
          csrfToken={csrfToken}
          onSaved={avatar => handleAvatarSaved(avatarTarget.id, avatar)}
          onClose={() => setAvatar(null)}
        />
      )}
      {contextMenu && (
        <ProjectContextMenu
          project={contextMenu.project}
          position={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContext(null)}
          onOpenAvatar={() => setAvatar(contextMenu.project)}
          navigate={navigate}
        />
      )}
    </nav>
  );
}
