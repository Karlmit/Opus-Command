#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const baseUrl = (process.env.OPUS_COMMAND_URL || 'http://opus-command:3000').replace(/\/+$/, '');
const token = process.env.OPUS_WORKSPACE_TOKEN || '';

function usage() {
  console.log(`Opus workspace CLI

Usage:
  opus connectors list
  opus connector run <connector-label-or-name> -- powershell "Get-ComputerInfo"
  opus connector run <connector-label-or-name> -- cmd "dir C:\\"
  opus connector run <connector-label-or-name> --shell bash --script build.sh
  cat build.sh | opus connector run <connector-label-or-name> --shell bash --stdin
  opus connector jobs list
  opus connector jobs status <job-id>
  opus connector jobs cancel <job-id>
  opus connector put <local-path> <connector>:/remote/path
  opus connector get <connector>:/remote/path ./local-path
  opus connector artifacts get <job-id>
  opus browser screenshot <connector-label-or-name> <url> [output.png]
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

function capabilitySummary(connector) {
  const caps = connector.capabilities || {};
  const summary = [];
  if (caps.containers?.docker?.available) {
    summary.push(caps.containers.docker.accessible ? 'docker' : 'docker-no-access');
  }
  if (caps.containers?.dockerCompose?.available) summary.push('compose');
  if (caps.development?.git?.available) summary.push('git');
  if (caps.development?.node?.available) summary.push('node');
  if (caps.development?.npm?.available) summary.push('npm');
  if (caps.development?.python3?.available) summary.push('python3');
  if (caps.browserTesting?.playwright?.available) summary.push('playwright');
  if (caps.android?.adb?.available) summary.push('adb');
  if (caps.hardware?.serialDevices?.available) summary.push('serial');
  return summary;
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
    const capabilities = capabilitySummary(connector).join(',');
    const suffix = capabilities ? ` caps=${capabilities}` : '';
    console.log(`${connector.status.padEnd(8)} ${connector.name} (${connector.id}) ${labels}${suffix}`);
  }
}

async function findConnector(selector) {
  const data = await request('GET', '/api/connectors');
  const matches = (data.connectors || []).filter(connector => matchesConnector(connector, selector));
  if (matches.length === 0) fail(`No connector matched "${selector}". Run: opus connectors list`);
  return matches.find(connector => connector.status === 'online') || matches[0];
}

function parseEnv(values) {
  const env = {};
  for (const value of values) {
    const idx = String(value).indexOf('=');
    if (idx <= 0) continue;
    env[String(value).slice(0, idx)] = String(value).slice(idx + 1);
  }
  return env;
}

function parseConnectorPath(value) {
  const match = String(value || '').match(/^([^:]+):(.+)$/);
  if (!match) fail(`Expected connector path like <connector>:/path, got "${value}"`);
  return { selector: match[1], remotePath: match[2] };
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function parseRunArgs(args) {
  const selector = args[0];
  if (!selector) {
    usage();
    process.exit(1);
  }

  const options = {
    selector,
    shell: undefined,
    command: undefined,
    cwd: process.env.OPUS_CONNECTOR_CWD || undefined,
    timeoutMs: Number(process.env.OPUS_CONNECTOR_TIMEOUT_MS || 30 * 60 * 1000),
    envValues: [],
    wait: true,
  };

  const separator = args.indexOf('--');
  const optionArgs = separator === -1 ? args.slice(1) : args.slice(1, separator);
  for (let i = 0; i < optionArgs.length; i += 1) {
    const arg = optionArgs[i];
    if (arg === '--shell') options.shell = optionArgs[++i];
    else if (arg === '--cwd') options.cwd = optionArgs[++i];
    else if (arg === '--env') options.envValues.push(optionArgs[++i]);
    else if (arg === '--timeout-ms') options.timeoutMs = Number(optionArgs[++i]);
    else if (arg === '--wait') options.wait = optionArgs[++i] !== 'false';
    else if (arg === '--script') options.scriptPath = optionArgs[++i];
    else if (arg === '--stdin') options.stdin = true;
    else fail(`Unknown run option: ${arg}`);
  }

  if (separator !== -1) {
    const commandArgs = args.slice(separator + 1);
    if (commandArgs.length < 2) {
      usage();
      process.exit(1);
    }
    options.shell = options.shell || commandArgs[0];
    options.command = commandArgs.slice(1).join(' ');
  }

  return options;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

async function runConnector(args) {
  const options = parseRunArgs(args);
  if (!options.command && !options.scriptPath && !options.stdin) {
    usage();
    process.exit(1);
  }

  let script;
  let stdin;
  if (options.scriptPath) {
    script = {
      name: path.basename(options.scriptPath),
      content: fs.readFileSync(options.scriptPath, 'utf8'),
    };
  }
  if (options.stdin) {
    const input = await readStdin();
    if (!options.command && !script) {
      script = {
        name: `stdin.${String(options.shell || 'bash').toLowerCase().includes('python') ? 'py' : 'sh'}`,
        content: input,
      };
    } else {
      stdin = input;
    }
  }

  const connector = await findConnector(options.selector);
  const endpoint = `/api/connectors/${connector.id}/jobs${options.wait ? '' : '?wait=false'}`;
  const data = await request('POST', endpoint, {
    shell: options.shell,
    command: options.command,
    cwd: options.cwd,
    env: parseEnv(options.envValues),
    stdin,
    script,
    timeoutMs: options.timeoutMs,
  });

  if (!options.wait) {
    console.log(data.jobId);
    return;
  }

  const job = data.job;
  if (job.stdout) process.stdout.write(job.stdout);
  if (job.stderr) process.stderr.write(job.stderr);
  console.error(`\n[opus] job ${job.id} ${job.status} on ${connector.name}; exit ${job.exitCode}`);
  if (job.artifacts?.length) {
    console.error(`[opus] artifacts: opus connector artifacts get ${job.id}`);
  }
  process.exit(Number.isInteger(job.exitCode) ? job.exitCode : 1);
}

async function listJobs(args) {
  const params = new URLSearchParams();
  if (args[0]) {
    const connector = await findConnector(args[0]);
    params.set('connectorId', connector.id);
  }
  const data = await request('GET', `/api/connectors/jobs${params.toString() ? `?${params}` : ''}`);
  for (const job of data.jobs || []) {
    const exit = Number.isInteger(job.exitCode) ? ` exit=${job.exitCode}` : '';
    console.log(`${job.status.padEnd(9)} ${job.id} ${job.shell} ${job.command}${exit}`);
  }
}

async function jobStatus(args) {
  const jobId = args[0];
  if (!jobId) {
    usage();
    process.exit(1);
  }
  const data = await request('GET', `/api/connectors/jobs/${jobId}`);
  console.log(JSON.stringify(data.job, null, 2));
}

async function cancelJob(args) {
  const jobId = args[0];
  if (!jobId) {
    usage();
    process.exit(1);
  }
  const data = await request('POST', `/api/connectors/jobs/${jobId}/cancel`);
  console.log(`${data.job.id} ${data.job.status}`);
}

async function putFile(args) {
  const localPath = args[0];
  const remote = parseConnectorPath(args[1]);
  if (!localPath || !remote.remotePath) {
    usage();
    process.exit(1);
  }
  const connector = await findConnector(remote.selector);
  const response = await fetch(`${baseUrl}/api/connectors/${connector.id}/files/upload?path=${encodeURIComponent(remote.remotePath)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: fs.createReadStream(localPath),
    duplex: 'half',
  });
  if (!response.ok) {
    const text = await response.text();
    fail(`Opus API ${response.status}: ${text || response.statusText}`);
  }
  const data = await response.json();
  console.log(`${localPath} -> ${connector.name}:${data.file.path}`);
}

