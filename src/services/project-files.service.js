const fs = require('fs');
const path = require('path');

const PLANNING_DIR_NAME = '.planning';
const PLANNING_GITIGNORE_ENTRY = '.planning/';

function planningPathFor(projectRoot) {
  return path.join(projectRoot, PLANNING_DIR_NAME);
}

function ensureGitignoreEntry(projectRoot) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  let content = '';
  try {
    content = fs.readFileSync(gitignorePath, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const hasEntry = content
    .split(/\r?\n/)
    .some(line => line.trim() === PLANNING_GITIGNORE_ENTRY);
  if (hasEntry) return;

  const prefix = content && !content.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(gitignorePath, `${content}${prefix}${PLANNING_GITIGNORE_ENTRY}\n`, 'utf8');
}

function ensurePlanningArea(projectRoot) {
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(planningPathFor(projectRoot), { recursive: true });
  ensureGitignoreEntry(projectRoot);
}

function isPlanningRelativePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return normalized === PLANNING_DIR_NAME || normalized.startsWith(`${PLANNING_DIR_NAME}/`);
}

module.exports = {
  PLANNING_DIR_NAME,
  PLANNING_GITIGNORE_ENTRY,
  planningPathFor,
  ensurePlanningArea,
  isPlanningRelativePath,
};
