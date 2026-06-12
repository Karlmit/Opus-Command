import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getNotificationSocket } from '../context/NotificationsContext';
import './StatusBar.css';

const STATUS_COLORS = {
  running: 'var(--color-success)',
  starting: 'var(--color-warning)',
  stopped: 'var(--color-text-tertiary)',
  error: 'var(--color-error)',
};

const STATUS_LABELS = {
  running: 'Running',
  starting: 'Starting',
  stopped: 'Stopped',
  error: 'Error',
};

export default function StatusBar() {
  const location = useLocation();
  const match = location.pathname.match(/^\/project\/([^/]+)/);
  const projectId = match ? match[1] : null;

  const [version, setVersion] = useState(null);
  const [project, setProject] = useState(null);

  // App version — once.
  useEffect(() => {
    let alive = true;
    fetch('/api/settings/version')
      .then(r => r.json())
      .then(d => { if (alive) setVersion(d.version || null); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Active project status — poll (same endpoint the sidebar uses) + live socket updates.
  useEffect(() => {
    if (!projectId) { setProject(null); return; }
    let alive = true;

    async function load() {
      try {
        const r = await fetch('/api/projects');
        const d = await r.json();
        const p = (d.projects || []).find(x => String(x.id) === String(projectId));
        if (alive) setProject(p || null);
      } catch (_) { /* keep last known */ }
    }
    load();
    const poll = setInterval(load, 5000);

    const sock = getNotificationSocket();
    function onAIState({ projectId: pid, terminalCount, aiActive, aiWaiting, aiBusy }) {
      if (String(pid) !== String(projectId)) return;
      setProject(prev => (prev ? { ...prev, terminalCount, aiActive, aiWaiting, aiBusy } : prev));
    }
    sock.on('project:ai-state', onAIState);

    return () => { alive = false; clearInterval(poll); sock.off('project:ai-state', onAIState); };
  }, [projectId]);

  const status = projectId ? (project?.status || 'stopped') : null;
  const dotColor = STATUS_COLORS[status] || STATUS_COLORS.stopped;
  const aiWaiting = project?.aiWaiting || 0;
  const aiActive = project?.aiActive || project?.aiBusy || 0;
  const terminalCount = project?.terminalCount || 0;

  return (
    <div className="status-bar" role="status" aria-label="Application status">
      <div className="status-bar-left">
        {status ? (
          <>
            <span
              className={`status-bar-dot${status === 'starting' ? ' pulsing' : ''}`}
              style={{ background: dotColor }}
              aria-hidden="true"
            />
            <span className="status-bar-text" aria-label={`Workspace status: ${status}`}>
              {STATUS_LABELS[status] || status}
            </span>
            {project?.name && (
              <>
                <span className="status-bar-sep" aria-hidden="true" />
                <span className="status-bar-project">{project.name}</span>
              </>
            )}
          </>
        ) : (
          <span className="status-bar-text status-bar-idle">No workspace selected</span>
        )}
      </div>

      <div className="status-bar-right">
        {aiWaiting > 0 && (
          <span className="badge-ai status-bar-ai-badge" aria-live="polite" aria-atomic="true">
            {aiWaiting} waiting
          </span>
        )}
        {aiActive > 0 && aiWaiting === 0 && (
          <span className="status-bar-text">{aiActive} AI active</span>
        )}
        {terminalCount > 0 && (
          <span className="status-bar-text">{terminalCount} terminal{terminalCount !== 1 ? 's' : ''}</span>
        )}
        {version && (
          <span className="status-bar-version" aria-label={`App version ${version}`}>
            {version.startsWith('v') ? version : `v${version}`}
          </span>
        )}
      </div>
    </div>
  );
}
