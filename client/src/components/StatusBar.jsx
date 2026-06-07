import './StatusBar.css';

export default function StatusBar({ workspaceStatus = 'stopped', gitBranch = null, changedFiles = 0, aiCount = 0, aiWaiting = 0, terminalCount = 0 }) {
  const statusColors = {
    running: 'var(--color-success)',
    starting: 'var(--color-warning)',
    stopped: 'var(--color-text-tertiary)',
    error: 'var(--color-error)',
  };
  const dotColor = statusColors[workspaceStatus] || statusColors.stopped;

  return (
    <div className="status-bar" role="status" aria-label="Application status">
      <div className="status-bar-left">
        <span
          className={`status-bar-dot${workspaceStatus === 'starting' ? ' pulsing' : ''}`}
          style={{ background: dotColor }}
          aria-hidden="true"
        />
        <span className="status-bar-text" aria-label={`Workspace status: ${workspaceStatus}`}>
          {workspaceStatus.charAt(0).toUpperCase() + workspaceStatus.slice(1)}
        </span>

        {gitBranch && (
          <>
            <span className="status-bar-sep" aria-hidden="true" />
            <span className="status-bar-branch">{gitBranch}</span>
            {changedFiles > 0 && (
              <span className="status-bar-text status-bar-changes">· {changedFiles} changed</span>
            )}
          </>
        )}
      </div>

      <div className="status-bar-right">
        {aiWaiting > 0 && (
          <span className="badge-ai status-bar-ai-badge" aria-live="polite" aria-atomic="true">
            {aiWaiting} waiting
          </span>
        )}
        {aiCount > 0 && aiWaiting === 0 && (
          <span className="status-bar-text">{aiCount} active</span>
        )}
        {terminalCount > 0 && (
          <span className="status-bar-text">{terminalCount} terminal{terminalCount !== 1 ? 's' : ''}</span>
        )}
      </div>
    </div>
  );
}
