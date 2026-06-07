const Dockerode = require('dockerode');
const { PROJECTS_DIR, HOST_PROJECTS_DIR } = require('../config');
const path = require('path');
const os   = require('os');

const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });

// User-defined bridge network so container names resolve as hostnames.
// Opus Command and all workspace containers join this network so the
// terminal-agent can be reached at opus-workspace-{id}:7681.
const INTERNAL_NETWORK = 'opus-internal';

// Single workspace template — Claude Code with Node.js/npm/npx
const WORKSPACE_IMAGE = 'ghcr.io/karlmit/opus-command-workspace-claude-code:latest';

// Fallback used until the GHCR image is published.
// node:20-slim has node, npm, npx — we can install Claude Code at first run.
const FALLBACK_IMAGE = 'node:20-slim';

function containerName(projectId) {
  return `opus-workspace-${projectId}`;
}

function homeVolumeName(projectId) {
  return `opus-home-${projectId}`;
}

async function getWorkspaceImage() {
  // Try the published GHCR image first
  try {
    await docker.getImage(WORKSPACE_IMAGE).inspect();
    return WORKSPACE_IMAGE;
  } catch {
    try {
      await new Promise((resolve, reject) => {
        docker.pull(WORKSPACE_IMAGE, (err, stream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve());
        });
      });
      return WORKSPACE_IMAGE;
    } catch {
      console.log(`[docker] GHCR workspace image not yet published, using ${FALLBACK_IMAGE}`);
      return FALLBACK_IMAGE;
    }
  }
}

// Shared startup Cmd — used by createWorkspaceContainer AND recreateContainer
// so every container (new, recreated, rebuilt, reset) runs the same init script.
function buildWorkspaceCmd(image) {
  const claudeSettings = JSON.stringify({
    model: 'sonnet',
    enabledPlugins: { 'azure@azure-skills': true },
    extraKnownMarketplaces: {
      'azure-skills': { source: { source: 'github', repo: 'microsoft/azure-skills' } },
    },
  });

  const initScript = [
    'mkdir -p ~/.claude ~/bin ~/.npm-global',
    '[ -f ~/.claude/CLAUDE.md ] || cp /etc/opus-command/CLAUDE.md ~/.claude/CLAUDE.md 2>/dev/null || true',
    `[ -f ~/.claude/settings.json ] || echo '${claudeSettings}' > ~/.claude/settings.json`,
    '[ -f ~/.npmrc ] || echo "prefix=${HOME}/.npm-global" > ~/.npmrc',
    // CLAUDE_CODE_USE_FOUNDRY=1 is required to activate Azure AI Foundry mode in Claude Code.
    // All four vars are written to ~/.bashrc so they survive shell restarts.
    // Idempotent: skipped if already present, and guarded by ANTHROPIC_FOUNDRY_RESOURCE being set.
    'grep -q "CLAUDE_CODE_USE_FOUNDRY" ~/.bashrc 2>/dev/null || ' +
    '[ -z "$ANTHROPIC_FOUNDRY_RESOURCE" ] || ' +
    'printf "\\n# Claude Code — Azure AI Foundry\\n' +
    'export CLAUDE_CODE_USE_FOUNDRY=1\\n' +
    'export ANTHROPIC_FOUNDRY_RESOURCE=$ANTHROPIC_FOUNDRY_RESOURCE\\n' +
    'export ANTHROPIC_DEFAULT_SONNET_MODEL=$ANTHROPIC_DEFAULT_SONNET_MODEL\\n' +
    'export ANTHROPIC_FOUNDRY_API_KEY=$ANTHROPIC_FOUNDRY_API_KEY\\n" >> ~/.bashrc',
  ].join('; ');

  const fallbackInit = image === FALLBACK_IMAGE
    ? 'command -v claude || npm install -g @anthropic-ai/claude-code --quiet 2>&1 | tail -1 || true; ' +
      'grep -q "Opus Command" /etc/bash.bashrc 2>/dev/null || ' +
      'printf \'\\nexport PATH="$HOME/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"\\n' +
      'export NPM_CONFIG_PREFIX="$HOME/.npm-global"\\n' +
      'cd() { builtin cd "${@:-/workspace}"; }\\n\' >> /etc/bash.bashrc; '
    : '';

  // Start the terminal-agent in the background if it's present in the image.
  // The agent owns PTY sessions so they survive Opus Command restarts.
  const agentStart =
    '[ -f /opt/terminal-agent/index.js ] && node /opt/terminal-agent/index.js &';

  return ['bash', '-c', fallbackInit + initScript + '; ' + agentStart + '; while true; do sleep 60; done'];
}

