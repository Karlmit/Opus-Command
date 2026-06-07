import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { io } from 'socket.io-client';
import './Settings.css';
import './ClaudeSettings.css';

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

function UpdatesSection({ csrfToken }) {
  const [version, setVersion]         = useState('…');
  const [checkResult, setCheckResult] = useState(null);
  const [checking, setChecking]       = useState(false);
  const [updating, setUpdating]       = useState(false);
  const [updateLog, setUpdateLog]     = useState([]);

  useEffect(() => {
    fetch('/api/settings/version').then(r => r.json()).then(d => setVersion(d.version || '0.1.0'));
  }, []);

  // Stream progress from Socket.io while updating
  useEffect(() => {
    if (!updating) return;
    const sock = io({ autoConnect: true });
    sock.on('self-update:progress', ({ message }) => {
      if (message) setUpdateLog(prev => [...prev.slice(-20), message]);
    });
    return () => sock.disconnect();
  }, [updating]);

  async function checkForUpdates() {
    setChecking(true); setCheckResult(null);
    try {
      const res  = await fetch('/api/settings/updates/check');
      const data = await res.json();
      setCheckResult(data.error ? { error: data.error } : data);
    } catch {
      setCheckResult({ error: 'Could not check for updates. Check your internet connection.' });
    } finally { setChecking(false); }
  }

  // Strip pre-release suffixes (+abc, -dev, etc.) for semver comparison
  function semver(v) {
    return (v || '').replace(/^v/, '').replace(/[+\-].*$/, '').trim();
  }

  async function applyUpdate() {
    setUpdating(true);
    setUpdateLog(['Starting update…']);
    try {
      const res = await fetch('/api/settings/updates/apply', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
      });
      const data = await res.json();
      if (data.alreadyLatest) {
        setUpdateLog(['Already running the latest version.']);
        setUpdating(false);
      } else if (data.updating) {
        setUpdateLog(prev => [...prev, 'Container restarting… refreshing in a few seconds.']);
        setTimeout(() => window.location.reload(), 12000);
      } else if (data.error) {
        setUpdateLog(prev => [...prev, `Error: ${data.error}`]);
        setUpdating(false);
      }
    } catch {
      // Connection dropped = update is mid-flight, container restarting
      setUpdateLog(prev => [...prev, 'Connection lost — update applying. Refreshing…']);
      setTimeout(() => window.location.reload(), 8000);
    }
  }

  function isNewer(current, latest) {
    const c = semver(current);
    const l = semver(latest);
    if (!c || !l) return false;
    // "dev" or non-semver current = local/unversioned build → treat as outdated if any release exists
    if (!c || isNaN(Number(c.split('.')[0]))) return !!l;
    const cp = c.split('.').map(Number);
    const lp = l.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((lp[i] || 0) > (cp[i] || 0)) return true;
      if ((lp[i] || 0) < (cp[i] || 0)) return false;
    }
    return false;
  }

  const updateAvailable = checkResult && !checkResult.error && (
    isNewer(checkResult.current, checkResult.latest) || checkResult.digestChanged
  );

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">UPDATES</h2>
      <div className="settings-info-row">
        <span className="settings-label">Current version</span>
        <span className="settings-value font-mono">v{version}</span>
      </div>

      <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-ghost" onClick={checkForUpdates} disabled={checking || updating}>
          {checking ? <><span className="spinner" />Checking…</> : 'Check for Updates'}
        </button>
        {updateAvailable && !updating && (
          <button className="btn btn-primary" onClick={applyUpdate}>
            ↑ Update to v{checkResult.latest}
          </button>
        )}
      </div>

      {checkResult && !updating && (
        <div className="update-result">
          {checkResult.error ? (
            <p className="error-message">{checkResult.error}</p>
          ) : updateAvailable ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <p className="update-available">
                {checkResult.digestChanged && !isNewer(checkResult.current, checkResult.latest)
                  ? 'New image available — same version, rebuilt on GHCR'
                  : `Update available — v${semver(checkResult.current)} → v${checkResult.latest}`
                }
                {checkResult.url && <>{' '}<a href={checkResult.url} target="_blank" rel="noopener noreferrer" className="update-link">Release notes</a></>}
              </p>
              {checkResult.localHash && checkResult.remoteHash && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-dim)' }}>
                  running: {checkResult.localHash} → latest: {checkResult.remoteHash}
                </p>
              )}
            </div>
          ) : (
            <div>
              <p className="update-current">
                Up to date — v{semver(checkResult.current) || checkResult.current}
                {checkResult.current?.includes('+') ? ` (build ${checkResult.current.split('+')[1]})` : ''}
              </p>
              {checkResult.localHash && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-dim)', marginTop: 2 }}>
                  image: {checkResult.localHash}{checkResult.remoteHash ? ` = ${checkResult.remoteHash} ✓` : ''}
                </p>
              )}
              {checkResult.digestError && (
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-dim)', marginTop: 2 }}>
                  ⚠ Digest check failed: {checkResult.digestError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {updating && (
        <div className="update-log">
          {updateLog.map((line, i) => (
            <div key={i} className="update-log-line">
              {i === updateLog.length - 1 && <span className="spinner" style={{ marginRight: 6 }} />}
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Claude Code / Azure AI Foundry settings ──────────────────────────────────

const AZURE_FIELDS = [
  {
    key: 'ANTHROPIC_BASE_URL',
    label: 'Azure AI Foundry endpoint',
    placeholder: 'https://<resource>.services.ai.azure.com/models',
    hint: 'The endpoint URL from your Azure AI Foundry deployment.',
    secret: false,
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: 'API key',
    placeholder: 'sk-...',
    hint: 'Your Azure AI Foundry API key. Stored in /app/data.',
    secret: true,
  },
];

function ClaudeSection({ csrfToken, addToast }) {
  const [vars, setVars]         = useState({}); // { KEY: value }
  const [extra, setExtra]       = useState([]); // [{key, value}] — custom vars
  const [saving, setSaving]     = useState(false);
  const [showSecrets, setShow]  = useState({});

  useEffect(() => {
    fetch('/api/settings/workspace-env')
      .then(r => r.json())
      .then(data => {
        const map = {};
        const ext = [];
        (data.vars || []).forEach(({ key, value }) => {
          if (AZURE_FIELDS.some(f => f.key === key)) map[key] = value;
          else ext.push({ key, value });
        });
        setVars(map);
        setExtra(ext);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    const allVars = [
      ...AZURE_FIELDS.map(f => ({ key: f.key, value: vars[f.key] || '' })).filter(v => v.value),
      ...extra.filter(v => v.key.trim()),
    ];
    try {
      const res = await fetch('/api/settings/workspace-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ vars: allVars }),
      });
      const data = await res.json();
      if (data.success) addToast(`Saved ${data.count} environment variable${data.count !== 1 ? 's' : ''}.`);
      else addToast(data.error || 'Save failed.', 'error');
    } catch { addToast('Save failed.', 'error'); }
    finally { setSaving(false); }
  }

  function addExtra() {
    setExtra(prev => [...prev, { key: '', value: '' }]);
  }

  function updateExtra(i, field, val) {
    setExtra(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  }

  function removeExtra(i) {
    setExtra(prev => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">CLAUDE CODE — AZURE AI FOUNDRY</h2>
      <p className="claude-section-desc">
        These environment variables are injected into every workspace container.
        New projects and recreated workspaces pick them up automatically.
        Existing running containers need a <strong>Restart</strong> or <strong>Recreate</strong> to apply changes.
      </p>

      <div className="claude-fields">
        {AZURE_FIELDS.map(field => (
          <div key={field.key} className="form-group">
            <label className="form-label">{field.label}</label>
            <div className="claude-input-row">
              <input
                className="input"
                type={field.secret && !showSecrets[field.key] ? 'password' : 'text'}
                value={vars[field.key] || ''}
                onChange={e => setVars(v => ({ ...v, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                autoComplete="off"
              />
              {field.secret && (
                <button
                  className="btn btn-ghost claude-reveal"
                  type="button"
                  onClick={() => setShow(s => ({ ...s, [field.key]: !s[field.key] }))}
                  aria-label={showSecrets[field.key] ? 'Hide' : 'Show'}
                >
                  {showSecrets[field.key] ? '🙈' : '👁'}
                </button>
              )}
            </div>
            <p className="form-hint">{field.hint} Variable name: <code>{field.key}</code></p>
          </div>
        ))}
      </div>

      {/* Additional custom env vars */}
      {extra.length > 0 && (
        <div className="claude-extra">
          <div className="claude-extra-title">Additional variables</div>
          {extra.map((ev, i) => (
            <div key={i} className="claude-extra-row">
              <input
                className="input claude-extra-key"
                value={ev.key}
                onChange={e => updateExtra(i, 'key', e.target.value)}
                placeholder="VARIABLE_NAME"
              />
              <input
                className="input claude-extra-value"
                value={ev.value}
                onChange={e => updateExtra(i, 'value', e.target.value)}
                placeholder="value"
              />
              <button className="btn btn-ghost" onClick={() => removeExtra(i)} aria-label="Remove">×</button>
            </div>
          ))}
        </div>
      )}

      <div className="claude-actions">
        <button className="btn btn-ghost" onClick={addExtra}>+ Add variable</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="claude-note">
        <strong>Note:</strong> Variables are stored in <code>/app/data</code> and visible via{' '}
        <code>docker inspect</code> on workspace containers. Do not use highly sensitive secrets
        that could cause harm if exposed on your local network.
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
        <ClaudeSection csrfToken={csrfToken} addToast={addToast} />
        <AccountSection csrfToken={csrfToken} addToast={addToast} />
        <AppearanceSection csrfToken={csrfToken} addToast={addToast} />
        <SoundSection csrfToken={csrfToken} />
        <UpdatesSection csrfToken={csrfToken} />
      </div>
    </div>
  );
}
