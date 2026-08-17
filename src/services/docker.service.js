const Dockerode = require('dockerode');
const { PROJECTS_DIR, HOST_PROJECTS_DIR, PORT } = require('../config');
const path = require('path');
const os   = require('os');
const fs = require('fs');
const { ensurePlanningArea } = require('./project-files.service');

const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });

// User-defined bridge network so container names resolve as hostnames.
// Opus Command and all workspace containers join this network so the
// terminal-agent can be reached at opus-workspace-{id}:7681.
const INTERNAL_NETWORK = 'opus-internal';

const OPUS_GIT_GUIDANCE = `

## Git and Opus Command

Opus Command's Git menu auto-discovers Git repositories under \`/workspace\`. It
checks \`/workspace/.git\` and one level down (e.g. \`/workspace/<project>/.git\`),
and recognises \`.git\` as a directory *or* a file — Git worktrees and submodules
store \`.git\` as a \`gitdir:\` pointer file. A repository nested in a subfolder
such as \`/workspace/my-project\` is fully supported; you do not need to move it
to \`/workspace\`.

- If more than one repository is found, the Git menu shows a repository picker
  and remembers the active one per project. Every Git-menu action (status, diff,
  commit, snapshot, push) operates on the active repository.
- Run Git commands from the repository root, or use \`git -C <repo-root> ...\`
  (for example \`git -C /workspace/my-project ...\`).
- If the project is not initialized and the user expects the Git menu to work,
  run \`git init\` in the repository folder before making changes.
- Check \`git status --porcelain\` before and after edits so the Git menu and your
  summary agree about changed files.
- Do not run destructive commands such as \`git reset --hard\`, \`git clean -fd\`,
  rebases, or history rewrites unless the user explicitly asks.
- Opus snapshots are annotated tags named \`snapshot/YYYY-MM-DD-HH-MM-SS\`; do not
  delete, move, or overwrite them unless the user explicitly asks.

Stage or commit only when the user asks. Otherwise leave changed files visible
for review in the Opus Command Git menu.
`;

const WORKSPACE_TEMPLATES = {
  'claude-code': {
    id: 'claude-code',
    label: 'Work-AzureAI',
    description: 'Claude Code with Azure AI Foundry settings.',
    image: 'ghcr.io/karlmit/opus-command-workspace-claude-code:latest',
    fallbackPackages: ['@anthropic-ai/claude-code'],
    azureClaude: true,
  },
  'work-login': {
    id: 'work-login',
    label: 'Work-Login',
    description: 'Claude Code and Codex CLI with manual sign-in — no Azure AI Foundry settings.',
    image: 'ghcr.io/karlmit/opus-command-workspace-private:latest',
    fallbackPackages: ['@anthropic-ai/claude-code', '@openai/codex'],
    azureClaude: false,
  },
  private: {
    id: 'private',
    label: 'Private',
    description: 'Claude Code and Codex CLI without Azure AI Foundry settings.',
    image: 'ghcr.io/karlmit/opus-command-workspace-private:latest',
    fallbackPackages: ['@anthropic-ai/claude-code', '@openai/codex'],
    azureClaude: false,
  },
};

// Fallback used until the GHCR image is published.
// node:20-slim has node, npm, npx — we can install Claude Code at first run.
const FALLBACK_IMAGE = 'node:20-slim';

function containerName(projectId) {
  return `opus-workspace-${projectId}`;
}

function homeVolumeName(projectId) {
  return `opus-home-${projectId}`;
}

function normalizeTemplate(template) {
  return WORKSPACE_TEMPLATES[template] ? template : 'claude-code';
}

// Container paths that the workspace owns and that user volumes must never
// override. Keeps /workspace and the home volume mount intact.
const PROTECTED_CONTAINER_PATHS = new Set(['/workspace', '/root', '/']);

/**
 * Translate the backend-neutral volume list (as stored in projects.volumes)
 * into Docker bind strings: "hostPath:containerPath:ro|rw".
 *
 * Invalid or unsafe entries are skipped:
 *  - missing host/container path
 *  - relative paths (must be absolute on both sides)
 *  - container paths that collide with required mounts (/workspace, /root, /)
 *
 * Returns an array of Docker bind strings.
 */
