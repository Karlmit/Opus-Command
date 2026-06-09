import { useEffect, useState } from 'react';
import './CdesktopIntegration.css';

const CDESKTOP_BUSY_STATES = new Set(['installing', 'starting', 'updating']);

function CdesktopControls({ projectId, csrfToken, addToast, status, setStatus, onLogs, onActivity }) {
  const [busy, setBusy] = useState(null);

  async function loadStatus() {
    const r = await fetch(`/api/projects/${projectId}/cdesktop/status`);
    const d = await r.json();
    setStatus(d);
    return d;
  }

  async function postAction(action) {
    const r = await fetch(`/api/projects/${projectId}/cdesktop/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: '{}',
    });
    const d = await r.json();
    setStatus(d);
    if (!r.ok) {
      throw new Error(d.error || `cdesktop ${action} failed.`);
    }
    return d;
  }

  async function pollStatusUntilSettled(action) {
    let latest = status;
    for (let i = 0; i < 18; i += 1) {
      await new Promise(resolve => setTimeout(resolve, i < 4 ? 1000 : 2000));
      latest = await loadStatus();
      onLogs?.();
      const state = latest?.status;
      if (!CDESKTOP_BUSY_STATES.has(state)) return latest;
    }
    onActivity?.(`${action} is still in progress. Status will continue refreshing.`);
    return latest;
  }

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await fetch(`/api/projects/${projectId}/cdesktop/status`);
        const d = await r.json();
        if (!cancelled) setStatus(d);
      } catch (_) {}
    }
    refresh();
    const t = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [projectId, setStatus]);

  async function runAction(action) {
    setBusy(action);
    const label = action.charAt(0).toUpperCase() + action.slice(1);
    onActivity?.(`${label} requested.`);
    onLogs?.();
    try {
      let next = await postAction(action);
      onActivity?.(`${label} completed. Status: ${next.status || 'unknown'}.`);
      onLogs?.();

      if (action === 'install' && next.status !== 'running') {
        onActivity?.('Starting cdesktop after install.');
        setBusy('start');
        next = await postAction('start');
        onActivity?.(`Start completed. Status: ${next.status || 'unknown'}.`);
      }

      const settled = await pollStatusUntilSettled(action);
      if (settled?.status === 'running') {
        addToast(action === 'update' ? 'cdesktop is updated and running.' : 'cdesktop is running.');
      } else if (settled?.status === 'error') {
        addToast(settled.error || 'cdesktop reported an error.', 'error');
        onActivity?.(settled.error || 'cdesktop reported an error.');
      }
    } catch (err) {
      addToast(err.message, 'error');
      onActivity?.(`Error: ${err.message}`);
      onLogs?.();
    } finally {
      setBusy(null);
    }
  }

  const state = status?.status || 'starting';
  const isRunning = state === 'running';
  const isBusy = !!busy || CDESKTOP_BUSY_STATES.has(state);

  return (
    <div className="cdesktop-controls">
      <div className={`ws-status-row status-${state}`}>
        <span className="ws-status-dot" />
        <span className="ws-status-text">cdesktop {state.replace('_', ' ')}</span>
        {status?.version && <span className="cdesktop-version">v{status.version}</span>}
      </div>
      <div className="cdesktop-actions">
        <button className="btn btn-ghost" onClick={() => runAction('install')} disabled={isBusy}>
          {busy === 'install' ? 'Installing...' : 'Install'}
        </button>
        <button className="btn btn-ghost" onClick={() => runAction('update')} disabled={isBusy}>
          {busy === 'update' ? 'Updating...' : 'Update'}
        </button>
        <button className="btn btn-primary" onClick={() => runAction('start')} disabled={isBusy || isRunning}>
          {busy === 'start' ? 'Starting...' : 'Start'}
        </button>
        <button className="btn btn-ghost" onClick={() => runAction('restart')} disabled={isBusy}>
          Restart
        </button>
        <button className="btn btn-ghost" onClick={() => runAction('stop')} disabled={isBusy || !isRunning}>
          Stop
        </button>
      </div>
    </div>
  );
}

export function CdesktopStatusIndicator({ projectId, status, setStatus }) {
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const r = await fetch(`/api/projects/${projectId}/cdesktop/status`);
        const d = await r.json();
        if (!cancelled) setStatus(d);
      } catch (_) {}
    }
    refresh();
    const t = setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [projectId, setStatus]);

  const state = status?.status || 'starting';
  return (
    <span
      className={`cdesktop-status-indicator status-${state}`}
      title={`cdesktop ${state.replace('_', ' ')}`}
      aria-label={`cdesktop ${state.replace('_', ' ')}`}
    >
      <span className="ws-status-dot" />
    </span>
  );
}

export function CdesktopSettingsPanel({ projectId, csrfToken, addToast, status, setStatus }) {
  const [logs, setLogs] = useState('');
  const [showLogs, setShowLogs] = useState(true);
  const [activity, setActivity] = useState([]);

  function addActivity(message) {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setActivity(prev => [`[${timestamp}] ${message}`, ...prev].slice(0, 12));
  }

  async function loadLogs() {
    try {
      const r = await fetch(`/api/projects/${projectId}/cdesktop/logs?tail=220`);
      const d = await r.json();
      setLogs(d.logs || 'No cdesktop logs.');
    } catch (err) {
      setLogs(err.message || 'Could not load cdesktop logs.');
    }
  }

  useEffect(() => {
    loadLogs();
  }, [projectId]);

  return (
    <div className="panel-content cdesktop-settings-panel">
      <div className="panel-section">
        <div className="panel-section-title">cdesktop status</div>
        <CdesktopControls
          projectId={projectId}
          csrfToken={csrfToken}
          addToast={addToast}
          status={status}
          setStatus={setStatus}
          onLogs={loadLogs}
          onActivity={addActivity}
        />
      </div>

      <div className="panel-section cdesktop-log-section">
        <div className="panel-section-header">
          <div className="panel-section-title">cdesktop logs</div>
          <div className="cdesktop-log-actions">
            <button className="btn btn-ghost" onClick={loadLogs}>Refresh</button>
            <button className="btn btn-ghost" onClick={() => setShowLogs(s => !s)}>
              {showLogs ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {showLogs && (
          <div className="panel-logs cdesktop-settings-logs">
            <pre>{[
              activity.length ? ['Opus Command activity:', ...activity, ''].join('\n') : '',
              logs || 'Loading cdesktop logs...',
            ].filter(Boolean).join('\n')}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

export function CdesktopPanel({ projectId, csrfToken, addToast, status, setStatus }) {
  const [logs, setLogs] = useState('');
  const [autoStarted, setAutoStarted] = useState(false);
  const iframeUrl = `/workspaces/${projectId}/cdesktop/`;

  async function loadStatus() {
    const r = await fetch(`/api/projects/${projectId}/cdesktop/status`);
    const d = await r.json();
    setStatus(d);
    return d;
  }

  async function loadLogs() {
    try {
      const r = await fetch(`/api/projects/${projectId}/cdesktop/logs?tail=120`);
      const d = await r.json();
      setLogs(d.logs || '');
    } catch (_) {
      setLogs('');
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const d = await loadStatus();
        if (cancelled) return;
        if (!autoStarted && d.status === 'stopped') {
          setAutoStarted(true);
          const r = await fetch(`/api/projects/${projectId}/cdesktop/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
            body: '{}',
          });
          setStatus(await r.json());
          setTimeout(loadStatus, 1500);
        } else if (d.status === 'error') {
          await loadLogs();
        }
      } catch (err) {
        if (!cancelled) addToast(err.message, 'error');
      }
    }
    init();
    const t = setInterval(() => {
      if (!cancelled) loadStatus().catch(() => {});
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [projectId]);

  const state = status?.status || 'starting';
  const isRunning = state === 'running';
  const showSetup = !isRunning;

  return (
    <div className="cdesktop-panel">
      {showSetup && (
        <div className="cdesktop-setup">
          <div className="panel-section">
            <div className="panel-section-title">Status</div>
            <p className="panel-hint">
              {status?.error || status?.message || 'Install cdesktop or start the workspace service.'}
            </p>
            {status?.nodeVersion && (
              <p className="panel-hint">Node: <code>{status.nodeVersion}</code></p>
            )}
            <button className="btn btn-ghost" onClick={loadLogs}>Refresh Logs</button>
          </div>
          {(logs || status?.error) && (
            <div className="panel-logs cdesktop-logs">
              <pre>{logs || status?.error}</pre>
            </div>
          )}
        </div>
      )}

      {isRunning && (
        <iframe
          className="cdesktop-frame"
          src={iframeUrl}
          title="cdesktop"
          allow="clipboard-read; clipboard-write"
        />
      )}
    </div>
  );
}
