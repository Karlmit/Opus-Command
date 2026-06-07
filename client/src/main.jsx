import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/Toast';
import { NotificationsProvider } from './context/NotificationsContext';
import App from './App';
import './styles/globals.css';
// Cascadia Mono — terminal font (regular + bold, all subsets for box-drawing)
import '@fontsource/cascadia-mono/400.css';
import '@fontsource/cascadia-mono/700.css';
import '@fontsource/cascadia-mono/symbols2-400.css';
import '@fontsource/cascadia-mono/symbols2-700.css';

const root = document.getElementById('root');

// Apply saved theme before rendering (avoids flash)
const savedTheme = localStorage.getItem('theme') || 'dark';
if (savedTheme === 'system') {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
} else {
  document.documentElement.setAttribute('data-theme', savedTheme);
}

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <NotificationsProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </NotificationsProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
