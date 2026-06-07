import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppShell from './components/AppShell';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Settings from './pages/Settings';
import ProjectCockpit from './pages/ProjectCockpit';

function Loading() {
  return (
    <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-background)' }}>
      <img src="/mark-dark.svg" alt="" width="32" height="32" style={{ opacity: 0.3 }} />
    </div>
  );
}

function NoProject() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--spacing-md)', color: 'var(--color-text-tertiary)' }}>
      <img src="/mark-dark.svg" alt="" width="40" height="40" style={{ opacity: 0.2 }} />
      <p style={{ fontSize: 'var(--font-size-sm)' }}>Select or create a project</p>
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
  }, [user, setupComplete, loading]);
  if (loading || !setupComplete || !user) return <Loading />;
  return children;
}

export default function App() {
  const { user, setupComplete, loading } = useAuth();
  if (loading) return <Loading />;

  return (
    <Routes>
      <Route path="/setup" element={setupComplete ? <Navigate to="/" replace /> : <Setup />} />
      <Route path="/login"  element={user ? <Navigate to="/" replace /> : <Login />} />

      <Route path="/" element={<AuthGuard><AppShell /></AuthGuard>}>
        <Route index          element={<NoProject />} />
        <Route path="project/:id" element={<ProjectCockpit />} />
        <Route path="settings/*"  element={<Settings />} />
      </Route>
    </Routes>
  );
}
