const fs = require('fs');
const { AGENT_PATTERNS_PATH } = require('../config');

let cachedPatterns = null;
let cacheTime = 0;
const CACHE_TTL = 5000; // Re-read file every 5 seconds

function loadPatterns() {
  const now = Date.now();
  if (cachedPatterns && now - cacheTime < CACHE_TTL) {
    return cachedPatterns;
  }

  try {
    const raw = fs.readFileSync(AGENT_PATTERNS_PATH, 'utf8');
    cachedPatterns = JSON.parse(raw);
    cacheTime = now;
  } catch {
    cachedPatterns = { version: 1, agents: [] };
  }

  return cachedPatterns;
}

module.exports = { loadPatterns };
