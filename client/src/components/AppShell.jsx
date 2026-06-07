import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import StatusBar from './StatusBar';
import MobileNav from './MobileNav';
import './AppShell.css';

export default function AppShell({ projectName, workspaceStatus, gitBranch, changedFiles, aiCount, aiWaiting, terminalCount }) {
  return (
    <div className="app-shell">
      {/* Desktop: sidebar (hidden on mobile) */}
      <div className="app-sidebar-area">
        <Sidebar projectName={projectName} />
      </div>

      {/* Content area */}
      <div className="app-content">
        {/* Main content with status bar below */}
        <div className="app-main-area">
          <Outlet />
        </div>
        {/* Desktop status bar */}
        <div className="app-statusbar-area">
          <StatusBar
            workspaceStatus={workspaceStatus}
            gitBranch={gitBranch}
            changedFiles={changedFiles}
            aiCount={aiCount}
            aiWaiting={aiWaiting}
            terminalCount={terminalCount}
          />
        </div>
      </div>

      {/* Mobile bottom nav */}
      <MobileNav />
    </div>
  );
}
