import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import './Settings.css';

const SOUNDS = [
  { id: 'chime', label: 'Chime' },
  { id: 'ping', label: 'Ping' },
  { id: 'ding', label: 'Ding' },
];

// Simple beep/tone using Web Audio API
function playSound(type) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    const freqs = { chime: 880, ping: 660, ding: 440 };
    osc.frequency.value = freqs[type] || 660;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (_) {}
}

function AccountSection({ csrfToken, addToast }) {
  const [form, setForm] = useState({ current: '', newPass: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (form.newPass.length < 12) return setError('New password must be at least 12 characters.');
    if (form.newPass !== form.confirm) return setError('Passwords do not match.');

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ currentPassword: form.current, newPassword: form.newPass, confirmPassword: form.confirm }),
      });
      const data = await res.json();
      if (data.success) {
        setForm({ current: '', newPass: '', confirm: '' });
        addToast('Password updated.');
      } else {
        setError(data.error || 'Update failed.');
      }
    } catch {
      setError('An error occurred.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">ACCOUNT</h2>
      <form onSubmit={handleSubmit} className="settings-form">
        <div className="form-group">
          <label className="form-label">Current Password</label>
          <input type="password" className="input" value={form.current} onChange={e => setForm(f => ({ ...f, current: e.target.value }))} autoComplete="current-password" />
        </div>
        <div className="form-group">
          <label className="form-label">New Password</label>
          <input type="password" className="input" value={form.newPass} onChange={e => setForm(f => ({ ...f, newPass: e.target.value }))} autoComplete="new-password" />
        </div>
        <div className="form-group">
          <label className="form-label">Confirm New Password</label>
          <input type="password" className="input" value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} autoComplete="new-password" />
        </div>
        {error && <p className="error-message">{error}</p>}
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </div>
  );
}

function AppearanceSection({ csrfToken, addToast }) {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    fetch('/api/settings/theme').then(r => r.json()).then(d => setTheme(d.theme || 'dark'));
  }, []);

  async function handleTheme(t) {
    setTheme(t);
    localStorage.setItem('theme', t);
    // Apply immediately
    if (t === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    } else {
      document.documentElement.setAttribute('data-theme', t);
    }
    await fetch('/api/settings/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ theme: t }),
    });
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">APPEARANCE</h2>
      <div className="radio-group">
        {['dark', 'light', 'system'].map(t => (
          <label key={t} className="radio-option">
            <input type="radio" name="theme" value={t} checked={theme === t} onChange={() => handleTheme(t)} />
            <span>{t.charAt(0).toUpperCase() + t.slice(1)}{t === 'dark' ? ' (default)' : ''}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SoundSection({ csrfToken }) {
  const [enabled, setEnabled] = useState(false);
  const [sound, setSound] = useState('chime');

  useEffect(() => {
    fetch('/api/settings/sound').then(r => r.json()).then(d => {
      setEnabled(d.enabled);
      setSound(d.sound || 'chime');
    });
  }, []);

  async function handleToggle() {
    const newVal = !enabled;
    setEnabled(newVal);
    await fetch('/api/settings/sound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ enabled: newVal, sound }),
    });
  }

  async function handleSound(s) {
    setSound(s);
    await fetch('/api/settings/sound', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ enabled, sound: s }),
    });
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">SOUND NOTIFICATIONS</h2>
      <label className="settings-toggle">
        <input type="checkbox" checked={enabled} onChange={handleToggle} />
        <span>AI session sound notifications</span>
      </label>
      {enabled && (
        <div className="sound-picker">
          {SOUNDS.map(s => (
            <div key={s.id} className="sound-option">
              <label className="radio-option">
                <input type="radio" name="sound" value={s.id} checked={sound === s.id} onChange={() => handleSound(s.id)} />
                <span>{s.label}</span>
              </label>
              <button className="btn btn-ghost" onClick={() => playSound(s.id)}>Preview</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpdatesSection() {
  const [version, setVersion] = useState('…');
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch('/api/settings/version').then(r => r.json()).then(d => setVersion(d.version || '0.1.0'));
  }, []);

  async function checkForUpdates() {
    setChecking(true);
    setCheckResult(null);
    try {
      const res = await fetch('/api/settings/updates/check');
      const data = await res.json();
      if (data.error) {
        setCheckResult({ error: data.error });
      } else {
        setCheckResult({ current: data.current, latest: data.latest, url: data.url });
      }
    } catch {
      setCheckResult({ error: 'Could not check for updates. Check your internet connection.' });
    } finally {
      setChecking(false);
    }
  }

  function isNewer(current, latest) {
    if (!current || !latest) return false;
    const c = current.split('.').map(Number);
    const l = latest.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((l[i] || 0) > (c[i] || 0)) return true;
      if ((l[i] || 0) < (c[i] || 0)) return false;
    }
    return false;
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">UPDATES</h2>
      <div className="settings-info-row">
        <span className="settings-label">Current version</span>
        <span className="settings-value font-mono">v{version}</span>
      </div>

      <button className="btn btn-ghost" onClick={checkForUpdates} disabled={checking}>
        {checking ? (
          <><span className="spinner" />Checking…</>
        ) : 'Check for Updates'}
      </button>

      {checkResult && (
        <div className="update-result">
          {checkResult.error ? (
            <p className="error-message">{checkResult.error}</p>
          ) : isNewer(checkResult.current, checkResult.latest) ? (
            <p className="update-available">
              Update Available — Current: {checkResult.current} → Latest: {checkResult.latest}{' '}
              <a href={checkResult.url} target="_blank" rel="noopener noreferrer" className="update-link">
                View on GitHub
              </a>
            </p>
          ) : (
            <p className="update-current">Up to date — v{checkResult.current}</p>
          )}
        </div>
      )}

      <div className="update-instructions">
        <p className="settings-label">To update:</p>
        <div className="update-steps">
          <p><strong>Docker Compose:</strong></p>
          <code>docker compose pull && docker compose up -d</code>
          <p><strong>Unraid / Watchtower:</strong> Use the standard Docker update workflow in your management tool. No manual steps required.</p>
        </div>
      </div>
    </div>
  );
}

export default function Settings() {
  const { csrfToken } = useAuth();
  const { addToast } = useToast();

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="settings-title">SETTINGS</h1>
      </div>
      <div className="settings-content">
        <AccountSection csrfToken={csrfToken} addToast={addToast} />
        <AppearanceSection csrfToken={csrfToken} addToast={addToast} />
        <UpdatesSection />
        <SoundSection csrfToken={csrfToken} />
      </div>
    </div>
  );
}
