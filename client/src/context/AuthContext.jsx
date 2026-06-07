import { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [setupComplete, setSetupComplete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [csrfToken, setCsrfToken] = useState('');

  useEffect(() => {
    async function init() {
      try {
        const [statusRes, meRes, csrfRes] = await Promise.all([
          fetch('/api/setup/status'),
          fetch('/api/auth/me'),
          fetch('/api/auth/csrf-token'),
        ]);
        const status = await statusRes.json();
        const me = await meRes.json();
        const csrf = await csrfRes.json();

        setSetupComplete(status.setupComplete);
        setCsrfToken(csrf.csrfToken || '');

        if (me.loggedIn) {
          setUser({ id: me.userId, username: me.username });
        }
      } catch (e) {
        console.error('Auth init failed:', e);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  async function login(username, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (data.success) {
      const meRes = await fetch('/api/auth/me');
      const me = await meRes.json();
      setUser({ id: me.userId, username: me.username });
      const csrfRes = await fetch('/api/auth/csrf-token');
      const csrfData = await csrfRes.json();
      setCsrfToken(csrfData.csrfToken);
      return { success: true };
    }
    return { success: false, error: data.error };
  }

  async function logout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
    });
    setUser(null);
    setCsrfToken('');
  }

  async function completeSetup(username, password, confirmPassword) {
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, confirmPassword }),
    });
    const data = await res.json();
    if (data.success) {
      setSetupComplete(true);
      const meRes = await fetch('/api/auth/me');
      const me = await meRes.json();
      setUser({ id: me.userId, username: me.username });
      const csrfRes = await fetch('/api/auth/csrf-token');
      const csrfData = await csrfRes.json();
      setCsrfToken(csrfData.csrfToken);
      return { success: true };
    }
    return { success: false, error: data.error };
  }

  return (
    <AuthContext.Provider value={{ user, setupComplete, loading, csrfToken, login, logout, completeSetup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
