import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import './ProjectDashboard.css';

const LIFECYCLE_ACTIONS = [
  { id: 'start',   label: 'Start',            danger: false, desc: 'Start the stopped workspace container. Nothing is deleted.' },
  { id: 'stop',    label: 'Stop',             danger: false, desc: 'Stop the running container. Sessions will be unavailable until restarted.' },
  { id: 'restart', label: 'Restart',          danger: false, desc: 'Stop and start the container. Nothing is deleted.' },
  { id: 'recreate',label: 'Recreate',         danger: true,  desc: 'Delete and recreate container from current image (no pull). Home volume (~) and project files are preserved.' },
  { id: 'rebuild', label: 'Rebuild',          danger: true,  desc: 'Pull latest template image then recreate. Home volume (~) and project files are preserved.' },
  { id: 'reset',   label: 'Reset Environment',danger: true,  desc: 'Wipe and recreate the home volume. Project files in /workspace are NOT touched.' },
];

function ConfirmModal({ title, description, confirmLabel, danger, onConfirm, onCancel }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-header">
          <h2 id="confirm-title" className="modal-title">{title}</h2>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 'var(--leading-normal)' }}>
            {description}
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { csrfToken } = useAuth();
  const { addToast } = useToast();

  const [project, setProject]       = useState(null);
  const [logs, setLogs]             = useState('');
  const [showLogs, setShowLogs]     = useState(false);
  const [loading, setLoading]       = useState(true);
  const [pendingAction, setPending] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [id]);

  async function load() {
    try {
      const r = await fetch(`/api/projects/${id}`);
      if (r.ok) setProject(await r.json());
      else navigate('/');
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function runAction(actionId) {
    setPending(null);
    setActionBusy(actionId);
    try {
      const r = await fetch(`/api/projects/${id}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ action: actionId }),
      });
      const d = await r.json();
      if (d.success) { addToast(`${actionId.charAt(0).toUpperCase() + actionId.slice(1)} complete.`); load(); }
      else addToast(d.error || 'Action failed.', 'error');
    } catch (e) {
      addToast(`Docker operation failed: ${e.message}`, 'error');
    } finally { setActionBusy(false); }
  }

  async function deleteProject() {
    setShowDelete(false);
    try {
      const r = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      if (r.ok) navigate('/');
      else addToast('Delete failed.', 'error');
    } catch { addToast('Delete failed.', 'error'); }
  }

  async function loadLogs() {
    try {
      const r = await fetch(`/api/projects/${id}/logs`);
      const d = await r.json();
      setLogs(d.logs || 'No logs yet.');
    } catch { setLogs('Failed to fetch logs.'); }
  }

  if (loading) return <div className="dash-loading">Loading…</div>;
  if (!project) return null;

  const isRunning = project.status === 'running';

  return (
    <div className="project-dashboard">
      {/* Quick-action cards */}
      <div className="dash-actions">
        <button
          className="dash-action-card primary"
          onClick={() => navigate(`/project/${id}/terminal`)}
          disabled={!isRunning}
          title={isRunning ? 'Open terminal' : 'Start the workspace first'}
        >
          <span className="dash-action-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
          </span>
          <span className="dash-action-label">Open Terminal</span>
          {!isRunning && <span className="dash-action-hint">Start workspace first</span>}
        </button>

        <button
          className="dash-action-card"
          onClick={() => navigate(`/project/${id}/files`)}
        >
          <span className="dash-action-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
              <polyline points="13 2 13 9 20 9"/>
            </svg>
          </span>
          <span className="dash-action-label">Browse Files</span>
        </button>

        <button
          className="dash-action-card"
          onClick={() => navigate(`/project/${id}/git`)}
        >
          <span className="dash-action-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"/>
              <circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
              <path d="M18 9a9 9 0 0 1-9 9"/>
            </svg>
          </span>
          <span className="dash-action-label">Git</span>
          {project.gitBranch && (
            <span className="dash-action-hint">{project.gitBranch}{project.changedFiles > 0 ? ` · ${project.changedFiles} changed` : ''}</span>
          )}
        </button>
      </div>

      {/* Stats row */}
      <div className="dash-stats">
        <div className="dash-stat">
          <span className="dash-stat-label">Folder</span>
          <span className="dash-stat-value mono">/projects/{project.folderPath}</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-label">Template</span>
          <span className="dash-stat-value">{project.template}</span>
        </div>
        <div className="dash-stat">
          <span className="dash-stat-label">Terminals</span>
          <span className="dash-stat-value">{project.terminalCount || 0}</span>
        </div>
      </div>

      {/* Workspace controls */}
      <div className="dash-section">
        <div className="dash-section-title">WORKSPACE</div>
        <div className="dash-lifecycle">
          {LIFECYCLE_ACTIONS.map(a => (
            <button
              key={a.id}
              className={`btn btn-ghost${a.danger ? ' dash-danger' : ''}`}
              onClick={() => setPending(a)}
              disabled={!!actionBusy}
            >
              {actionBusy === a.id ? `${a.label}ing…` : a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Container logs */}
      <div className="dash-section">
        <div className="dash-section-header">
          <div className="dash-section-title">CONTAINER LOGS</div>
          <button className="btn btn-ghost" onClick={() => { setShowLogs(s => !s); if (!showLogs) loadLogs(); }}>
            {showLogs ? 'Hide' : 'Show'}
          </button>
        </div>
        {showLogs && (
          <div className="dash-logs">
            <pre>{logs}</pre>
          </div>
        )}
      </div>

      {/* Recent activity */}
      {project.activity?.length > 0 && (
        <div className="dash-section">
          <div className="dash-section-title">RECENT ACTIVITY</div>
          <div className="dash-activity">
            {project.activity.map((item, i) => (
              <div key={i} className="dash-activity-row">
                <span className="dash-activity-msg">{item.message}</span>
                <span className="dash-activity-time">{new Date(item.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Delete */}
      <div className="dash-section">
        <button className="btn btn-danger" onClick={() => setShowDelete(true)}>Delete Project</button>
        <p className="dash-delete-hint">Removes the workspace container. Project files on disk are not deleted.</p>
      </div>

      {/* Modals */}
      {pendingAction && (
        <ConfirmModal
          title={pendingAction.label}
          description={pendingAction.desc}
          confirmLabel={pendingAction.label}
          danger={pendingAction.danger}
          onConfirm={() => runAction(pendingAction.id)}
          onCancel={() => setPending(null)}
        />
      )}
      {showDelete && (
        <ConfirmModal
          title="Delete Project"
          description="Delete project? The project folder will not be deleted."
          confirmLabel="Delete Project"
          danger
          onConfirm={deleteProject}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}
