import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useMobileUI } from '../context/MobileUIContext';
import './MobileNav.css';

/* ── Avatar helpers (mirrored from ProjectsSidebar) ── */
const COLORS = ['#6366f1','#8b5cf6','#ec4899','#ef4444','#f59e0b','#22c55e','#06b6d4','#3b82f6','#64748b','#92400e'];
function defaultColor(id) { return COLORS[(id - 1) % COLORS.length]; }
function parseAvatar(avatar, id) {
  if (!avatar) return { emoji: '', color: defaultColor(id) };
  if (avatar.includes('|')) { const [e, c] = avatar.split('|'); return { emoji: e, color: c }; }
  if (avatar.startsWith('#')) return { emoji: '', color: avatar };
  return { emoji: avatar, color: defaultColor(id) };
}

function MiniAvatar({ project, size = 34 }) {
  const { emoji, color } = parseAvatar(project?.avatar, project?.id);
  const initials = (project?.name || '??').slice(0, 2).toUpperCase();
  return (
    <div className="mnav-avatar" style={{ width: size, height: size, background: color, fontSize: emoji ? size * 0.48 : size * 0.34 }}>
      {emoji || initials}
    </div>
  );
}

/* ── Icons ─────────────────────────────────────────── */
function TerminalIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2 : 1.75} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {active && <rect x="2" y="3" width="20" height="18" rx="3" fill="currentColor" fillOpacity="0.1"/>}
      <rect x="2" y="3" width="20" height="18" rx="3"/>
      <polyline points="4 17 10 11 4 5"/>
      <line x1="12" y1="19" x2="20" y2="19"/>
    </svg>
  );
}
function CdesktopIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2 : 1.75} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {active && <rect x="3" y="4" width="18" height="12" rx="2" fill="currentColor" fillOpacity="0.1"/>}
      <rect x="3" y="4" width="18" height="12" rx="2"/>
      <path d="M8 20h8"/>
      <path d="M12 16v4"/>
      <path d="M8 9l2 2-2 2"/>
      <path d="M13 13h3"/>
    </svg>
  );
}
function FilesIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2 : 1.75} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {active && <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" fill="currentColor" fillOpacity="0.1"/>}
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  );
}
function GitIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2 : 1.75} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15"/>
      <circle cx="18" cy="6" r="3" fill={active ? 'currentColor' : 'none'} fillOpacity="0.25"/>
      <circle cx="6" cy="18" r="3" fill={active ? 'currentColor' : 'none'} fillOpacity="0.25"/>
      <path d="M18 9a9 9 0 0 1-9 9"/>
    </svg>
  );
}
function WorkspaceIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" strokeWidth={active ? 2 : 1.75} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" fill={active ? 'currentColor' : 'none'} fillOpacity="0.25"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}
function ChevronUp() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2,8 6,4 10,8"/>
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
      <line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/>
    </svg>
  );
}
function SettingsGearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

const STATUS_LABELS = { running: 'running', starting: 'starting…', stopped: 'stopped', error: 'error' };

