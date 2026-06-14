export const AGENT_STATUS_LABELS = {
  ready: 'Ready',
  working: 'Working',
  running_tool: 'Running tool',
  waiting_for_input: 'Waiting for input',
  waiting_for_approval: 'Waiting for approval',
  done: 'Done',
  error: 'Error',
  exited: 'Exited',
  unknown: 'Unknown',
};

export const AGENT_STATUS_PRIORITY = {
  error: 1,
  waiting_for_approval: 2,
  waiting_for_input: 3,
  running_tool: 4,
  working: 5,
  done: 6,
  ready: 7,
  exited: 8,
  unknown: 9,
};

const STATUS_ICONS = {
  ready: '.',
  working: '~',
  running_tool: '>',
  waiting_for_input: '!',
  waiting_for_approval: '!',
  done: '+',
  error: '!',
  exited: 'x',
  unknown: '?',
};

export function normalizeAgentStatus(status) {
  return Object.prototype.hasOwnProperty.call(AGENT_STATUS_LABELS, status)
    ? status
    : 'unknown';
}

export function getAgentStatusLabel(status) {
  return AGENT_STATUS_LABELS[normalizeAgentStatus(status)];
}

export function getAgentStatusIcon(status) {
  return STATUS_ICONS[normalizeAgentStatus(status)];
}

export function getProjectAgentStatus(project) {
  if (project?.agentStatus?.status) return normalizeAgentStatus(project.agentStatus.status);
  if (project?.status === 'error') return 'error';
  if ((project?.aiWaiting || 0) > 0) return 'waiting_for_input';
  if ((project?.aiActive || project?.aiBusy || 0) > 0) return 'working';
  if ((project?.terminalCount || 0) > 0) return 'ready';
  return 'ready';
}

export function agentStatusClass(status) {
  return normalizeAgentStatus(status).replaceAll('_', '-');
}
