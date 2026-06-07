const Dockerode = require('dockerode');
const { PROJECTS_DIR, HOST_PROJECTS_DIR } = require('../config');
const path = require('path');

const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });

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

async function createWorkspaceContainer(projectId, folderPath) {
  const image = await getWorkspaceImage();
  const name = containerName(projectId);
  const homeVol = homeVolumeName(projectId);
  // Use the HOST-side path for bind mounts — the Docker daemon resolves
  // paths relative to the host, not relative to this container's filesystem.
  const projectHostPath = path.join(HOST_PROJECTS_DIR, folderPath);

  // Load user-configured environment variables (e.g. Azure AI Foundry keys)
  const { getWorkspaceEnvVars } = require('./auth.service');
  const userEnv = getWorkspaceEnvVars().map(({ key, value }) => `${key}=${value}`);

  // Create home volume if it doesn't exist
  try {
    await docker.getVolume(homeVol).inspect();
  } catch {
    await docker.createVolume({ Name: homeVol });
  }

  // Remove existing container if any
  try {
    const existing = docker.getContainer(name);
    await existing.stop().catch(() => {});
    await existing.remove();
  } catch (_) {}

  const container = await docker.createContainer({
    name,
    Image: image,
    // Always override CMD with a keepalive — bash exits immediately without
    // a TTY attached, which would cause Docker to restart the container in a loop.
    // For the fallback image, also install Claude Code on first start.
    Cmd: ['bash', '-c',
      image === FALLBACK_IMAGE
        ? 'command -v claude || npm install -g @anthropic-ai/claude-code --quiet 2>&1 | tail -1 || true; ' +
          'grep -q "Opus Command" /etc/bash.bashrc 2>/dev/null || ' +
          'echo \'cd() { builtin cd "${@:-/workspace}"; }\' >> /etc/bash.bashrc; ' +
          'while true; do sleep 60; done'
        : 'while true; do sleep 60; done'
    ],
    Env: userEnv,
    HostConfig: {
      Binds: [
        `${projectHostPath}:/workspace`,
        `${homeVol}:/root`,
      ],
      // Workspace containers do NOT get the Docker socket
      RestartPolicy: { Name: 'unless-stopped' },
    },
    WorkingDir: '/workspace',
  });

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
    Cmd: ['bash', '-c', 'while true; do sleep 60; done'],
    Env: userEnv,
    HostConfig: {
      Binds: [`${projectHostPath}:/workspace`, `${homeVol}:/root`],
      RestartPolicy: { Name: 'unless-stopped' },
    },
    WorkingDir: '/workspace',
  });

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

module.exports = {
  docker,
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
