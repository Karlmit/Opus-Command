import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useDevice } from '../context/DeviceContext';
import { io } from 'socket.io-client';
import { THEMES, applyTheme, normalizeTheme } from '../lib/themes';
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

// Preserve THEMES order while grouping for display.
const THEME_GROUPS = THEMES.reduce((acc, t) => {
  (acc[t.group] = acc[t.group] || []).push(t);
  return acc;
}, {});

function AppearanceSection({ csrfToken }) {
  const [theme, setTheme] = useState(() => normalizeTheme(localStorage.getItem('theme')));

  useEffect(() => {
    fetch('/api/settings/theme').then(r => r.json()).then(d => setTheme(normalizeTheme(d.theme)));
  }, []);

  async function handleTheme(id) {
    setTheme(id);
    applyTheme(id);
    localStorage.setItem('theme', id);
    await fetch('/api/settings/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ theme: id }),
    });
  }

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">APPEARANCE</h2>
      {Object.entries(THEME_GROUPS).map(([group, themes]) => (
        <div key={group} className="theme-group">
          <span className="theme-group-label">{group}</span>
          <div className="theme-grid">
            {themes.map(t => (
              <button
                key={t.id}
                type="button"
                className={`theme-card${theme === t.id ? ' selected' : ''}`}
                onClick={() => handleTheme(t.id)}
                aria-pressed={theme === t.id}
              >
                <div className="theme-swatches">
                  {t.swatch.map((c, i) => (
                    <span key={i} className="theme-swatch" style={{ background: c }} />
                  ))}
                </div>
                <span className="theme-card-label">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
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
        <p className="github-scopes-title">Required scopes — classic token only</p>
        <p className="github-scopes-warning">
          GitHub's new fine-grained tokens do not support GitHub Packages / GHCR yet.
          You must use a <strong>classic</strong> token.
        </p>
        <ul className="github-scopes-list">
          <li><code>repo</code> — full read/write access to repositories, branches, and pull requests</li>
          <li><code>workflow</code> — add and update GitHub Actions workflow files</li>
          <li><code>write:packages</code> — push images to GitHub Container Registry (ghcr.io)</li>
        </ul>
        <p className="github-scopes-note">
          Go to{' '}
          <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">
            github.com/settings/tokens
          </a>{' '}
          → <strong>Generate new token</strong> → <strong>Generate new token (classic)</strong>.
          After saving here, open your project → <strong>Workspace</strong> tab → <strong>Recreate</strong> to apply.
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

function ConnectorsSection({ csrfToken, addToast }) {
  const [connectors, setConnectors] = useState([]);
  const [pairingToken, setPairingToken] = useState(null);
  const [pairName, setPairName] = useState('');
  const [pairLabels, setPairLabels] = useState('windows,vm');
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(null);

  async function loadConnectors() {
    try {
      const res = await fetch('/api/connectors');
      const data = await res.json();
      setConnectors(data.connectors || []);
    } catch {
      addToast('Could not load connectors.', 'error');
    }
  }

  useEffect(() => {
    loadConnectors();
    const timer = setInterval(loadConnectors, 10000);
    return () => clearInterval(timer);
  }, []);

  function labelsToArray(value) {
    return value.split(',').map(v => v.trim()).filter(Boolean);
  }

  function psQuote(value) {
    return `"${String(value || '').replace(/`/g, '``').replace(/"/g, '`"')}"`;
  }

  async function createToken() {
    setLoading(true);
    setPairingToken(null);
    try {
      const res = await fetch('/api/connectors/pairing-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ name: pairName || 'Windows Connector', ttlMinutes: 30 }),
      });
      const data = await res.json();
      if (data.token) {
        const name = pairName || 'Windows Connector';
        const server = window.location.origin;
        setPairingToken({
          ...data,
          server,
          name,
          labels: pairLabels,
          command: `& "C:\\OpusConnector\\OpusConnector.exe" --server ${psQuote(server)} --pair ${data.token} --name ${psQuote(name)} --labels ${psQuote(pairLabels)}`,
        });
      } else {
        addToast(data.error || 'Could not create pairing token.', 'error');
      }
    } catch {
      addToast('Could not create pairing token.', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function saveConnector(connector) {
    setSavingId(connector.id);
    try {
      const res = await fetch(`/api/connectors/${connector.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({
          name: connector.name,
          labels: labelsToArray(connector.labelText ?? connector.labels.join(',')),
        }),
      });
      const data = await res.json();
      if (data.connector) {
        setConnectors(prev => prev.map(item => item.id === data.connector.id ? data.connector : item));
        addToast('Connector updated.');
      } else {
        addToast(data.error || 'Connector update failed.', 'error');
      }
    } catch {
      addToast('Connector update failed.', 'error');
    } finally {
      setSavingId(null);
    }
  }

  function updateLocal(id, changes) {
    setConnectors(prev => prev.map(connector => connector.id === id ? { ...connector, ...changes } : connector));
  }

  return (
    <div className="settings-section connectors-section">
      <h2 className="settings-section-title">OPUS CONNECTORS</h2>

      <div className="connector-pairing">
        <div className="form-group">
          <label className="form-label">New connector name</label>
          <input className="input" value={pairName} onChange={e => setPairName(e.target.value)} placeholder="Windows VM" />
        </div>
        <div className="form-group">
          <label className="form-label">Default labels</label>
          <input className="input" value={pairLabels} onChange={e => setPairLabels(e.target.value)} placeholder="windows,android,adb" />
        </div>
        <button className="btn btn-primary" onClick={createToken} disabled={loading}>
          {loading ? 'Creating…' : 'Create Pairing Token'}
        </button>
      </div>

      {pairingToken && (
        <div className="connector-token">
          <span className="settings-label">GUI setup values</span>
          <div className="connector-token-grid">
            <span>Server URL</span><code>{pairingToken.server}</code>
            <span>Pairing token</span><code>{pairingToken.token}</code>
            <span>Name</span><code>{pairingToken.name}</code>
            <span>Labels</span><code>{pairingToken.labels}</code>
          </div>
          <span className="settings-label">Pairing command</span>
          <code>{pairingToken.command}</code>
          <p className="connector-token-hint">
            Or open Opus Connector 0.1.3, paste this server URL and token into the setup window, and click Connect. The connector should show Online, and this list updates within 10 seconds.
          </p>
        </div>
      )}

      <div className="connector-list">
        {connectors.length === 0 ? (
          <p className="panel-hint">No connectors paired yet.</p>
        ) : connectors.map(connector => (
          <div key={connector.id} className="connector-row">
            <div className="connector-row-header">
              <span className={`connector-status ${connector.status === 'online' ? 'online' : ''}`} />
              <input
                className="input connector-name-input"
                value={connector.name}
                onChange={e => updateLocal(connector.id, { name: e.target.value })}
              />
              <button className="btn btn-ghost" onClick={() => saveConnector(connector)} disabled={savingId === connector.id}>
                {savingId === connector.id ? 'Saving…' : 'Save'}
              </button>
            </div>
            <div className="connector-meta">
              <span>{connector.platform || 'windows'}</span>
              <span>{connector.hostname || 'unknown host'}</span>
              <span>{connector.status}</span>
            </div>
            <input
              className="input connector-label-input"
              value={connector.labelText ?? connector.labels.join(',')}
              onChange={e => updateLocal(connector.id, { labelText: e.target.value })}
              placeholder="windows,android,adb"
            />
            <div className="connector-labels">
              {(connector.labelText ? labelsToArray(connector.labelText) : connector.labels).map(label => (
                <span key={label} className="connector-label">{label}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeviceSection() {
  const { isMobile, override, setOverride, nativeMobile } = useDevice();
  const detected = nativeMobile ? 'touch/mobile' : 'mouse/desktop';

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">INTERFACE MODE</h2>
      <p className="panel-hint" style={{ marginBottom: 12 }}>
        Auto-detected: <strong>{detected}</strong> — currently using{' '}
        <strong>{isMobile ? 'mobile log viewer' : 'desktop terminal (xterm)'}</strong>.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { value: null, label: 'Auto', desc: 'Detect from pointer type (touch = mobile, mouse = desktop)' },
          { value: 'desktop', label: 'Force desktop', desc: 'Always use full xterm terminal, even on touch devices' },
          { value: 'mobile', label: 'Force mobile', desc: 'Always use read-only log viewer with command input' },
        ].map(opt => (
          <label key={String(opt.value)} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
            <input
              type="radio"
              name="device-mode"
              checked={override === opt.value}
              onChange={() => setOverride(opt.value)}
              style={{ marginTop: 3, flexShrink: 0 }}
            />
            <span>
              <span style={{ color: 'var(--color-text-primary)', fontWeight: 500, fontSize: 'var(--font-size-sm)' }}>{opt.label}</span>
              <br />
              <span style={{ color: 'var(--color-text-dim)', fontSize: 'var(--font-size-xs)' }}>{opt.desc}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Settings → Workspace Backends → Unraid LXC ─────────────────────────────────

// Fields for the legacy direct-SSH transport.
const LXC_SSH_FIELDS = [
  { key: 'host',       label: 'Unraid host / IP',          placeholder: '192.168.1.66' },
  { key: 'sshPort',    label: 'SSH port',                  placeholder: '22', type: 'number' },
  { key: 'sshUser',    label: 'SSH username',              placeholder: 'root' },
  { key: 'sshKeyPath', label: 'SSH private key path',      placeholder: '/app/data/ssh/opus-unraid-nopass' },
  { key: 'basePath',   label: 'LXC base path (rootfs/runtime)', placeholder: '/mnt/system_nvme/linux' },
  { key: 'sharePath',  label: 'Project share path (project files)', placeholder: '/mnt/user/opus-projects' },
  { key: 'dist',       label: 'Default LXC distro',        placeholder: 'ubuntu' },
  { key: 'release',    label: 'Default LXC release',       placeholder: 'noble' },
  { key: 'arch',       label: 'Default LXC architecture',  placeholder: 'amd64' },
];

function UnraidLxcSection({ csrfToken, addToast }) {
  const [config, setConfig] = useState(null);
  const [keyInput, setKeyInput] = useState('');         // SSH private key (write-only)
  const [agentKeyInput, setAgentKeyInput] = useState(''); // agent API key (write-only)
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');           // 'test' | 'preflight' | 'install' | 'reset-fingerprint'
  const [result, setResult] = useState(null);     // { kind, ok, message, checks? }

  useEffect(() => {
    fetch('/api/settings/unraid')
      .then(r => r.json())
      .then(d => setConfig(d.config))
      .catch(() => setConfig(null));
  }, []);

  function setField(key, value) {
    setConfig(c => ({ ...c, [key]: value }));
  }

  async function save() {
    setSaving(true);
    setResult(null);
    try {
      const body = { ...config };
      delete body.hasKey;
      delete body.hasAgentKey;
      delete body.envOverridden;
      if (keyInput.trim()) body.privateKey = keyInput;
      if (agentKeyInput.trim()) body.agentApiKey = agentKeyInput.trim();
      else delete body.agentApiKey;
      const res = await fetch('/api/settings/unraid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setConfig(data.config);
        setKeyInput('');
        setAgentKeyInput('');
        addToast(data.keyWritten ? 'Settings saved and SSH key stored.' : 'Settings saved.');
      } else {
        addToast(data.error || 'Save failed.', 'error');
      }
    } catch {
      addToast('Save failed.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function runAction(kind) {
    setBusy(kind);
    setResult(null);
    try {
      const res = await fetch(`/api/settings/unraid/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      });
      const data = await res.json();
      if (kind === 'test') {
        const agentNote = data.agentVersion ? ` (Opus Connect ${data.agentVersion})` : '';
        const pinNote = data.pinnedNow ? ' Certificate fingerprint pinned.' : '';
        setResult({ kind, ok: !!data.ok, message: data.ok ? `Connected to ${data.hostname}${agentNote}.${pinNote}` : (data.error || 'Connection failed') });
        if (data.pinnedNow) {
          const r = await fetch('/api/settings/unraid');
          const d = await r.json().catch(() => null);
          if (d?.config) setConfig(d.config);
        }
      } else if (kind === 'preflight') {
        setResult({ kind, ok: !!data.ok, message: data.error || (data.ok ? `All checks passed${data.hostname ? ` on ${data.hostname}` : ''}.` : 'Some checks failed.'), checks: data.checks || {} });
      } else if (kind === 'install') {
        setResult({ kind, ok: !!data.ok, message: data.ok ? `Helper installed at ${data.path}` : (data.error || 'Install failed') });
      } else if (kind === 'reset-fingerprint') {
        if (data.config) setConfig(data.config);
        setResult({ kind, ok: true, message: 'Pinned certificate cleared — run Test Connection to pin the new one.' });
      }
    } catch (err) {
      setResult({ kind, ok: false, message: 'Request failed.' });
    } finally {
      setBusy('');
    }
  }

  if (!config) {
    return (
      <div className="settings-section">
        <h2 className="settings-section-title">WORKSPACE BACKENDS — UNRAID LXC</h2>
        <p className="panel-hint">Loading…</p>
      </div>
    );
  }

  const envLocked = new Set(config.envOverridden || []);
  const agentMode = config.connectionMode === 'agent';

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">WORKSPACE BACKENDS — UNRAID LXC</h2>
      <p className="claude-section-desc">
        Optional advanced backend. Runs project workspaces as LXC containers on your
        Unraid server. Docker workspaces remain the default. Recommended connection:
        the Opus Connect agent — Opus Command then holds an API key for a small set of
        pre-approved actions instead of a root SSH key.
      </p>

      <label className="settings-toggle" style={{ marginBottom: 16 }}>
        <input
          type="checkbox"
          checked={!!config.enabled}
          disabled={envLocked.has('enabled')}
          onChange={e => setField('enabled', e.target.checked)}
        />
        <span>Enable Unraid LXC backend</span>
      </label>

      <div className="settings-form">
        <div className="form-group">
          <label className="form-label">
            Connection
            {envLocked.has('connectionMode') && <span className="panel-hint"> (set by environment)</span>}
          </label>
          <label className="settings-toggle">
            <input
              type="radio"
              name="unraid-connection-mode"
              checked={agentMode}
              disabled={envLocked.has('connectionMode')}
              onChange={() => setField('connectionMode', 'agent')}
            />
            <span>Opus Connect agent <span className="panel-hint">(recommended — install the Opus Connect plugin on Unraid)</span></span>
          </label>
          <label className="settings-toggle">
            <input
              type="radio"
              name="unraid-connection-mode"
              checked={!agentMode}
              disabled={envLocked.has('connectionMode')}
              onChange={() => setField('connectionMode', 'ssh')}
            />
            <span>Direct SSH <span className="panel-hint">(legacy — requires a root SSH key)</span></span>
          </label>
        </div>

        {agentMode ? (
          <>
            <div className="form-group">
              <label className="form-label">
                Agent URL
                {envLocked.has('agentUrl') && <span className="panel-hint"> (set by environment)</span>}
              </label>
              <input
                type="text"
                className="input"
                value={config.agentUrl ?? ''}
                placeholder="https://192.168.1.66:9123"
                disabled={envLocked.has('agentUrl')}
                onChange={e => setField('agentUrl', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                Agent API key {config.hasAgentKey
                  ? <span className="panel-hint">(a key is stored — paste to replace)</span>
                  : <span className="panel-hint">(none stored — copy it from Settings → Opus Connect on Unraid)</span>}
              </label>
              <input
                type="password"
                className="input"
                autoComplete="off"
                value={agentKeyInput}
                placeholder="paste the API key from the Opus Connect settings page"
                disabled={envLocked.has('agentApiKey')}
                onChange={e => setAgentKeyInput(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Pinned agent certificate (SHA-256)</label>
              {config.agentFingerprint ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <code style={{ fontSize: 'var(--font-size-xs)', wordBreak: 'break-all' }}>{config.agentFingerprint}</code>
                  <button type="button" className="btn" onClick={() => runAction('reset-fingerprint')} disabled={!!busy}>
                    {busy === 'reset-fingerprint' ? 'Resetting…' : 'Reset'}
                  </button>
                </div>
              ) : (
                <span className="panel-hint">Not pinned yet — pinned automatically on the first successful connection test.</span>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">
                Project share path (project files)
                {envLocked.has('sharePath') && <span className="panel-hint"> (set by environment)</span>}
              </label>
              <input
                type="text"
                className="input"
                value={config.sharePath ?? ''}
                placeholder="/mnt/user/opus-projects"
                disabled={envLocked.has('sharePath')}
                onChange={e => setField('sharePath', e.target.value)}
              />
              <span className="panel-hint">Must match the “Project share root” in the Opus Connect plugin settings.</span>
            </div>
          </>
        ) : (
          <>
            {LXC_SSH_FIELDS.map(f => (
              <div className="form-group" key={f.key}>
                <label className="form-label">
                  {f.label}
                  {envLocked.has(f.key) && <span className="panel-hint"> (set by environment)</span>}
                </label>
                <input
                  type={f.type || 'text'}
                  className="input"
                  value={config[f.key] ?? ''}
                  placeholder={f.placeholder}
                  disabled={envLocked.has(f.key)}
                  onChange={e => setField(f.key, e.target.value)}
                />
              </div>
            ))}

            <div className="form-group">
              <label className="form-label">
                SSH private key {config.hasKey ? <span className="panel-hint">(a key is stored — paste to replace)</span> : <span className="panel-hint">(none stored)</span>}
              </label>
              <textarea
                className="input"
                rows={4}
                spellCheck={false}
                style={{ fontFamily: 'monospace', resize: 'vertical' }}
                placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'}
                value={keyInput}
                onChange={e => setKeyInput(e.target.value)}
              />
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
          <button type="button" className="btn" onClick={() => runAction('test')} disabled={!!busy}>
            {busy === 'test' ? 'Testing…' : 'Test Connection'}
          </button>
          <button type="button" className="btn" onClick={() => runAction('preflight')} disabled={!!busy}>
            {busy === 'preflight' ? 'Running…' : 'Run LXC Preflight'}
          </button>
          {!agentMode && (
            <button type="button" className="btn" onClick={() => runAction('install')} disabled={!!busy}>
              {busy === 'install' ? 'Installing…' : 'Install Helper'}
            </button>
          )}
        </div>

        {result && (
          <div className={`settings-info-row ${result.ok ? 'status-ok' : 'status-error'}`} style={{ marginTop: 12, flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
            <span style={{ color: result.ok ? 'var(--color-success, #4caf50)' : 'var(--color-danger, #e57373)' }}>
              {result.ok ? '✓ ' : '✗ '}{result.message}
            </span>
            {result.checks && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-dim)' }}>
                {Object.entries(result.checks).map(([k, v]) => (
                  <li key={k}>{v ? '✓' : '✗'} {k}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const SETTINGS_TABS = [
  { id: 'general',      label: 'General' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'workspace',    label: 'Workspace' },
  { id: 'account',      label: 'Account' },
  { id: 'updates',      label: 'Updates' },
];

export default function Settings() {
  const { csrfToken } = useAuth();
  const { addToast } = useToast();
  const [tab, setTab] = useState(() => localStorage.getItem('settings-tab') || 'general');

  function selectTab(id) {
    setTab(id);
    localStorage.setItem('settings-tab', id);
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1 className="settings-title">SETTINGS</h1>
        <div className="settings-tabs" role="tablist">
          {SETTINGS_TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`settings-tab${tab === t.id ? ' active' : ''}`}
              onClick={() => selectTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-content">
        {tab === 'general' && (
          <>
            <AppearanceSection csrfToken={csrfToken} />
            <DeviceSection />
            <SoundSection csrfToken={csrfToken} />
          </>
        )}
        {tab === 'integrations' && (
          <>
            <GitHubSection csrfToken={csrfToken} addToast={addToast} />
            <ClaudeSection csrfToken={csrfToken} addToast={addToast} />
            <ConnectorsSection csrfToken={csrfToken} addToast={addToast} />
          </>
        )}
        {tab === 'workspace' && (
          <UnraidLxcSection csrfToken={csrfToken} addToast={addToast} />
        )}
        {tab === 'account' && (
          <AccountSection csrfToken={csrfToken} addToast={addToast} />
        )}
        {tab === 'updates' && (
          <UpdatesSection csrfToken={csrfToken} />
        )}
      </div>
    </div>
  );
}
