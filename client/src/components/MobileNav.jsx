import { useNavigate, useLocation } from 'react-router-dom';
import './MobileNav.css';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: DashboardIcon },
  { id: 'terminal', label: 'Terminal', path: '/terminal', icon: TerminalIcon },
  { id: 'files', label: 'Files', path: '/files', icon: FilesIcon },
  { id: 'git', label: 'Git', path: '/git', icon: GitIcon },
];

function DashboardIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="18" rx="3"/>
      <path d="M7 8l4 4-4 4M13 16h4"/>
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
  );
}

function GitIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  );
}

export default function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();

  function isActive(item) {
    if (item.id === 'dashboard') return location.pathname === '/';
    return location.pathname.startsWith(item.path);
  }

  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {NAV_ITEMS.map(item => {
        const active = isActive(item);
        return (
          <button
            key={item.id}
            className={`mobile-nav-item${active ? ' active' : ''}`}
            onClick={() => navigate(item.path)}
            aria-current={active ? 'page' : undefined}
          >
            <item.icon />
            <span className="mobile-nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
