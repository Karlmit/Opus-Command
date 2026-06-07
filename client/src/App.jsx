import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Projects from './pages/Projects';
import ProjectDashboard from './pages/ProjectDashboard';
import TerminalPage from './pages/Terminal';

function LoadingScreen() {
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-background)',
    }}>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
        Loading…
      </span>
    </div>
  );
}

function PlaceholderPage({ title }) {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--color-text-tertiary)',
      fontSize: 'var(--font-size-sm)',
    }}>
      {title} — coming soon
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

  if (loading) return <LoadingScreen />;
  if (!setupComplete || !user) return <LoadingScreen />;
  return children;
}

// Project shell — wraps AppShell with project-specific nav (sidebar links scoped to project ID)
function ProjectShell() {
  const { id } = useParams();

  return (
    <AppShell projectId={id} workspaceStatus="stopped" />
  );
}

export default function App() {
  const { user, setupComplete, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <Routes>
      <Route
        path="/setup"
        element={setupComplete ? <Navigate to="/" replace /> : <Setup />}
      />
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login />}
      />

      {/* Root: Projects list + Settings */}
      <Route
        path="/"
        element={
          <AuthGuard>
            <AppShell workspaceStatus="stopped" />
          </AuthGuard>
        }
      >
        <Route index element={<Projects />} />
        <Route path="settings/*" element={<PlaceholderPage title="Settings" />} />
      </Route>

      {/* Project workspace cockpit */}
      <Route
        path="/project/:id"
        element={
          <AuthGuard>
            <ProjectShell />
          </AuthGuard>
        }
      >
        <Route index element={<ProjectDashboard />} />
        <Route path="terminal" element={<TerminalPage />} />
        <Route path="files/*" element={<PlaceholderPage title="Files" />} />
        <Route path="git/*" element={<PlaceholderPage title="Git" />} />
        <Route path="settings/*" element={<PlaceholderPage title="Workspace Settings" />} />
      </Route>
    </Routes>
  );
}
