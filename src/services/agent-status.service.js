const AGENT_STATUS = Object.freeze({
  READY: 'ready',
  WORKING: 'working',
  RUNNING_TOOL: 'running_tool',
  WAITING_FOR_INPUT: 'waiting_for_input',
  WAITING_FOR_APPROVAL: 'waiting_for_approval',
  DONE: 'done',
  ERROR: 'error',
  EXITED: 'exited',
  UNKNOWN: 'unknown',
});

const AGENT_STATUS_LABELS = Object.freeze({
  ready: 'Ready',
  working: 'Working',
  running_tool: 'Running tool',
  waiting_for_input: 'Waiting for input',
  waiting_for_approval: 'Waiting for approval',
  done: 'Done',
  error: 'Error',
  exited: 'Exited',
  unknown: 'Unknown',
});

const AGENT_STATUS_PRIORITY = Object.freeze({
  error: 1,
  waiting_for_approval: 2,
  waiting_for_input: 3,
  running_tool: 4,
  working: 5,
  done: 6,
  ready: 7,
  exited: 8,
  unknown: 9,
});

function normalizeAgentStatus(status) {
  return Object.prototype.hasOwnProperty.call(AGENT_STATUS_LABELS, status)
    ? status
    : AGENT_STATUS.UNKNOWN;
}

function agentStatusLabel(status) {
  return AGENT_STATUS_LABELS[normalizeAgentStatus(status)];
}

function compareAgentStatus(a, b) {
  return AGENT_STATUS_PRIORITY[normalizeAgentStatus(a)] - AGENT_STATUS_PRIORITY[normalizeAgentStatus(b)];
}

function pickMostImportantAgentStatus(statuses) {
  const normalized = statuses.map(normalizeAgentStatus);
  if (!normalized.length) return AGENT_STATUS.UNKNOWN;
  return normalized.sort(compareAgentStatus)[0];
}

function legacyAIStateToAgentStatus(aiState) {
  if (aiState === 'waiting') return AGENT_STATUS.WAITING_FOR_INPUT;
  if (aiState === 'active') return AGENT_STATUS.WORKING;
  if (aiState === 'done') return AGENT_STATUS.DONE;
  if (aiState === 'error') return AGENT_STATUS.ERROR;
  return AGENT_STATUS.READY;
}

module.exports = {
  AGENT_STATUS,
  AGENT_STATUS_LABELS,
  AGENT_STATUS_PRIORITY,
  normalizeAgentStatus,
  agentStatusLabel,
  compareAgentStatus,
  pickMostImportantAgentStatus,
  legacyAIStateToAgentStatus,
};