// ── Internal network management ──────────────────────────────────────────────

/**
 * Ensure the opus-internal Docker network exists and that the opus-command
 * container itself is connected to it. Called once at startup.
 * Silently no-ops when not running in Docker (development mode).
 */
async function ensureInternalNetwork() {
  try {
    await docker.createNetwork({
      Name: INTERNAL_NETWORK,
      Driver: 'bridge',
      CheckDuplicate: true,
    });
    console.log(`[docker] Created internal network ${INTERNAL_NETWORK}`);
  } catch (err) {
    // 409 = already exists — fine
    if (!err.message?.includes('already exists') && err.statusCode !== 409) {
      console.warn('[docker] Network create warning:', err.message);
    }
  }

  // Connect the opus-command container to the network so workspace containers
  // can be addressed by their container name (Docker user-defined network DNS).
  const selfId = os.hostname(); // Docker sets hostname to short container ID
  try {
    await docker.getNetwork(INTERNAL_NETWORK).connect({ Container: selfId });
    console.log(`[docker] Connected self (${selfId.slice(0, 12)}) to ${INTERNAL_NETWORK}`);
  } catch (err) {
    if (!err.message?.includes('already exists') && !err.message?.includes('already connected')) {
      // Not fatal — we might be in dev mode outside Docker
      console.warn('[docker] Self network connect warning:', err.message);
    }
  }
}

