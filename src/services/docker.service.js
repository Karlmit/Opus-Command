const Dockerode = require('dockerode');
const { PROJECTS_DIR } = require('../config');
const path = require('path');

const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });

const WORKSPACE_IMAGES = {
  general: 'ghcr.io/karlmit/opus-command-workspace-general:latest',
  nodejs: 'ghcr.io/karlmit/opus-command-workspace-nodejs:latest',
  python: 'ghcr.io/karlmit/opus-command-workspace-python:latest',
  powershell: 'ghcr.io/karlmit/opus-command-workspace-powershell:latest',
};

// Fallback image used when workspace template images haven't been published yet.
// debian:bookworm-slim is ~30MB, always on Docker Hub, and has bash.
const FALLBACK_IMAGE = 'debian:bookworm-slim';

function containerName(projectId) {
  return `opus-workspace-${projectId}`;
}

function homeVolumeName(projectId) {
  return `opus-home-${projectId}`;
}

async function getImageForTemplate(template) {
  const imageName = WORKSPACE_IMAGES[template] || WORKSPACE_IMAGES.general;
  try {
    await docker.getImage(imageName).inspect();
    return imageName;
  } catch {
    // Try to pull the image
    try {
      await new Promise((resolve, reject) => {
        docker.pull(imageName, (err, stream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (err, output) => {
            if (err) reject(err);
            else resolve(output);
          });
        });
      });
      return imageName;
    } catch {
      console.warn(`[docker] Could not pull ${imageName}, falling back to ${FALLBACK_IMAGE}`);
      return FALLBACK_IMAGE;
    }
  }
}

async function createWorkspaceContainer(projectId, folderPath, template) {
  const image = await getImageForTemplate(template);
  const name = containerName(projectId);
  const homeVol = homeVolumeName(projectId);
  const projectHostPath = path.join(PROJECTS_DIR, folderPath);

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
    Cmd: !image.startsWith('ghcr.io/karlmit/opus-command-workspace')
      ? ['/bin/bash', '-c', 'while true; do sleep 60; done']
      : undefined,
    HostConfig: {
      Binds: [
        `${projectHostPath}:/workspace`,
        `${homeVol}:/root`,
      ],
      // NO Docker socket in workspace containers (FR-WORK-6)
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

async function recreateContainer(projectId, folderPath, template) {
  const homeVol = homeVolumeName(projectId);
  const image = await getImageForTemplate(template);
  const name = containerName(projectId);
  const projectHostPath = path.join(PROJECTS_DIR, folderPath);

  try {
    const existing = docker.getContainer(name);
    await existing.stop().catch(() => {});
    await existing.remove();
  } catch (_) {}

  const container = await docker.createContainer({
    name,
    Image: image,
    Cmd: !image.startsWith('ghcr.io/karlmit/opus-command-workspace')
      ? ['/bin/bash', '-c', 'while true; do sleep 60; done']
      : undefined,
    HostConfig: {
      Binds: [`${projectHostPath}:/workspace`, `${homeVol}:/root`],
      RestartPolicy: { Name: 'unless-stopped' },
    },
    WorkingDir: '/workspace',
  });

  await container.start();
  return { containerId: container.id };
}

async function rebuildContainer(projectId, folderPath, template) {
  const image = WORKSPACE_IMAGES[template] || WORKSPACE_IMAGES.general;

  // Pull latest image
  await new Promise((resolve, reject) => {
    docker.pull(image, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err, output) => {
        if (err) reject(err);
        else resolve(output);
      });
    });
  }).catch(err => {
    console.warn('[docker] Pull failed, using cached image:', err.message);
  });

  return recreateContainer(projectId, folderPath, template);
}

async function resetEnvironment(projectId, folderPath, template) {
  const homeVol = homeVolumeName(projectId);

  // Stop container first
  try {
    const existing = docker.getContainer(containerName(projectId));
    await existing.stop().catch(() => {});
    await existing.remove();
  } catch (_) {}

  // Remove home volume
  try {
    await docker.getVolume(homeVol).remove();
  } catch (_) {}

  // Recreate
  return recreateContainer(projectId, folderPath, template);
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
