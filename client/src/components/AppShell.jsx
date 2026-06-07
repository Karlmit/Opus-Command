import { Outlet, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import MobileNav from './MobileNav';
import './AppShell.css';

export default function AppShell({
  projectId,
  projectName,
  workspaceStatus = 'stopped',
  gitBranch,
  changedFiles = 0,
  aiCount = 0,
  aiWaiting = 0,
  terminalCount = 0,
}) {
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      {/* Left icon rail — hidden on mobile */}
      <Sidebar projectId={projectId} projectName={projectName} />

      {/* Right side: everything else */}
      <div className="app-body">
        {/* Top bar — only shown inside a project */}
        {projectId && (
          <div className="app-top-bar">
            <button
              className="top-bar-back"
              onClick={() => navigate('/')}
              title="All projects"
              aria-label="Back to projects"
            >
              ←
            </button>
            <span className="top-bar-name">{projectName || 'Project'}</span>
            {workspaceStatus && (
              <span
                className={`top-bar-status status-${workspaceStatus}`}
                aria-label={`Workspace status: ${workspaceStatus}`}
              >
                <span className="top-bar-dot" aria-hidden="true" />
                {workspaceStatus.charAt(0).toUpperCase() + workspaceStatus.slice(1)}
              </span>
            )}
          </div>
        )}

        {/* Main content */}
        <div className="app-main">
          <Outlet />
        </div>

        {/* Bottom status bar — desktop only */}
        <StatusBar
          workspaceStatus={workspaceStatus}
          gitBranch={gitBranch}
          changedFiles={changedFiles}
          aiCount={aiCount}
          aiWaiting={aiWaiting}
          terminalCount={terminalCount}
        />
      </div>

      {/* Mobile bottom nav */}
      <MobileNav />
    </div>
  );
}
