import { Outlet } from 'react-router-dom';
import ProjectsSidebar from './ProjectsSidebar';
import StatusBar from './StatusBar';
import MobileNav from './MobileNav';
import './AppShell.css';

export default function AppShell() {
  return (
    <div className="app-shell">
      <ProjectsSidebar />
      <div className="app-body">
        <div className="app-main">
          <Outlet />
        </div>
        <StatusBar />
      </div>
      <MobileNav />
    </div>
  );
}
