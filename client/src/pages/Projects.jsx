import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Projects.css';

function StatusPill({ status }) {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={`badge-status status-${status}`} aria-label={`Workspace status: ${label}`}>
      <span className="badge-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function NewProjectModal({ onClose, onCreated }) {
  const { csrfToken } = useAuth();
  const [form, setForm] = useState({ name: '', folder: '', template: 'claude-code' });
  const [templates, setTemplates] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/projects/templates')
      .then(r => r.json())
      .then(data => setTemplates(data.templates || []))
      .catch(() => {});
  }, []);

  // Auto-fill folder from name
  function handleNameChange(name) {
    const folder = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setForm(f => ({ ...f, name, folder: f.folder || folder }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('Project name is required.');
    if (!form.folder.trim()) return setError('Project folder is required.');

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (data.id) {
        onCreated(data);
        onClose();
      } else {
        setError(data.error || 'Failed to create project.');
      }
    } catch {
      setError('An error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">New Project</h2>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="form-group">
              <label className="form-label" htmlFor="proj-name">Project Name</label>
              <input
                id="proj-name"
                className="input"
                autoFocus
                value={form.name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder="My Project"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="proj-folder">Project Folder</label>
              <input
                id="proj-folder"
                className="input"
                value={form.folder}
                onChange={e => setForm(f => ({ ...f, folder: e.target.value }))}
                placeholder="my-project"
              />
              <p className="form-hint">Subdirectory within <code>/projects</code> — created automatically</p>
            </div>
            <div className="form-group">
              <label className="form-label">Workspace Template</label>
              <div className="template-options">
                {(templates.length ? templates : [
                  { id: 'claude-code', label: 'Work', description: 'Claude Code with Azure AI Foundry settings.' },
                  { id: 'private', label: 'Private', description: 'Claude Code and Codex CLI without Azure AI Foundry settings.' },
                ]).map(template => (
                  <label key={template.id} className={`template-option${form.template === template.id ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="workspace-template"
                      value={template.id}
                      checked={form.template === template.id}
                      onChange={e => setForm(f => ({ ...f, template: e.target.value }))}
                    />
                    <span className="template-option-copy">
                      <span className="template-option-label">{template.label}</span>
                      <span className="template-option-desc">{template.description}</span>
                    </span>
                  </label>
                ))}
              </div>
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

export default function Projects() {
  const { csrfToken } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then(data => setProjects(data.projects || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(project) {
    setProjects(prev => [...prev, project]);
  }

  if (loading) {
    return (
      <div className="projects-loading">
        <span className="projects-loading-text">Loading…</span>
      </div>
    );
  }

  return (
    <div className="projects-page">
      <div className="projects-header">
        <h1 className="projects-title">PROJECTS</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="projects-empty">
          <p className="projects-empty-text">No projects yet. Create your first project to get started.</p>
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>New Project</button>
        </div>
      ) : (
        <div className="projects-grid">
          {projects.map(project => (
            <div
              key={project.id}
              className="project-card"
              onClick={() => navigate(`/project/${project.id}`)}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && navigate(`/project/${project.id}`)}

            >
              <div className="project-card-header">
                <span className="project-card-name truncate">{project.name}</span>
                <StatusPill status={project.status || 'stopped'} />
              </div>
              <div className="project-card-meta">
                <span className="project-card-stat">
                  {project.terminalCount || 0} terminals
                </span>
                {(project.aiWaiting > 0) && (
                  <span className="badge-ai project-card-ai-badge" aria-live="polite">
                    {project.aiWaiting} waiting
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <NewProjectModal onClose={() => setShowModal(false)} onCreated={handleCreated} />
      )}
    </div>
  );
}
