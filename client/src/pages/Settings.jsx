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
        <span className="settings-value font-mono">{version.startsWith('v') ? version : `v${version}`}</span>
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
                {isNewer(checkResult.current, checkResult.latest)
                  ? `Update available — v${semver(checkResult.current)} → v${checkResult.latest}`
                  : 'New build available — updated code has been published'
                }
                {checkResult.url && <>{' '}<a href={checkResult.url} target="_blank" rel="noopener noreferrer" className="update-link">What's new</a></>}
              </p>
              {checkResult.localHash && checkResult.remoteHash && (
                <p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-dim)' }}>
                  {checkResult.localHash} → {checkResult.remoteHash}
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

// Keys that are no longer used — silently dropped when saving
const LEGACY_KEYS = new Set(['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY']);

const AZURE_FIELDS = [
  {
    key: 'ANTHROPIC_FOUNDRY_RESOURCE',
    label: 'Resource name',
    placeholder: 'bl-ai-claudecode',
    hint: 'The subdomain of your Azure AI Foundry endpoint.',
    secret: false,
  },
  {
    key: 'ANTHROPIC_FOUNDRY_API_KEY',
    label: 'API key',
    placeholder: 'Your Azure AI Foundry key…',
    hint: 'Found in Azure AI Foundry → Keys and Endpoint.',
    secret: true,
  },
  {
    key: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    label: 'Model',
    placeholder: 'claude-sonnet-4-6',
    hint: 'The Claude model name deployed in your resource.',
    secret: false,
  },
];

// CLAUDE_CODE_USE_FOUNDRY=1 is always written to ~/.bashrc by the workspace
// init script alongside the above fields — no user input needed.

function ClaudeSection({ csrfToken, addToast }) {
  const [vars, setVars]        = useState({});
  const [saving, setSaving]    = useState(false);
  const [showSecrets, setShow] = useState({});

  useEffect(() => {
    fetch('/api/settings/workspace-env')
      .then(r => r.json())
      .then(data => {
        const map = {};
        (data.vars || []).forEach(({ key, value }) => {
          if (AZURE_FIELDS.some(f => f.key === key)) map[key] = value;
          // Legacy keys and unrecognised keys are silently dropped
        });
        setVars(map);
      })
      .catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    const allVars = AZURE_FIELDS
      .map(f => ({ key: f.key, value: vars[f.key] || '' }));
    try {
      const res = await fetch('/api/settings/workspace-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ vars: allVars }),
      });
      const data = await res.json();
      if (data.success) addToast('Claude Code settings saved.');
      else addToast(data.error || 'Save failed.', 'error');
    } catch { addToast('Save failed.', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="settings-section">
      <div className="claude-section-header">
        <h2 className="settings-section-title">CLAUDE CODE</h2>
        <span className="claude-section-badge">Azure AI Foundry</span>
      </div>
      <p className="claude-section-desc">
        These values are injected into every workspace container and written to <code>~/.bashrc</code>
        so Claude Code connects to Azure AI Foundry automatically.
        <code>CLAUDE_CODE_USE_FOUNDRY=1</code> is added automatically alongside them.
        After saving, open your project → <strong>Workspace</strong> tab → <strong>Recreate</strong> to apply.
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
                <button className="btn btn-ghost claude-reveal" type="button"
                  onClick={() => setShow(s => ({ ...s, [field.key]: !s[field.key] }))}
                  aria-label={showSecrets[field.key] ? 'Hide' : 'Show'}>
                  {showSecrets[field.key] ? '🙈' : '👁'}
                </button>
              )}
            </div>
            <p className="form-hint">{field.hint}</p>
          </div>
        ))}
      </div>

      <button className="btn btn-primary" onClick={save} disabled={saving} style={{ alignSelf: 'flex-start' }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

function GitHubSection({ csrfToken, addToast }) {
  const [token, setToken]     = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [show, setShow]       = useState(false);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    fetch('/api/settings/workspace-env')
      .then(r => r.json())
      .then(data => {
        const ghVar = (data.vars || []).find(v => v.key === 'GH_TOKEN');
        setHasToken(!!ghVar?.value);
      })
      .catch(() => {});
  }, []);

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/workspace-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ vars: [{ key: 'GH_TOKEN', value: token }] }),
      });
      const data = await res.json();
      if (data.success) {
        addToast('GitHub token saved.');
        setHasToken(true);
        setToken('');
        setShow(false);
      } else {
        addToast(data.error || 'Save failed.', 'error');
      }
    } catch { addToast('Save failed.', 'error'); }
    finally { setSaving(false); }
  }

  async function remove() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/workspace-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ vars: [{ key: 'GH_TOKEN', value: '' }] }),
      });
      const data = await res.json();
      if (data.success) { addToast('GitHub token removed.'); setHasToken(false); }
    } catch { addToast('Remove failed.', 'error'); }
    finally { setSaving(false); }
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">GITHUB</h2>

      {hasToken && (
        <div className="github-token-status">
          <span className="github-token-set">Token configured</span>
          <button className="btn btn-ghost" onClick={remove} disabled={saving}>Remove</button>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">{hasToken ? 'Replace token' : 'Personal Access Token'}</label>
        <div className="claude-input-row">
          <input
            className="input"
            type={show ? 'text' : 'password'}
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder={hasToken ? 'Enter new token to replace…' : 'ghp_…'}
            autoComplete="off"
          />
          <button className="btn btn-ghost claude-reveal" type="button"
            onClick={() => setShow(s => !s)}
            aria-label={show ? 'Hide' : 'Show'}>
            {show ? '🙈' : '👁'}
          </button>
        </div>
      </div>

      <div className="github-scopes">
        <p className="github-scopes-title">Required token permissions</p>
        <ul className="github-scopes-list">
          <li><code>repo</code> — read/write repositories, create branches &amp; pull requests</li>
          <li><code>workflow</code> — trigger and manage GitHub Actions runs</li>
          <li><code>write:packages</code> — push Docker images to GitHub Container Registry (GHCR)</li>
        </ul>
        <p className="github-scopes-note">
          Create a classic token at{' '}
          <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener noreferrer">
            github.com/settings/tokens/new
          </a>. After saving, open your project → <strong>Workspace</strong> tab → <strong>Recreate</strong> to apply.
        </p>
      </div>

      <button
        className="btn btn-primary"
        onClick={save}
        disabled={saving || !token}
        style={{ alignSelf: 'flex-start' }}
      >
        {saving ? 'Saving…' : 'Save Token'}
      </button>
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
        <GitHubSection csrfToken={csrfToken} addToast={addToast} />
        <ClaudeSection csrfToken={csrfToken} addToast={addToast} />
        <AccountSection csrfToken={csrfToken} addToast={addToast} />
        <AppearanceSection csrfToken={csrfToken} addToast={addToast} />
        <SoundSection csrfToken={csrfToken} />
        <UpdatesSection csrfToken={csrfToken} />
      </div>
    </div>
  );
}
