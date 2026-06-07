import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const Ctx = createContext({
  projects: [],
  drawerOpen: false,
  setDrawerOpen: () => {},
  mobileTab: 'terminal',
  setMobileTab: () => {},
});

export function MobileUIProvider({ children }) {
  const [projects, setProjects] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState('terminal');

  const loadProjects = useCallback(async () => {
    try {
      const r = await fetch('/api/projects');
      const d = await r.json();
      setProjects(d.projects || []);
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadProjects();
    const t = setInterval(loadProjects, 5000);
    return () => clearInterval(t);
  }, [loadProjects]);

  return (
    <Ctx.Provider value={{ projects, drawerOpen, setDrawerOpen, mobileTab, setMobileTab }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMobileUI() {
  return useContext(Ctx);
}
