import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Projects.css';

const TEMPLATES = [
  { id: 'general', label: 'General Development' },
  { id: 'nodejs', label: 'Node.js Development' },
  { id: 'python', label: 'Python Development' },
  { id: 'powershell', label: 'PowerShell Development' },
];

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
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ name: '', folder: '', template: 'general' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (step < 3) return setStep(s => s + 1);

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
          <div className="modal-steps">Step {step} of 3</div>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="form-group">
              <label className="form-label" htmlFor="proj-name">Project Name</label>
              <input
                id="proj-name"
                className="input"
                autoFocus
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="My Project"
              />
            </div>
          )}
          {step === 2 && (
            <div className="form-group">
              <label className="form-label" htmlFor="proj-folder">Project Folder</label>
              <input
                id="proj-folder"
                className="input"
                autoFocus
                value={form.folder}
                onChange={e => setForm(f => ({ ...f, folder: e.target.value }))}
                placeholder="my-project"
              />
              <p className="form-hint">Subdirectory path within <code>/projects</code></p>
            </div>
          )}
          {step === 3 && (
            <div className="form-group">
              <label className="form-label">Workspace Template</label>
              <div className="radio-group">
                {TEMPLATES.map(t => (
                  <label key={t.id} className="radio-option">
                    <input
                      type="radio"
                      name="template"
                      value={t.id}
                      checked={form.template === t.id}
                      onChange={() => setForm(f => ({ ...f, template: t.id }))}
                    />
                    <span>{t.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="error-message">{error}</p>}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={step > 1 ? () => setStep(s => s - 1) : onClose}>
            {step > 1 ? 'Back' : 'Cancel'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || (step === 1 && !form.name) || (step === 2 && !form.folder)}
          >
            {loading ? 'Creating…' : step === 3 ? 'Create Project' : 'Next'}
          </button>
        </div>
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