async function getFile(args) {
  const remote = parseConnectorPath(args[0]);
  const localPath = args[1];
  if (!remote.remotePath || !localPath) {
    usage();
    process.exit(1);
  }
  const connector = await findConnector(remote.selector);
  fs.mkdirSync(path.dirname(path.resolve(localPath)), { recursive: true });
  const response = await fetch(`${baseUrl}/api/connectors/${connector.id}/files/download?path=${encodeURIComponent(remote.remotePath)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const text = await response.text();
    fail(`Opus API ${response.status}: ${text || response.statusText}`);
  }
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(localPath);
    Readable.fromWeb(response.body).pipe(output);
    output.on('finish', resolve);
    output.on('error', reject);
  });
  console.log(`${connector.name}:${remote.remotePath} -> ${localPath}`);
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

async function browserScreenshot(args) {
  const selector = args[0];
  const url = args[1];
  const outputPath = args[2] || 'screenshot.png';
  if (!selector || !url) {
    usage();
    process.exit(1);
  }

  const connector = await findConnector(selector);
  const data = await request('POST', `/api/connectors/${connector.id}/jobs`, {
    shell: 'bash',
    command: `playwright screenshot --full-page --browser chromium ${shellQuote(url)} "$OPUS_CONNECTOR_ARTIFACT_DIR/screenshot.png"`,
    timeoutMs: Number(process.env.OPUS_CONNECTOR_TIMEOUT_MS || 120000),
  });

  const job = data.job;
  if (job.stdout) process.stdout.write(job.stdout);
  if (job.stderr) process.stderr.write(job.stderr);
  if (job.exitCode !== 0) process.exit(job.exitCode || 1);

  const screenshot = (job.artifacts || []).find(artifact => artifact.name === 'screenshot.png');
  if (!screenshot) fail(`Screenshot artifact was not produced by job ${job.id}.`);
  const bytes = await request('GET', `/api/connectors/artifacts/${screenshot.id}/download`);
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(bytes));
  console.log(outputPath);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'connectors' && args[1] === 'list') return listConnectors();
  if (args[0] === 'connector' && args[1] === 'run') return runConnector(args.slice(2));
  if (args[0] === 'connector' && args[1] === 'jobs' && args[2] === 'list') return listJobs(args.slice(3));
  if (args[0] === 'connector' && args[1] === 'jobs' && args[2] === 'status') return jobStatus(args.slice(3));
  if (args[0] === 'connector' && args[1] === 'jobs' && args[2] === 'cancel') return cancelJob(args.slice(3));
  if (args[0] === 'connector' && args[1] === 'put') return putFile(args.slice(2));
  if (args[0] === 'connector' && args[1] === 'get') return getFile(args.slice(2));
  if (args[0] === 'connector' && args[1] === 'artifacts' && args[2] === 'get') return getArtifacts(args.slice(3));
  if (args[0] === 'browser' && args[1] === 'screenshot') return browserScreenshot(args.slice(2));
  usage();
}

main().catch(err => fail(err.message || String(err)));