function buildExtraBinds(volumes) {
  if (!Array.isArray(volumes)) return [];
  const seen = new Set();
  const binds = [];
  for (const v of volumes) {
    if (!v || typeof v !== 'object') continue;
    const hostPath = String(v.hostPath || '').trim();
    const containerPath = String(v.containerPath || '').trim();
    if (!hostPath || !containerPath) continue;
    if (!path.isAbsolute(hostPath) || !path.isAbsolute(containerPath)) continue;
    const normContainer = path.posix.normalize(containerPath);
    if (PROTECTED_CONTAINER_PATHS.has(normContainer)) continue;
    if (seen.has(normContainer)) continue; // first definition wins
    seen.add(normContainer);
    const mode = v.readOnly === false ? 'rw' : 'ro';
    binds.push(`${hostPath}:${normContainer}:${mode}`);
  }
  return binds;
}

function getWorkspaceTemplate(template) {
  return WORKSPACE_TEMPLATES[normalizeTemplate(template)];
}

async function getWorkspaceImage(template) {
  const workspaceTemplate = getWorkspaceTemplate(template);
  const workspaceImage = workspaceTemplate.image;
  // Try the published GHCR image first
  try {
    await docker.getImage(workspaceImage).inspect();
    return workspaceImage;
  } catch {
    try {
      await new Promise((resolve, reject) => {
        docker.pull(workspaceImage, (err, stream) => {
          if (err) return reject(err);
          docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve());
        });
      });
      return workspaceImage;
    } catch {
      console.log(`[docker] GHCR workspace image ${workspaceImage} not yet published, using ${FALLBACK_IMAGE}`);
      return FALLBACK_IMAGE;
    }
  }
}

