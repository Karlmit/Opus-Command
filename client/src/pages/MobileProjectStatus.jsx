import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './MobileProjectStatus.css';

function StatusPill({ status }) {
  const label = { running: 'Running', starting: 'Starting', stopped: 'Stopped', error: 'Error' }[status] || status;
  return (
    <span className={`badge-status status-${status}`} aria-label={`Workspace status: ${label}`}>
      <span className="badge-status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export default function MobileProjectStatus({ projectId }) {
  const { csrfToken } = useAuth();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    fetchProject();
    const interval = setInterval(fetchProject, 5000);
    return () => clearInterval(interval);
  }, [projectId]);

  async function fetchProject() {
    try {
      const res = await fetch(`/api/projects/${projectId}`);
      if (res.ok) setProject(await res.json());
    } catch (_) {}
    finally { setLoading(false); }
  }

  if (loading || !project) return null;

  return (
    <div className="mobile-status-card">
      <div className="msc-name">{project.name}</div>
      <StatusPill status={project.status} />
      <div className="msc-divider" />
      <div className="msc-stats">
        <div className="msc-stat">
          <span className="msc-stat-icon">⎇</span>
          <span>{project.gitBranch || '—'}</span>
          {project.changedFiles > 0 && <span className="msc-changed">· {project.changedFiles} changed</span>}
        </div>
        <div className="msc-stat">
          <span className="msc-stat-icon">▶</span>
          <span>{project.terminalCount || 0} terminals</span>
        </div>
        {project.aiCount > 0 && (
          <div className="msc-stat">
            <span
              className="badge-ai"
              aria-live="polite"
              aria-atomic="true"
              onClick={() => navigate(`/project/${projectId}/terminal`)}
            >
              {project.aiWaiting > 0 ? `${project.aiWaiting} waiting` : `${project.aiCount} active`}
            </span>
          </div>
        )}
      </div>
      <div className="msc-divider" />
      <button
        className="msc-open-terminal btn btn-primary"
        onClick={() => navigate(`/project/${projectId}/terminal`)}
      >
        Open Terminal
      </button>
    </div>
  );
}
