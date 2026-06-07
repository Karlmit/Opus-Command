import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Sidebar.css';

/* ── Icons ── */
function IconFiles() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"/>
      <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  );
}

function IconGit() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15"/>
      <circle cx="18" cy="6" r="3"/>
      <circle cx="6" cy="18" r="3"/>
      <path d="M18 9a9 9 0 0 1-9 9"/>
    </svg>
  );
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
      <polyline points="9 22 9 12 15 12 15 22"/>
    </svg>
  );
}

const PROJECT_NAV = [
  { id: 'files',    label: 'Files',    path: 'files',    Icon: IconFiles },
  { id: 'terminal', label: 'Terminal', path: 'terminal', Icon: IconTerminal },
  { id: 'git',      label: 'Git',      path: 'git',      Icon: IconGit },
];

export default function Sidebar({ projectId, projectName }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const initials = user?.username
    ? user.username.slice(0, 2).toUpperCase()
    : '?';

  function isActive(path) {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  }

  const homeActive = !projectId || location.pathname === '/';

  return (
    <nav className="icon-rail" aria-label="Main navigation">
      {/* Logo mark — links to projects list */}
      <button
        className="rail-logo"
        onClick={() => navigate('/')}
        title="Projects"
        aria-label="Opus Command — go to projects"
      >
        <img src="/mark-dark.svg" alt="" width="28" height="28" />
      </button>

      <div className="rail-divider" />

      {/* Home / Projects */}
      <button
        className={`rail-item${homeActive ? ' active' : ''}`}
        onClick={() => navigate('/')}
        title="Projects"
        aria-label="Projects"
        aria-current={homeActive ? 'page' : undefined}
      >
        <IconHome />
        <span className="rail-label">Projects</span>
      </button>

      {/* Project-specific nav */}
      {projectId && PROJECT_NAV.map(({ id, label, path, Icon }) => {
        const fullPath = `/project/${projectId}/${path}`;
        const active = isActive(fullPath);
        return (
          <button
            key={id}
            className={`rail-item${active ? ' active' : ''}`}
            onClick={() => navigate(fullPath)}
            title={label}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
          >
            <Icon />
            <span className="rail-label">{label}</span>
          </button>
        );
      })}

      <div className="rail-spacer" />

      {/* Settings */}
      <button
        className={`rail-item${isActive('/settings') ? ' active' : ''}`}
        onClick={() => navigate('/settings')}
        title="Settings"
        aria-label="Settings"
        aria-current={isActive('/settings') ? 'page' : undefined}
      >
        <IconSettings />
        <span className="rail-label">Settings</span>
      </button>

      {/* User avatar */}
      <div className="rail-avatar" title={user?.username || 'Account'}>
        {initials}
      </div>
    </nav>
  );
}
