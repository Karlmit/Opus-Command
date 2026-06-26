const { sqliteTable, text, integer } = require('drizzle-orm/sqlite-core');

const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  folderPath: text('folder_path').notNull(),
  template: text('template').notNull(),
  containerId: text('container_id'),
  homeVolume: text('home_volume'),
  // Backend-neutral list of extra volume mounts, stored as a JSON array of
  // { hostPath, containerPath, readOnly, description }. Docker translates these
  // to bind strings; a future LXC backend can translate to lxc.mount.entry lines.
  volumes: text('volumes').default('[]'),
  status: text('status').default('stopped'),
  avatar: text('avatar').default(''),
  groupName: text('group_name').default(''),
  sortOrder: integer('sort_order').default(0),
  // Workspace backend — 'docker' (default) or 'unraid_lxc'. Docker workspaces
  // remain the portable default; unraid_lxc is the optional SSH-managed backend.
  workspaceBackend: text('workspace_backend').default('docker'),
  // LXC-specific fields (null for docker workspaces).
  lxcContainerName: text('lxc_container_name'),
  lxcTemplate: text('lxc_template'),
  lxcProjectPath: text('lxc_project_path'),
  lxcStatus: text('lxc_status'),
  lastStartedAt: integer('last_started_at'),
  lastStoppedAt: integer('last_stopped_at'),
  lastUpdatedAt: integer('last_updated_at'),
  // Active Git repository the Git menu operates on. Null = auto (prefer
  // /workspace, else the first repo discovered under /workspace). Set when the
  // user picks a repo via the Git menu's repository picker.
  gitRepoPath: text('git_repo_path'),
  createdAt: integer('created_at').notNull(),
});

// Per-project task board (kanban-style sections + tasks). Stored as JSON blobs
// keyed by project so the board syncs across devices/browsers instead of living
// only in each browser's localStorage. One row per project.
const projectTasks = sqliteTable('project_tasks', {
  projectId: integer('project_id').primaryKey(),
  tasks: text('tasks').default('[]'),
  sections: text('sections').default('[]'),
  updatedAt: integer('updated_at').notNull(),
});

const terminalSessions = sqliteTable('terminal_sessions', {
  id: text('id').primaryKey(),
  projectId: integer('project_id'),
  name: text('name').notNull(),
  scrollback: text('scrollback').default(''),
  aiState: text('ai_state').default('none'),
  createdAt: integer('created_at').notNull(),
});

const activityLog = sqliteTable('activity_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id'),
  type: text('type').notNull(),
  message: text('message').notNull(),
  createdAt: integer('created_at').notNull(),
});

const connectors = sqliteTable('connectors', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  secretHash: text('secret_hash').notNull(),
  platform: text('platform').default('windows'),
  hostname: text('hostname').default(''),
  version: text('version').default(''),
  labels: text('labels').default('[]'),
  capabilities: text('capabilities').default('{}'),
  status: text('status').default('offline'),
  lastSeenAt: integer('last_seen_at'),
  createdAt: integer('created_at').notNull(),
});

const connectorPairingTokens = sqliteTable('connector_pairing_tokens', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull(),
  name: text('name'),
  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  createdBy: integer('created_by'),
  createdAt: integer('created_at').notNull(),
});

const connectorJobs = sqliteTable('connector_jobs', {
  id: text('id').primaryKey(),
  connectorId: text('connector_id').notNull(),
  projectId: integer('project_id'),
  userId: integer('user_id'),
  shell: text('shell').notNull(),
  command: text('command').notNull(),
  cwd: text('cwd'),
  status: text('status').default('queued'),
  stdout: text('stdout').default(''),
  stderr: text('stderr').default(''),
  exitCode: integer('exit_code'),
  startedAt: integer('started_at'),
  endedAt: integer('ended_at'),
  createdAt: integer('created_at').notNull(),
});

const connectorArtifacts = sqliteTable('connector_artifacts', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  connectorId: text('connector_id').notNull(),
  name: text('name').notNull(),
  path: text('path').notNull(),
  size: integer('size').notNull(),
  createdAt: integer('created_at').notNull(),
});

module.exports = {
  users,
  settings,
  projects,
  projectTasks,
  terminalSessions,
  activityLog,
  connectors,
  connectorPairingTokens,
  connectorJobs,
  connectorArtifacts,
};