async function _connectToInternalNetwork(containerId) {
  try {
    await docker.getNetwork(INTERNAL_NETWORK).connect({ Container: containerId });
  } catch (err) {
    if (!err.message?.includes('already exists') && !err.message?.includes('already connected')) {
      console.warn('[docker] Container network connect warning:', err.message);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────

async function createWorkspaceContainer(projectId, folderPath) {
  const image = await getWorkspaceImage();
  const name = containerName(projectId);
  const homeVol = homeVolumeName(projectId);
  const projectHostPath = path.join(HOST_PROJECTS_DIR, folderPath);

  const { getWorkspaceEnvVars } = require('./auth.service');
  const userEnv = getWorkspaceEnvVars().map(({ key, value }) => `${key}=${value}`);

  try {
    await docker.getVolume(homeVol).inspect();
  } catch {
    await docker.createVolume({ Name: homeVol });
  }

  try {
    const existing = docker.getContainer(name);
    await existing.stop().catch(() => {});
    await existing.remove();
  } catch (_) {}

  const container = await docker.createContainer({
    name,
    Image: image,
    Cmd: buildWorkspaceCmd(image),
    Env: userEnv,
    HostConfig: {
      Binds: [`${projectHostPath}:/workspace`, `${homeVol}:/root`],
      RestartPolicy: { Name: 'unless-stopped' },
    },
    WorkingDir: '/workspace',
  });

  // Connect to internal network so opus-command can reach the terminal-agent by name
  await _connectToInternalNetwork(container.id);

  return { containerId: container.id, homeVolume: homeVol };
}

async function startContainer(projectId) {
  const container = docker.getContainer(containerName(projectId));
  await container.start();
  return getContainerStatus(projectId);
}

async function stopContainer(projectId) {
  const container = docker.getContainer(containerName(projectId));
  await container.stop();
  return getContainerStatus(projectId);
}

async function restartContainer(projectId) {
  const container = docker.getContainer(containerName(projectId));
  await container.restart();
  return getContainerStatus(projectId);
}

async function recreateContainer(projectId, folderPath) {
  const homeVol = homeVolumeName(projectId);
  const image = await getWorkspaceImage();
  const name = containerName(projectId);
  const projectHostPath = path.join(HOST_PROJECTS_DIR, folderPath);

  const { getWorkspaceEnvVars } = require('./auth.service');
  const userEnv = getWorkspaceEnvVars().map(({ key, value }) => `${key}=${value}`);

  try {
    const existing = docker.getContainer(name);
    await existing.stop().catch(() => {});
    await existing.remove();
  } catch (_) {}

  const container = await docker.createContainer({
    name,
    Image: image,
    Cmd: buildWorkspaceCmd(image),
    Env: userEnv,
    HostConfig: {
      Binds: [`${projectHostPath}:/workspace`, `${homeVol}:/root`],
      RestartPolicy: { Name: 'unless-stopped' },
    },
    WorkingDir: '/workspace',
  });

  await _connectToInternalNetwork(container.id);
  await container.start();
  return { containerId: container.id };
}

async function rebuildContainer(projectId, folderPath) {
  // Pull latest workspace image
  await new Promise((resolve) => {
    docker.pull(WORKSPACE_IMAGE, (err, stream) => {
      if (err || !stream) return resolve();
      docker.modem.followProgress(stream, () => resolve());
    });
  }).catch(() => {});

  return recreateContainer(projectId, folderPath);
}

async function resetEnvironment(projectId, folderPath) {
  const homeVol = homeVolumeName(projectId);

  try {
    const existing = docker.getContainer(containerName(projectId));
    await existing.stop().catch(() => {});
    await existing.remove();
  } catch (_) {}

  try {
    await docker.getVolume(homeVol).remove();
  } catch (_) {}

  return recreateContainer(projectId, folderPath);
}

async function removeWorkspace(projectId) {
  const name = containerName(projectId);
  const homeVol = homeVolumeName(projectId);

  try {
    const container = docker.getContainer(name);
    await container.stop().catch(() => {});
    await container.remove();
  } catch (_) {}

  try {
    await docker.getVolume(homeVol).remove();
  } catch (_) {}
}

async function getContainerStatus(projectId) {
  try {
    const container = docker.getContainer(containerName(projectId));
    const info = await container.inspect();
    const state = info.State;
    if (state.Running) return 'running';
    if (state.Restarting) return 'starting';
    if (state.Status === 'created') return 'starting';
    return 'stopped';
  } catch {
    return 'stopped';
  }
}

async function getContainerLogs(projectId, tail = 200) {
  try {
    const container = docker.getContainer(containerName(projectId));
    const logBuffer = await container.logs({
      follow: false,
      stdout: true,
      stderr: true,
      tail,
    });
    // Strip Docker log multiplexing headers (first 8 bytes of each chunk)
    const lines = [];
    let offset = 0;
    while (offset < logBuffer.length) {
      if (offset + 8 > logBuffer.length) break;
      const size = logBuffer.readUInt32BE(offset + 4);
      if (offset + 8 + size > logBuffer.length) break;
      const chunk = logBuffer.slice(offset + 8, offset + 8 + size).toString('utf8');
      lines.push(chunk);
      offset += 8 + size;
    }
    return lines.join('');
  } catch {
    return '';
  }
}

function streamContainerLogs(projectId, onData, onEnd) {
  const container = docker.getContainer(containerName(projectId));
  container.logs({ follow: true, stdout: true, stderr: true, tail: 50 }, (err, stream) => {
    if (err) return onEnd && onEnd(err);
    stream.on('data', chunk => {
      // Strip multiplexing header
      if (chunk.length > 8) {
        const data = chunk.slice(8).toString('utf8');
        onData(data);
      }
    });
    stream.on('end', () => onEnd && onEnd(null));
    stream.on('error', err => onEnd && onEnd(err));
    return stream;
  });
}

/* ── Self-update ──────────────────────────────────────────────────────────
 * Pull the new app image, then recreate own container from the fresh image.
 * The host is identified via os.hostname() which Docker sets to the short
 * container ID. We inspect self to get the full HostConfig so the new
 * container is created with identical mounts, ports, and env.
 * ─────────────────────────────────────────────────────────────────────── */
const APP_IMAGE = 'ghcr.io/karlmit/opus-command:latest';

async function selfUpdate(onProgress) {
  // 1. Identify own container
  const selfId = os.hostname();
  let selfInfo;
  try {
    selfInfo = await docker.getContainer(selfId).inspect();
  } catch {
    throw new Error('Cannot identify own container. Make sure the container name matches.');
  }

  const imageName = selfInfo.Config.Image;

  // 2. Pull latest image
  onProgress({ step: 'pull', message: 'Pulling latest image…' });
  await new Promise((resolve, reject) => {
    docker.pull(imageName, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve(), (event) => {
        if (event.status) onProgress({ step: 'pull', message: event.status });
      });
    });
  });

  // 3. Check if actually a new image
  const newImage = await docker.getImage(imageName).inspect();
  if (newImage.Id === selfInfo.Image) {
    return { alreadyLatest: true };
  }

  // 4. Build the conductor script.
  //
  //    PROBLEM WITH THE PREVIOUS APPROACH:
  //    When the old code called `docker stop <self>`, it killed its own
  //    Node.js process. `newContainer.start()` and the rename never ran.
  //    The old container ended up stopped with nothing replacing it.
  //
  //    THE FIX — conductor container pattern:
  //    Launch a small container from the NEW image before stopping the old one.
  //    The conductor runs in its own process tree, completely separate from ours.
  //    When it calls `docker stop <us>`, our process dies but the conductor
  //    keeps running and completes the handoff.
  //
  //    The conductor uses Node.js + dockerode (already in /app of our image)
  //    to operate entirely via the Docker socket — no docker CLI needed.

  const originalName  = selfInfo.Name.replace(/^\//, '');
  const conductorName = `${originalName}-conductor`;

  // Clean up any conductor left from a previous failed attempt
  try { await docker.getContainer(conductorName).remove({ force: true }); } catch (_) {}

  // Inline script: wait → stop old → remove old → create new → start new
  const conductorScript = `
    const Dockerode = require('/app/node_modules/dockerode');
    const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });
    const wait = ms => new Promise(r => setTimeout(r, ms));

    async function run() {
      await wait(3000);
      console.log('[conductor] Stopping old container…');
      const old = docker.getContainer(${JSON.stringify(selfId)});
      await old.stop({ t: 10 }).catch(e => console.warn('stop:', e.message));
      await old.remove().catch(e => console.warn('remove:', e.message));

      console.log('[conductor] Creating new container…');
      const next = await docker.createContainer({
        name: ${JSON.stringify(originalName)},
        Image: ${JSON.stringify(imageName)},
        Env: ${JSON.stringify(selfInfo.Config.Env)},
        HostConfig: ${JSON.stringify(selfInfo.HostConfig)},
        Labels: ${JSON.stringify(selfInfo.Config.Labels || {})},
      });

      console.log('[conductor] Starting new container…');
      await next.start();
      console.log('[conductor] Done.');
    }

    run().catch(e => { console.error('[conductor] Error:', e.message); process.exit(1); });
  `;

  onProgress({ step: 'restart', message: 'Launching conductor…' });

  const conductor = await docker.createContainer({
    name: conductorName,
    Image: imageName,          // New image — has Node.js + dockerode at /app
    Cmd: ['node', '-e', conductorScript],
    WorkingDir: '/app',
    HostConfig: {
      AutoRemove: true,        // Self-cleans when done
      Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
    },
  });

  await conductor.start();

  onProgress({ step: 'restart', message: 'Restarting with new version — reconnecting shortly…' });

  // The conductor takes over from here. We return the response now so the
  // browser receives it before the conductor stops our container in ~3 seconds.
  return { updating: true };
}

module.exports = {
  docker,
  selfUpdate,
  ensureInternalNetwork,
  createWorkspaceContainer,
  startContainer,
  stopContainer,
  restartContainer,
  recreateContainer,
  rebuildContainer,
  resetEnvironment,
  removeWorkspace,
  getContainerStatus,
  getContainerLogs,
  streamContainerLogs,
  containerName,
  homeVolumeName,
};
