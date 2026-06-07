import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Projects from './pages/Projects';
import ProjectDashboard from './pages/ProjectDashboard';

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

      <Route
        path="/"
        element={
          <AuthGuard>
            <AppShell workspaceStatus="stopped" />
          </AuthGuard>
        }
      >
        <Route index element={<Projects />} />
        <Route path="files/*" element={<PlaceholderPage title="Files" />} />
        <Route path="terminal/*" element={<PlaceholderPage title="Terminal" />} />
        <Route path="git/*" element={<PlaceholderPage title="Git" />} />
        <Route path="settings/*" element={<PlaceholderPage title="Settings" />} />
        <Route path="project/:id/*" element={<ProjectDashboard />} />
      </Route>
    </Routes>
  );
}
