import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './ProjectDashboard.css';

function StatusPill({ status }) {
  const label = { running: 'Running', starting: 'Starting', stopped: 'Stopped', error: 'Error' }[status] || status;
  return (
    <span className={`badge-status status-${status}`} aria-label={`Workspace status: ${label}`}>
      <span className="badge-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function ConfirmModal({ title, description, confirmLabel = 'Confirm', onConfirm, onCancel, danger = true }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-header">
          <h2 id="confirm-title" className="modal-title">{title}</h2>
        </div>
        <div className="modal-body">
          <p className="confirm-description">{description}</p>
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

const LIFECYCLE_ACTIONS = [
  {
    id: 'start',
    label: 'Start',
    description: 'Start the stopped workspace container.',
    destroys: 'Nothing is deleted.',
    danger: false,
  },
  {
    id: 'stop',
    label: 'Stop',
    description: 'Stop the running workspace container.',
    destroys: 'Nothing is deleted. Sessions will be unavailable until restarted.',
    danger: false,
  },
  {
    id: 'restart',
    label: 'Restart',
    description: 'Stop and start the workspace container.',
    destroys: 'Nothing is deleted.',
    danger: false,
  },
  {
    id: 'recreate',
    label: 'Recreate',
    description: 'Delete and recreate the container from the current image (no new image pull).',
    destroys: 'Container only. Home volume (~) and project files are preserved.',
    danger: true,
  },
  {
    id: 'rebuild',
    label: 'Rebuild',
    description: 'Pull the latest workspace template image and recreate the container.',
    destroys: 'Container only. Home volume (~) and project files are preserved.',
    danger: true,
  },
  {
    id: 'reset',
    label: 'Reset Environment',
    description: 'Wipe and recreate the home volume (~). All installed tools and configurations will be lost.',
    destroys: 'Home volume (~). Project files in /workspace are NOT touched.',
    danger: true,
  },
];

export default function ProjectDashboard() {
  const params = useParams();
  const id = params.id;
  const navigate = useNavigate();
  const { csrfToken } = useAuth();

  const [project, setProject] = useState(null);
  const [logs, setLogs] = useState('');
  const [loading, setLoading] = useState(true);
  const [actionInFlight, setActionInFlight] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchProject();
    const interval = setInterval(fetchProject, 5000);
    return () => clearInterval(interval);
  }, [id]);

  async function fetchProject() {
    try {
      const res = await fetch(`/api/projects/${id}`);
      if (!res.ok) { navigate('/'); return; }
      const data = await res.json();
      setProject(data);
    } catch {
      setError('Could not connect to workspace container. Check that Docker is running.');
    } finally {
      setLoading(false);
    }
  }

  async function fetchLogs() {
    try {
      const res = await fetch(`/api/projects/${id}/logs`);
      const data = await res.json();
      setLogs(data.logs || 'No logs yet.');
    } catch {
      setLogs('Failed to fetch logs.');
    }
  }

  async function performAction(actionId) {
    setPendingAction(null);
    setActionInFlight(actionId);
    setError('');
    try {
      const res = await fetch(`/api/projects/${id}/lifecycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ action: actionId }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchProject();
      } else {
        setError(data.error || 'Action failed.');
      }
    } catch (err) {
      setError(`Docker operation failed: ${err.message}`);
    } finally {
      setActionInFlight(null);
    }
  }

  async function deleteProject() {
    setShowDelete(false);
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      if (res.ok) navigate('/');
      else {
        const data = await res.json();
        setError(data.error || 'Delete failed.');
      }
    } catch (err) {
      setError(`Failed to delete project: ${err.message}`);
    }
  }

  if (loading) return (
    <div className="project-loading">Loading…</div>
  );

  if (!project) return (
    <div className="project-loading">Project not found.</div>
  );

  return (
    <div className="project-dashboard">
      {/* Header */}
      <div className="project-header">
        <div className="project-header-left">
          <button className="btn btn-ghost project-back" onClick={() => navigate(-1)}>←</button>
          <h1 className="project-title">{project.name}</h1>
          <StatusPill status={project.status} />
        </div>
        <button className="btn btn-danger" onClick={() => setShowDelete(true)}>Delete Project</button>
      </div>

      {error && <div className="project-error" role="alert">{error}</div>}

      <div className="project-content">
        {/* Overview */}
        <div className="project-panel">
          <div className="project-panel-title">OVERVIEW</div>
          <div className="project-stats">
            <div className="stat">
              <span className="stat-label">Template</span>
              <span className="stat-value">{project.template}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Folder</span>
              <span className="stat-value font-mono">/projects/{project.folderPath}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Git Branch</span>
              <span className="stat-value font-mono">{project.gitBranch || '—'}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Changed Files</span>
              <span className="stat-value">{project.changedFiles || 0}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Terminals</span>
              <span className="stat-value">{project.terminalCount || 0}</span>
            </div>
          </div>
        </div>

        {/* Workspace Lifecycle */}
        <div className="project-panel">
          <div className="project-panel-title">WORKSPACE</div>
          <div className="lifecycle-actions">
            {LIFECYCLE_ACTIONS.map(action => (
              <button
                key={action.id}
                className={`btn ${action.danger ? 'btn-ghost lifecycle-danger' : 'btn-ghost'}`}
                onClick={() => setPendingAction(action)}
                disabled={!!actionInFlight}
              >
                {actionInFlight === action.id ? `${action.label}ing…` : action.label}
              </button>
            ))}
          </div>
        </div>

        {/* Container Logs */}
        <div className="project-panel">
          <div className="project-panel-header">
            <div className="project-panel-title">CONTAINER LOGS</div>
            <button
              className="btn btn-ghost"
              onClick={() => { setShowLogs(s => !s); if (!showLogs) fetchLogs(); }}
            >
              {showLogs ? 'Hide' : 'Show'}
            </button>
          </div>
          {showLogs && (
            <div className="container-logs">
              <pre className="logs-content">{logs || 'No logs yet.'}</pre>
            </div>
          )}
        </div>

        {/* Recent Activity */}
        {project.activity && project.activity.length > 0 && (
          <div className="project-panel">
            <div className="project-panel-title">RECENT ACTIVITY</div>
            <div className="activity-list">
              {project.activity.map((item, i) => (
                <div key={i} className="activity-item">
                  <span className="activity-message">{item.message}</span>
                  <span className="activity-time">{new Date(item.createdAt).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Confirmation modals */}
      {pendingAction && (
        <ConfirmModal
          title={pendingAction.label}
          description={`${pendingAction.description}\n\n${pendingAction.destroys}`}
          confirmLabel={pendingAction.label}
          danger={pendingAction.danger}
          onConfirm={() => performAction(pendingAction.id)}
          onCancel={() => setPendingAction(null)}
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
