/**
 * workspace.service.js — backend dispatcher.
 *
 * Routes call this layer instead of a specific backend so Docker and Unraid LXC
 * workspaces share one control surface. Selection is by project.workspaceBackend
 * ('docker' default, 'unraid_lxc'). The Docker path delegates unchanged to
 * docker.service; only LXC projects take the SSH path.
 */

const docker = require('./docker.service');
const lxc = require('./unraid-lxc.service');

const BACKEND_DOCKER = 'docker';
const BACKEND_LXC = 'unraid_lxc';

function backendOf(project) {
  return project?.workspaceBackend === BACKEND_LXC ? BACKEND_LXC : BACKEND_DOCKER;
}

function isLxc(project) {
  return backendOf(project) === BACKEND_LXC;
}

function parseVolumes(value) {
  try {
    const v = JSON.parse(value || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// ── status ────────────────────────────────────────────────────────────────────

async function getStatus(project) {
  if (isLxc(project)) return lxc.getStatus(project);
  return docker.getContainerStatus(project.id);
}

// ── create ────────────────────────────────────────────────────────────────────
// Returns the set of fields the route should persist on the project row.

async function create(project) {
  if (isLxc(project)) {
    return lxc.createWorkspace(project);
  }
  const { containerId, homeVolume } = await docker.createWorkspaceContainer(
    project.id, project.folderPath, project.template, parseVolumes(project.volumes),
  );
  return { containerId, homeVolume };
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

async function start(project) {
  if (isLxc(project)) return lxc.startWorkspace(project);
  await docker.startContainer(project.id);
  return 'running';
}

async function stop(project) {
  if (isLxc(project)) return lxc.stopWorkspace(project);
  await docker.stopContainer(project.id);
  return 'stopped';
}

async function restart(project) {
  if (isLxc(project)) return lxc.restartWorkspace(project);
  await docker.restartContainer(project.id);
  return 'running';
}

async function update(project) {
  if (isLxc(project)) return lxc.updateWorkspace(project);
  // Docker: "update" = pull latest image and recreate.
  const { containerId } = await docker.rebuildContainer(
    project.id, project.folderPath, project.template, parseVolumes(project.volumes),
  );
  return { containerId };
}

async function remove(project) {
  if (isLxc(project)) return lxc.removeWorkspace(project);
  return docker.removeWorkspace(project.id);
}

// Bring a workspace's terminal-agent back when terminals stop connecting.
// LXC has a dedicated repair (helper refresh + agent restart + LAN probe);
// Docker bakes the agent into container init, so a container restart revives it.
async function repairTerminal(project) {
  if (isLxc(project)) return lxc.repairTerminalAgent(project);
  await docker.restartContainer(project.id);
  return { restarted: true };
}

// ── docker-only helpers (no-op / empty for LXC) ───────────────────────────────

async function getLogs(project, tail = 200) {
  if (isLxc(project)) return '';
  return docker.getContainerLogs(project.id, tail);
}

async function getBinds(project) {
  if (isLxc(project)) return [];
  return docker.getContainerBinds(project.id);
}

module.exports = {
  BACKEND_DOCKER,
  BACKEND_LXC,
  backendOf,
  isLxc,
  getStatus,
  create,
  start,
  stop,
  restart,
  update,
  remove,
  repairTerminal,
  getLogs,
  getBinds,
};
