import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Projects from './pages/Projects';
import ProjectDashboard from './pages/ProjectDashboard';
import TerminalPage from './pages/Terminal';
import Settings from './pages/Settings';
import FilesPage from './pages/Files';
import GitPage from './pages/Git';

function LoadingScreen() {
  return (
    <div style={{
      height: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-background)',
    }}>
      <img src="/mark-dark.svg" alt="Loading" width="32" height="32"
        style={{ opacity: 0.4 }} />
    </div>
  );
}

function AuthGuard({ children }) {
  const { user, setupComplete, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!setupComplete) navigate('/setup', { replace: true });
    else if (!user) navigate('/login', { replace: true });
  }, [user, setupComplete, loading, navigate]);

  if (loading || !setupComplete || !user) return <LoadingScreen />;
  return children;
}

// Fetches live project data and wraps AppShell with it
function ProjectShell() {
  const { id } = useParams();
  const [project, setProject] = useState(null);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/projects/${id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setProject(d))
      .catch(() => {});

    // Poll status every 5s so the top bar stays current
    const timer = setInterval(() => {
      fetch(`/api/projects/${id}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => d && setProject(d))
        .catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [id]);

  return (
    <AppShell
      projectId={id}
      projectName={project?.name}
      workspaceStatus={project?.status || 'stopped'}
      gitBranch={project?.gitBranch}
      changedFiles={project?.changedFiles || 0}
      aiCount={project?.aiCount || 0}
      aiWaiting={project?.aiWaiting || 0}
      terminalCount={project?.terminalCount || 0}
    />
  );
}

export default function App() {
  const { user, setupComplete, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      <Route path="/setup" element={setupComplete ? <Navigate to="/" replace /> : <Setup />} />
      <Route path="/login"  element={user ? <Navigate to="/" replace /> : <Login />} />

      {/* Root shell: projects list + settings */}
      <Route path="/" element={<AuthGuard><AppShell /></AuthGuard>}>
        <Route index element={<Projects />} />
        <Route path="settings/*" element={<Settings />} />
      </Route>

      {/* Project cockpit */}
      <Route path="/project/:id" element={<AuthGuard><ProjectShell /></AuthGuard>}>
        <Route index        element={<ProjectDashboard />} />
        <Route path="terminal" element={<TerminalPage />} />
        <Route path="files/*"  element={<FilesPage />} />
        <Route path="git/*"    element={<GitPage />} />
        <Route path="settings/*" element={<Settings />} />
      </Route>
    </Routes>
  );
}