/* ── Project Drawer ─────────────────────────────── */
function ProjectDrawer({ projects, currentProjectId, navigate, onClose, setMobileTab }) {
  const { csrfToken } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', folder: '' });
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);

  // Close on outside click
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleNameChange(name) {
    const folder = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setForm(f => ({ ...f, name, folder: f.folder || folder }));
  }

  async function createProject(e) {
    e.preventDefault();
    if (!form.name.trim() || !form.folder.trim()) return setFormError('Name and folder required.');
    setCreating(true); setFormError('');
    try {
      const r = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (d.id) {
        navigate(`/project/${d.id}`);
        setMobileTab('terminal');
        onClose();
      } else {
        setFormError(d.error || 'Failed to create project.');
      }
    } catch { setFormError('An error occurred.'); }
    finally { setCreating(false); }
  }

  function openProject(id) {
    navigate(`/project/${id}`);
    setMobileTab('terminal');
    onClose();
  }

  return (
    <div className="drawer-backdrop" onClick={handleBackdropClick}>
      <div className="project-drawer" role="dialog" aria-label="Projects">
        <div className="drawer-handle" />

        <div className="drawer-header">
          <span className="drawer-title">Projects</span>
          <button
            className="drawer-new-btn"
            onClick={() => setShowForm(s => !s)}
            aria-label="New project"
          >
            <PlusIcon />
            <span>New</span>
          </button>
        </div>

        {showForm && (
          <form className="drawer-form" onSubmit={createProject}>
            <input
              className="drawer-input"
              placeholder="Project name"
              value={form.name}
              onChange={e => handleNameChange(e.target.value)}
              autoFocus
            />
            <input
              className="drawer-input"
              placeholder="folder-name"
              value={form.folder}
              onChange={e => setForm(f => ({ ...f, folder: e.target.value }))}
            />
            {formError && <p className="drawer-form-error">{formError}</p>}
            <div className="drawer-form-actions">
              <button type="button" className="drawer-form-cancel" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="drawer-form-create" disabled={creating || !form.name || !form.folder}>
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </form>
        )}

        <div className="drawer-projects">
          {projects.length === 0 && !showForm && (
            <p className="drawer-empty">No projects yet. Create one above.</p>
          )}
          {projects.map(p => {
            const isActive = String(p.id) === String(currentProjectId);
            return (
              <button
                key={p.id}
                className={`drawer-project-item${isActive ? ' active' : ''}`}
                onClick={() => openProject(p.id)}
              >
                <MiniAvatar project={p} size={40} />
                <div className="drawer-project-info">
                  <div className="drawer-project-name">{p.name}</div>
                  <div className="drawer-project-status">{STATUS_LABELS[p.status] || p.status}</div>
                </div>
                <span className={`drawer-status-dot dot-${p.status}`} />
              </button>
            );
          })}
        </div>

        <div className="drawer-footer">
          <button className="drawer-settings-btn" onClick={() => { navigate('/settings'); onClose(); }}>
            <SettingsGearIcon />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Mobile nav tabs ────────────────────────────── */
const NAV_TABS = [
  { id: 'terminal', label: 'Terminal', Icon: TerminalIcon },
  { id: 'files',    label: 'Files',    Icon: FilesIcon },
  { id: 'cdesktop', label: 'cdesktop', Icon: CdesktopIcon },
  { id: 'git',      label: 'Git',      Icon: GitIcon },
  { id: 'settings', label: 'Workspace', Icon: WorkspaceIcon },
];

/* ── Main component ─────────────────────────────── */
export default function MobileNav() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const { projects, drawerOpen, setDrawerOpen, mobileTab, setMobileTab } = useMobileUI();

  const currentProject = projects.find(p => String(p.id) === String(projectId));
  const hasProject = !!projectId;

  function onTabClick(tabId) {
    if (!hasProject) return;
    setMobileTab(tabId);
  }

  return (
    <>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {/* Project selector button */}
        <button
          className="mnav-project-btn"
          onClick={() => setDrawerOpen(true)}
          aria-label={currentProject ? `Switch project (current: ${currentProject.name})` : 'Open projects'}
        >
          {currentProject ? (
            <>
              <div className="mnav-project-avatar-wrap">
                <MiniAvatar project={currentProject} size={32} />
                <span className={`mnav-project-dot dot-${currentProject.status}`} />
              </div>
            </>
          ) : (
            <div className="mnav-no-project">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6"/>
                <line x1="3" y1="12" x2="21" y2="12"/>
                <line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </div>
          )}
          <ChevronUp />
        </button>

        <div className="mnav-separator" />

        {/* Tab buttons */}
        {NAV_TABS.map(({ id, label, Icon }) => {
          const active = hasProject && mobileTab === id;
          return (
            <button
              key={id}
              className={`mnav-tab${active ? ' active' : ''}${!hasProject ? ' mnav-tab-dim' : ''}`}
              onClick={() => onTabClick(id)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
            >
              <span className={`mnav-scan-line${active ? ' visible' : ''}`} />
              <span className="mnav-tab-icon">
                <Icon active={active} />
              </span>
              <span className="mnav-tab-label">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Drawer */}
      {drawerOpen && (
        <ProjectDrawer
          projects={projects}
          currentProjectId={projectId}
          navigate={navigate}
          onClose={() => setDrawerOpen(false)}
          setMobileTab={setMobileTab}
        />
      )}
    </>
  );
}