// Shared startup Cmd — used by createWorkspaceContainer AND recreateContainer
// so every container (new, recreated, rebuilt, reset) runs the same init script.
function buildWorkspaceCmd(image, template) {
  const { getWorkspaceInstructionTemplate } = require('./auth.service');
  const workspaceTemplate = getWorkspaceTemplate(template);
  const opusCliPath = path.join(__dirname, '..', 'workspace', 'opus-cli.js');
  const opusCliBase64 = fs.existsSync(opusCliPath)
    ? Buffer.from(fs.readFileSync(opusCliPath, 'utf8')).toString('base64')
    : '';
  const agentHookPath = path.join(__dirname, '..', 'workspace', 'opus-agent-hook.js');
  const agentHookBase64 = fs.existsSync(agentHookPath)
    ? Buffer.from(fs.readFileSync(agentHookPath, 'utf8')).toString('base64')
    : '';
  const configureHooksPath = path.join(__dirname, '..', 'workspace', 'configure-agent-hooks.js');
  const configureHooksBase64 = fs.existsSync(configureHooksPath)
    ? Buffer.from(fs.readFileSync(configureHooksPath, 'utf8')).toString('base64')
    : '';
  const connectorSkillPath = path.join(__dirname, '..', 'workspace', 'connectors.md');
  const connectorSkillBase64 = fs.existsSync(connectorSkillPath)
    ? Buffer.from(fs.readFileSync(connectorSkillPath, 'utf8')).toString('base64')
    : '';
  const claudeInstructionBase64 = Buffer.from(getWorkspaceInstructionTemplate('claude'), 'utf8').toString('base64');
  const agentsInstructionBase64 = Buffer.from(getWorkspaceInstructionTemplate('agents'), 'utf8').toString('base64');
  const gitGuidanceBase64 = Buffer.from(OPUS_GIT_GUIDANCE, 'utf8').toString('base64');
  const workClaudeSettings = JSON.stringify({
    model: 'sonnet',
    enabledPlugins: { 'azure@azure-skills': true },
    extraKnownMarketplaces: {
      'azure-skills': { source: { source: 'github', repo: 'microsoft/azure-skills' } },
    },
  });
  const privateClaudeSettings = JSON.stringify({ model: 'sonnet' });
  const claudeSettings = workspaceTemplate.azureClaude ? workClaudeSettings : privateClaudeSettings;

  const opusSkillPointer = '\\n## Opus Managed Skills\\n\\nAlso read:\\n- .opus/skills/connectors.md\\n';

  const initScript = [
    'mkdir -p ~/.claude ~/bin ~/.npm-global /workspace/.opus/skills /workspace/.planning',
    // Keep the planning area out of Git. `.planning` lives at /workspace/.planning,
    // so it only needs ignoring in a repo rooted at /workspace. If the only repo
    // is nested in a subfolder (e.g. /workspace/Opus-Command), `.planning` is
    // outside it — no entry needed, and we avoid leaving a stray
    // /workspace/.gitignore. With no repo yet, seed it so a future `git init`
    // at /workspace inherits the rule.
    'WS_REPO=$(git -C /workspace rev-parse --show-toplevel 2>/dev/null || true)',
    'NESTED=$(find /workspace -mindepth 2 -maxdepth 2 -name .git 2>/dev/null | head -1)',
    'if [ "$WS_REPO" = /workspace ] || [ -z "$NESTED" ]; then touch /workspace/.gitignore; grep -qxF ".planning/" /workspace/.gitignore 2>/dev/null || printf ".planning/\\n" >> /workspace/.gitignore; grep -qxF ".opus-pastes/" /workspace/.gitignore 2>/dev/null || printf ".opus-pastes/\\n" >> /workspace/.gitignore; grep -qxF ".claude/" /workspace/.gitignore 2>/dev/null || printf ".claude/\\n" >> /workspace/.gitignore; grep -qxF ".opus/" /workspace/.gitignore 2>/dev/null || printf ".opus/\\n" >> /workspace/.gitignore; grep -qxF ".agents/" /workspace/.gitignore 2>/dev/null || printf ".agents/\\n" >> /workspace/.gitignore; fi',
    // Clean up the removed cdesktop integration from existing workspace home volumes.
    'pkill -f "cdesktop" 2>/dev/null || true',
    'npm uninstall -g cdesktop >/dev/null 2>&1 || true',
    'rm -rf /root/.cdesktop /root/.config/cdesktop /root/.local/share/cdesktop 2>/dev/null || true',
    opusCliBase64
      ? `printf '%s' '${opusCliBase64}' | base64 -d > ~/bin/opus && chmod +x ~/bin/opus && cp ~/bin/opus /usr/local/bin/opus && chmod +x /usr/local/bin/opus`
      : 'true',
    agentHookBase64
      ? `printf '%s' '${agentHookBase64}' | base64 -d > /usr/local/bin/opus-agent-hook && chmod +x /usr/local/bin/opus-agent-hook`
      : 'true',
    configureHooksBase64
      ? `printf '%s' '${configureHooksBase64}' | base64 -d > /usr/local/bin/opus-configure-agent-hooks && chmod +x /usr/local/bin/opus-configure-agent-hooks`
      : 'true',
    connectorSkillBase64
      ? `printf '%s' '${connectorSkillBase64}' | base64 -d > /workspace/.opus/skills/connectors.md`
      : '[ -f /etc/opus-command/skills/connectors.md ] && cp /etc/opus-command/skills/connectors.md /workspace/.opus/skills/connectors.md 2>/dev/null || true',
    `[ -f ~/.claude/CLAUDE.md ] || printf '%s' '${claudeInstructionBase64}' | base64 -d > ~/.claude/CLAUDE.md`,
    `[ -f /workspace/CLAUDE.md ] || printf '%s' '${claudeInstructionBase64}' | base64 -d > /workspace/CLAUDE.md`,
    `[ -f /workspace/AGENTS.md ] || printf '%s' '${agentsInstructionBase64}' | base64 -d > /workspace/AGENTS.md`,
    `grep -q ".opus/skills/connectors.md" ~/.claude/CLAUDE.md 2>/dev/null || printf '${opusSkillPointer}' >> ~/.claude/CLAUDE.md`,
    `grep -q ".opus/skills/connectors.md" /workspace/CLAUDE.md 2>/dev/null || printf '${opusSkillPointer}' >> /workspace/CLAUDE.md`,
    `grep -q ".opus/skills/connectors.md" /workspace/AGENTS.md 2>/dev/null || printf '${opusSkillPointer}' >> /workspace/AGENTS.md`,
    `for f in ~/.claude/CLAUDE.md /workspace/CLAUDE.md /workspace/AGENTS.md; do grep -q "Opus Command's Git menu" "$f" 2>/dev/null || printf '%s' '${gitGuidanceBase64}' | base64 -d >> "$f"; done`,
    workspaceTemplate.azureClaude
      ? `[ -f ~/.claude/settings.json ] || echo '${claudeSettings}' > ~/.claude/settings.json`
      : `grep -q "azure-skills" ~/.claude/settings.json 2>/dev/null && echo '${claudeSettings}' > ~/.claude/settings.json || true`,
    '[ -f ~/.npmrc ] || echo "prefix=${HOME}/.npm-global" > ~/.npmrc',
    'grep -q "Opus Command PATH" ~/.bashrc 2>/dev/null || ' +
    'printf "\\n# Opus Command PATH\\n' +
    'export PATH=\\"$HOME/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH\\"\\n' +
    'export NPM_CONFIG_PREFIX=\\"$HOME/.npm-global\\"\\n' +
    'export IS_SANDBOX=1\\n" >> ~/.bashrc',
    workspaceTemplate.azureClaude
      ? (
        // CLAUDE_CODE_USE_FOUNDRY=1 is required to activate Azure AI Foundry mode in Claude Code.
        // All four vars are written to ~/.bashrc so they survive shell restarts.
        // Idempotent: skipped if already present, and guarded by ANTHROPIC_FOUNDRY_RESOURCE being set.
        'grep -q "CLAUDE_CODE_USE_FOUNDRY" ~/.bashrc 2>/dev/null || ' +
        '[ -z "$ANTHROPIC_FOUNDRY_RESOURCE" ] || ' +
        'printf "\\n# Claude Code — Azure AI Foundry\\n' +
        'export CLAUDE_CODE_USE_FOUNDRY=1\\n' +
        'export ANTHROPIC_FOUNDRY_RESOURCE=$ANTHROPIC_FOUNDRY_RESOURCE\\n' +
        'export ANTHROPIC_DEFAULT_SONNET_MODEL=$ANTHROPIC_DEFAULT_SONNET_MODEL\\n' +
        'export ANTHROPIC_FOUNDRY_API_KEY=$ANTHROPIC_FOUNDRY_API_KEY\\n" >> ~/.bashrc'
      )
      : 'sed -i "/# Claude Code .*Azure AI Foundry/,/^$/d;/ANTHROPIC_/d;/CLAUDE_CODE_USE_FOUNDRY/d" ~/.bashrc 2>/dev/null || true',
    // GH_TOKEN → write to ~/.bashrc so gh and git use it in interactive shells
    'grep -q "GH_TOKEN" ~/.bashrc 2>/dev/null || ' +
    '[ -z "$GH_TOKEN" ] || ' +
    'printf "\\n# GitHub CLI\\nexport GH_TOKEN=$GH_TOKEN\\n" >> ~/.bashrc',
    // Install gh CLI to ~/bin if not already present — persists via home volume across container recreations
    '[ -f ~/bin/gh ] || command -v gh >/dev/null 2>&1 || ' +
    '{ GH_TAG=$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest 2>/dev/null' +
    ' | grep \'"tag_name"\' | head -1 | grep -o \'"v[0-9.]*"\' | tr -d \'"\'); ' +
    'GH_VER=${GH_TAG#v}; ' +
    '[ -n "$GH_VER" ] && curl -fsSL "https://github.com/cli/cli/releases/download/${GH_TAG}/gh_${GH_VER}_linux_amd64.tar.gz"' +
    ' | tar -xz -C ~/bin --strip-components=2 "gh_${GH_VER}_linux_amd64/bin/gh"; } 2>/dev/null || true',
    // Configure git to use gh as the credential helper (idempotent)
    // Check ~/bin/gh explicitly since ~/bin isn't in PATH during non-interactive init
    '[ -z "$GH_TOKEN" ] || { GH=$(command -v gh 2>/dev/null || echo ~/bin/gh); [ -x "$GH" ] && GH_TOKEN=$GH_TOKEN "$GH" auth setup-git 2>/dev/null; } || true',
    '[ -x /usr/local/bin/opus-configure-agent-hooks ] && /usr/local/bin/opus-configure-agent-hooks || true',
  ].join('; ');

  const fallbackInstall = workspaceTemplate.fallbackPackages
    .map(pkg => `npm install -g ${pkg} --quiet 2>&1 | tail -1 || true`)
    .join('; ');

  const fallbackInit = image === FALLBACK_IMAGE
    ? 'command -v claude >/dev/null 2>&1 || ' + fallbackInstall + '; ' +
      (workspaceTemplate.fallbackPackages.includes('@openai/codex') ? 'command -v codex >/dev/null 2>&1 || npm install -g @openai/codex --quiet 2>&1 | tail -1 || true; ' : '') +
      'grep -q "Opus Command" /etc/bash.bashrc 2>/dev/null || ' +
      'printf \'\\nexport PATH="$HOME/bin:$HOME/.npm-global/bin:$HOME/.local/bin:$PATH"\\n' +
      'export NPM_CONFIG_PREFIX="$HOME/.npm-global"\\n' +
      'cd() { builtin cd "${@:-/workspace}"; }\\n\' >> /etc/bash.bashrc; '
    : '';

  // Inject the terminal-agent from its single canonical source and start it in
  // the background. The agent owns PTY sessions so they survive Opus Command
  // restarts; injecting at start (rather than COPYing into the image) keeps the
  // Docker and LXC backends running byte-identical agent code. Auth token comes
  // from TERMINAL_AGENT_TOKEN in the container env (see create/recreate).
  const agentPath = path.join(__dirname, '..', 'workspace', 'terminal-agent.js');
  const agentBase64 = fs.existsSync(agentPath)
    ? Buffer.from(fs.readFileSync(agentPath, 'utf8')).toString('base64')
    : '';
  const agentStart = agentBase64
    ? `mkdir -p /opt/terminal-agent; printf '%s' '${agentBase64}' | base64 -d > /opt/terminal-agent/index.js; node /opt/terminal-agent/index.js &`
    : '[ -f /opt/terminal-agent/index.js ] && node /opt/terminal-agent/index.js &';

  return ['bash', '-c', `${fallbackInit}${initScript}\n${agentStart}\nwhile true; do sleep 60; done`];
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
    await docker.getNetwork(INTERNAL_NETWORK).connect({
      Container: selfId,
      EndpointConfig: { Aliases: ['opus-command'] },
    });
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

// Shared container (re)creation: build env, ensure the planning area, replace
// any existing container with the same name, create, and join the internal
// network. Used by createWorkspaceContainer and recreateContainer so the two
// paths can never drift apart.
async function _createContainer(projectId, folderPath, template, volumes) {
  const templateId = normalizeTemplate(template);
  const image = await getWorkspaceImage(templateId);
  const name = containerName(projectId);
  const homeVol = homeVolumeName(projectId);
  const projectHostPath = path.join(HOST_PROJECTS_DIR, folderPath);
  const localProjectPath = path.join(PROJECTS_DIR, folderPath);
  const extraBinds = buildExtraBinds(volumes);

  const { getWorkspaceEnvVars, getWorkspaceAccessToken, getTerminalAgentToken } = require('./auth.service');
  const userEnv = [
    ...getWorkspaceEnvVars().map(({ key, value }) => `${key}=${value}`),
    `OPUS_COMMAND_URL=${process.env.OPUS_WORKSPACE_COMMAND_URL || `http://opus-command:${PORT}`}`,
    `OPUS_WORKSPACE_TOKEN=${getWorkspaceAccessToken()}`,
    `TERMINAL_AGENT_TOKEN=${getTerminalAgentToken(projectId)}`,
  ];

  ensurePlanningArea(localProjectPath);

  try {
    const existing = docker.getContainer(name);
    await existing.stop().catch(() => {});
    await existing.remove();
  } catch (_) {}

  const container = await docker.createContainer({
    name,
    Image: image,
    Cmd: buildWorkspaceCmd(image, templateId),
    Env: userEnv,
    HostConfig: {
      Binds: [`${projectHostPath}:/workspace`, `${homeVol}:/root`, ...extraBinds],
      RestartPolicy: { Name: 'unless-stopped' },
    },
    WorkingDir: '/workspace',
  });

  // Connect to internal network so opus-command can reach the terminal-agent by name
  await _connectToInternalNetwork(container.id);

  return { container, homeVol };
}

async function createWorkspaceContainer(projectId, folderPath, template = 'claude-code', volumes = []) {
  const homeVol = homeVolumeName(projectId);
  try {
    await docker.getVolume(homeVol).inspect();
  } catch {
    await docker.createVolume({ Name: homeVol });
  }

  const { container } = await _createContainer(projectId, folderPath, template, volumes);
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

async function recreateContainer(projectId, folderPath, template = 'claude-code', volumes = []) {
  const { container } = await _createContainer(projectId, folderPath, template, volumes);
  await container.start();
  return { containerId: container.id };
}

async function rebuildContainer(projectId, folderPath, template = 'claude-code', volumes = []) {
  const workspaceTemplate = getWorkspaceTemplate(template);
  // Pull latest workspace image
  await new Promise((resolve) => {
    docker.pull(workspaceTemplate.image, (err, stream) => {
      if (err || !stream) return resolve();
      docker.modem.followProgress(stream, () => resolve());
    });
  }).catch(() => {});

  return recreateContainer(projectId, folderPath, workspaceTemplate.id, volumes);
}

async function resetEnvironment(projectId, folderPath, template = 'claude-code', volumes = []) {
  const homeVol = homeVolumeName(projectId);

  try {
    const existing = docker.getContainer(containerName(projectId));
    await existing.stop().catch(() => {});
    await existing.remove();
  } catch (_) {}

  try {
    await docker.getVolume(homeVol).remove();
  } catch (_) {}

  return recreateContainer(projectId, folderPath, template, volumes);
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

// Return the Binds currently configured on the workspace container (as Docker
// bind strings), or [] if the container does not exist. Used to detect when a
// stopped workspace needs recreating to pick up changed volume config.
async function getContainerBinds(projectId) {
  try {
    const info = await docker.getContainer(containerName(projectId)).inspect();
    return info.HostConfig?.Binds || [];
  } catch {
    return [];
  }
}

// Resolve the workspace container's IP on the Docker network. Prefer the
// opus-internal network (the address opus-command actually uses to reach the
// terminal-agent by name); fall back to the first network that has an address.
// Returns null if the container is stopped or has no address yet.
async function getContainerIp(projectId) {
  try {
    const info = await docker.getContainer(containerName(projectId)).inspect();
    if (!info.State?.Running) return null;
    const nets = info.NetworkSettings?.Networks || {};
    const preferred = nets[INTERNAL_NETWORK]?.IPAddress;
    if (preferred) return preferred;
    for (const net of Object.values(nets)) {
      if (net?.IPAddress) return net.IPAddress;
    }
    return info.NetworkSettings?.IPAddress || null;
  } catch {
    return null;
  }
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
        Env: ${JSON.stringify(selfInfo.Config.Env.filter(e => !e.startsWith('APP_VERSION=')))},
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
  getContainerIp,
  getContainerBinds,
  getContainerLogs,
  streamContainerLogs,
  containerName,
  homeVolumeName,
  WORKSPACE_TEMPLATES,
  normalizeTemplate,
  buildExtraBinds,
};
