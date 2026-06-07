import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './Sidebar.css';

const NAV_ITEMS = [
  { id: 'files', label: 'Files', path: '/files', icon: FilesIcon },
  { id: 'terminal', label: 'Terminal', path: '/terminal', icon: TerminalIcon },
  { id: 'git', label: 'Git', path: '/git', icon: GitIcon },
  { id: 'settings', label: 'Settings', path: '/settings', icon: SettingsIcon },
];

function FilesIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3h18v18H3zM9 3v18M15 9h3M15 12h3M15 15h3M5 9h2M5 12h2M5 15h2"/>
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="18" rx="3"/>
      <path d="M7 8l4 4-4 4M13 16h4"/>
    </svg>
  );
}

function GitIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

function CollapseIcon({ expanded }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  );
}

export default function Sidebar({ projectName }) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  function isActive(path) {
    return location.pathname.startsWith(path);
  }

  return (
    <nav className={`sidebar${expanded ? ' sidebar-expanded' : ''}`} aria-label="Main navigation">
      <div className="sidebar-top">
        <div className="sidebar-logo" onClick={() => navigate('/')} title="Projects">
          <div className="sidebar-logo-mark" />
          {expanded && <span className="sidebar-logo-label truncate">{projectName || 'Opus Command'}</span>}
        </div>
      </div>

      <div className="sidebar-nav">
        {NAV_ITEMS.map(item => {
          const active = isActive(item.path);
          return (
            <button
              key={item.id}
              className={`sidebar-nav-item${active ? ' active' : ''}`}
              onClick={() => navigate(item.path)}
              title={!expanded ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <item.icon />
              {expanded && <span className="sidebar-nav-label">{item.label}</span>}
            </button>
          );
        })}
      </div>

      <div className="sidebar-bottom">
        <button
          className="sidebar-toggle"
          onClick={() => setExpanded(e => !e)}
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          <CollapseIcon expanded={expanded} />
          {expanded && <span className="sidebar-nav-label">Collapse</span>}
        </button>
      </div>
    </nav>
  );
}
