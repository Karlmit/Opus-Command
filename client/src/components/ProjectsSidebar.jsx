import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import AvatarPicker from './AvatarPicker';
import './ProjectsSidebar.css';

const EMOJI_LIST = ['🚀','💡','🔥','⚡','🎯','🛠️','🌊','🦋','🌙','⭐','💎','🎮','🧩','🔮','🐉','🌿'];
const COLOR_LIST = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#22c55e','#06b6d4','#3b82f6'];

function projectColor(id) {
  return COLOR_LIST[(id - 1) % COLOR_LIST.length];
}

function ProjectAvatar({ project, size = 36, onClick }) {
  const avatar = project.avatar || '';
  const isEmoji = avatar && !avatar.startsWith('#');
  const color = isEmoji ? projectColor(project.id) : (avatar || projectColor(project.id));
  const initials = project.name.slice(0, 2).toUpperCase();

  return (
    <div
      className="project-avatar"
      style={{ width: size, height: size, background: color, cursor: onClick ? 'pointer' : 'default' }}
      onClick={onClick}
      title={onClick ? 'Change avatar' : project.name}
    >
      {isEmoji ? avatar : initials}
    </div>
  );
}

function StatusDot({ status }) {
  return <span className={`sidebar-status-dot status-${status}`} aria-hidden="true" />;
}

function NewProjectModal({ onClose, onCreated, csrfToken }) {
  const [form, setForm] = useState({ name: '', folder: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function handleNameChange(name) {
    const folder = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setForm(f => ({ ...f, name, folder: f.folder || folder }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('Project name is required.');
    if (!form.folder.trim()) return setError('Project folder is required.');
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.id) { onCreated(data); onClose(); }
      else setError(data.error || 'Failed to create project.');
    } catch { setError('An error occurred.'); }
    finally { setLoading(false); }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="np-title">
        <div className="modal-header">
          <h2 id="np-title" className="modal-title">New Project</h2>
        </div>
        <form onSubmit={handleSubmit}>
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

export default function ProjectsSidebar() {
  const { id: activeId } = useParams();
  const navigate = useNavigate();
  const { csrfToken, user } = useAuth();
  const { addToast } = useToast();

  const [projects, setProjects] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [avatarTarget, setAvatarTarget] = useState(null); // project being edited

  useEffect(() => {
    loadProjects();
    const t = setInterval(loadProjects, 5000);
    return () => clearInterval(t);
  }, []);

  async function loadProjects() {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (_) {}
  }

  function handleCreated(project) {
    setProjects(prev => [...prev, project]);
    navigate(`/project/${project.id}`);
  }

  async function handleAvatarSave(projectId, avatar) {
    setAvatarTarget(null);
    await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ avatar }),
    });
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, avatar } : p));
  }

  const initials = user?.username?.slice(0, 2).toUpperCase() || '?';

  return (
    <nav className="projects-sidebar" aria-label="Projects">
      {/* Logo */}
      <div className="sidebar-logo-area">
        <img src="/mark-dark.svg" alt="Opus Command" width="26" height="26" />
      </div>

      <div className="sidebar-divider" />

      {/* Project list */}
      <div className="sidebar-projects">
        {projects.map(project => {
          const isActive = String(project.id) === String(activeId);
          return (
            <div
              key={project.id}
              className={`sidebar-project-item${isActive ? ' active' : ''}`}
              onClick={() => navigate(`/project/${project.id}`)}
              title={project.name}
            >
              <div className="sidebar-project-avatar-wrap">
                <ProjectAvatar
                  project={project}
                  size={36}
                  onClick={isActive ? (e) => { e.stopPropagation(); setAvatarTarget(project); } : null}
                />
                <StatusDot status={project.status} />
                {project.aiWaiting > 0 && (
                  <span className="sidebar-ai-dot" aria-label="AI waiting" />
                )}
              </div>
              <div className="sidebar-project-meta">
                <span className="sidebar-project-name">{project.name}</span>
                <span className="sidebar-project-status">{project.status}</span>
              </div>
            </div>
          );
        })}

        {projects.length === 0 && (
          <p className="sidebar-empty">No projects yet</p>
        )}
      </div>

      <div className="sidebar-spacer" />

      {/* New project button */}
      <button
        className="sidebar-new-project"
        onClick={() => setShowNew(true)}
        title="New project"
        aria-label="New project"
      >
        <span className="sidebar-new-icon">+</span>
        <span className="sidebar-new-label">New project</span>
      </button>

      <div className="sidebar-divider" />

      {/* Settings */}
      <button
        className="sidebar-settings"
        onClick={() => navigate('/settings')}
        title="Settings"
        aria-label="Settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>

      {/* User avatar */}
      <div className="sidebar-user" title={user?.username}>
        {initials}
      </div>

      {/* Modals */}
      {showNew && (
        <NewProjectModal
          csrfToken={csrfToken}
          onClose={() => setShowNew(false)}
          onCreated={handleCreated}
        />
      )}

      {avatarTarget && (
        <AvatarPicker
          project={avatarTarget}
          onSave={(avatar) => handleAvatarSave(avatarTarget.id, avatar)}
          onClose={() => setAvatarTarget(null)}
        />
      )}
    </nav>
  );
}

export { ProjectAvatar };
