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
  status: text('status').default('stopped'),
  avatar: text('avatar').default(''),
  createdAt: integer('created_at').notNull(),
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

module.exports = { users, settings, projects, terminalSessions, activityLog };
