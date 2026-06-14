#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const HOOK = '/usr/local/bin/opus-agent-hook';

const claudeHooks = [
  ['SessionStart', ''],
  ['UserPromptSubmit', ''],
  ['PreToolUse', '*'],
  ['PostToolUse', '*'],
  ['Notification', 'permission_prompt|idle_prompt'],
  ['Stop', ''],
  ['StopFailure', '*'],
  ['SessionEnd', '*'],
];

const codexHooks = [
  ['SessionStart', 'startup|resume|clear|compact'],
  ['UserPromptSubmit', ''],
  ['PreToolUse', '*'],
  ['PermissionRequest', '*'],
  ['PostToolUse', '*'],
  ['Stop', ''],
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function upsertHook(config, provider, event, matcher) {
  config.hooks ||= {};
  config.hooks[event] ||= [];
  const command = `${HOOK} ${provider} ${event}`;
  const groups = config.hooks[event];
  let group = groups.find(item => String(item.matcher || '') === String(matcher || ''));
  if (!group) {
    group = matcher ? { matcher, hooks: [] } : { hooks: [] };
    groups.push(group);
  }
  group.hooks ||= [];
  const existing = group.hooks.find(item => item.type === 'command' && item.command === command);
  if (!existing) {
    group.hooks.push({
      type: 'command',
      command,
      timeout: 5,
    });
  }
}

function configureClaude() {
  const file = '/root/.claude/settings.json';
  const config = readJson(file, {});
  for (const [event, matcher] of claudeHooks) upsertHook(config, 'claude', event, matcher);
  writeJson(file, config);
}

function configureCodex() {
  // System-level Codex hooks avoid touching the user's repository and load even
  // when project-local .codex config is not trusted.
  const file = '/.codex/hooks.json';
  const config = readJson(file, {});
  for (const [event, matcher] of codexHooks) upsertHook(config, 'codex', event, matcher);
  writeJson(file, config);
}

try { configureClaude(); } catch (err) { console.error(`[opus-hooks] Claude setup failed: ${err.message}`); }
try { configureCodex(); } catch (err) { console.error(`[opus-hooks] Codex setup failed: ${err.message}`); }
