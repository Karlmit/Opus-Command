#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const baseUrl = (process.env.OPUS_COMMAND_URL || 'http://opus-command:3000').replace(/\/+$/, '');
const token = process.env.OPUS_WORKSPACE_TOKEN || '';

function usage() {
  console.log(`Opus workspace CLI

Usage:
  opus connectors list
  opus connector run <connector-label-or-name> -- powershell "Get-ComputerInfo"
  opus connector run <connector-label-or-name> -- cmd "dir C:\\"
  opus connector artifacts get <job-id>
`);
}

function fail(message, code = 1) {
  console.error(message);
  process.exit(code);
}

async function request(method, endpoint, body) {
  if (!token) fail('OPUS_WORKSPACE_TOKEN is not set. Rebuild or recreate this workspace from Opus Command.');
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    fail(`Opus API ${response.status}: ${text || response.statusText}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  return response.arrayBuffer();
}

function connectorLabels(connector) {
  return Array.isArray(connector.labels) ? connector.labels : [];
}

function matchesConnector(connector, selector) {
  const needle = selector.toLowerCase();
  return connector.id.toLowerCase() === needle
    || connector.name.toLowerCase() === needle
    || connector.name.toLowerCase().replace(/\s+/g, '-') === needle
    || connectorLabels(connector).some(label => String(label).toLowerCase() === needle);
}

async function listConnectors() {
  const data = await request('GET', '/api/connectors');
  const connectors = data.connectors || [];
  if (connectors.length === 0) {
    console.log('No connectors are paired.');
    return;
  }
  for (const connector of connectors) {
    const labels = connectorLabels(connector).join(',');
    console.log(`${connector.status.padEnd(8)} ${connector.name} (${connector.id}) ${labels}`);
  }
}

async function findConnector(selector) {
  const data = await request('GET', '/api/connectors');
  const matches = (data.connectors || []).filter(connector => matchesConnector(connector, selector));
  if (matches.length === 0) fail(`No connector matched "${selector}". Run: opus connectors list`);
  return matches.find(connector => connector.status === 'online') || matches[0];
}

async function runConnector(args) {
  const separator = args.indexOf('--');
  if (args.length < 3 || separator === -1 || separator + 2 >= args.length) {
    usage();
    process.exit(1);
  }

  const selector = args[0];
  const commandArgs = args.slice(separator + 1);
  const shell = commandArgs[0];
  const command = commandArgs.slice(1).join(' ');
  const connector = await findConnector(selector);
  const data = await request('POST', `/api/connectors/${connector.id}/jobs`, {
    shell,
    command,
    cwd: process.env.OPUS_CONNECTOR_CWD || undefined,
    timeoutMs: Number(process.env.OPUS_CONNECTOR_TIMEOUT_MS || 30 * 60 * 1000),
  });

  const job = data.job;
  if (job.stdout) process.stdout.write(job.stdout);
  if (job.stderr) process.stderr.write(job.stderr);
  console.error(`\n[opus] job ${job.id} ${job.status} on ${connector.name}; exit ${job.exitCode}`);
  if (job.artifacts?.length) {
    console.error(`[opus] artifacts: opus connector artifacts get ${job.id}`);
  }
  process.exit(Number.isInteger(job.exitCode) ? job.exitCode : 1);
}

async function getArtifacts(args) {
  const jobId = args[0];
  if (!jobId) {
    usage();
    process.exit(1);
  }

  const data = await request('GET', `/api/connectors/jobs/${jobId}`);
  const job = data.job;
  const outputDir = path.join(process.cwd(), '.opus', 'artifacts', job.id);
  fs.mkdirSync(outputDir, { recursive: true });

  for (const artifact of job.artifacts || []) {
    const bytes = await request('GET', `/api/connectors/artifacts/${artifact.id}/download`);
    const target = path.join(outputDir, path.basename(artifact.name));
    fs.writeFileSync(target, Buffer.from(bytes));
    console.log(target);
  }

  if (!job.artifacts?.length) console.log(`No artifacts for job ${job.id}.`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'connectors' && args[1] === 'list') return listConnectors();
  if (args[0] === 'connector' && args[1] === 'run') return runConnector(args.slice(2));
  if (args[0] === 'connector' && args[1] === 'artifacts' && args[2] === 'get') return getArtifacts(args.slice(3));
  usage();
}

main().catch(err => fail(err.message || String(err)));
