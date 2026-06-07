import { Outlet } from 'react-router-dom';
import { DeviceProvider } from '../context/DeviceContext';
import { MobileUIProvider } from '../context/MobileUIContext';
import ProjectsSidebar from './ProjectsSidebar';
import StatusBar from './StatusBar';
import MobileNav from './MobileNav';
import './AppShell.css';

export default function AppShell() {
  return (
    <DeviceProvider>
      <MobileUIProvider>
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
      </MobileUIProvider>
    </DeviceProvider>
  );
}
