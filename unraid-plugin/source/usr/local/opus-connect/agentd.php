#!/usr/bin/php -q
<?php
/*
 * Opus Connect — agentd.php
 *
 * Host-side agent for the Opus Connect Unraid plugin. Listens for HTTPS RPC
 * calls from Opus Command and executes ONLY the pre-approved, named actions
 * needed to manage Opus LXC workspaces. This replaces root SSH access:
 * Opus Command holds an API key for this agent instead of an SSH private key,
 * and the agent — not the caller — owns all host-side command construction.
 *
 * Security model:
 *   - TLS with a self-signed certificate (generated at install). Clients pin
 *     the certificate's SHA-256 fingerprint, so the API key and provisioning
 *     payloads (which contain workspace secrets) never travel unencrypted.
 *   - Bearer API key (constant-time comparison, throttled failures), stored
 *     0600 on the flash at /boot/config/plugins/opus-connect/api-key.
 *   - No host shell is ever constructed from caller input: every command runs
 *     through proc_open() with an argv array. Caller-supplied scripts execute
 *     only INSIDE a validated workspace container (lxc-attach), never on the
 *     host.
 *   - Container names must match /^opus-workspace-[a-z0-9][a-z0-9-]*$/ and
 *     project paths must live under the plugin-configured share root. The LXC
 *     base path, share root, and distro defaults come from the plugin config
 *     on this machine — the caller cannot redirect them.
 *   - Optional source-IP allowlist (ALLOWED_IPS in the plugin settings).
 *
 * The action surface is documented in the Opus Command repo at
 * .planning/unraid-lxc-ssh-actions.md ("Implemented Plugin Action Map").
 */

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }

const AGENT_VERSION   = '@VERSION@';
const PLUGIN_NAME     = 'opus-connect';
const MAX_HEAD_BYTES  = 16384;
const MAX_BODY_BYTES  = 16777216;   // 16 MiB — provisioning payloads are ~100 KB
const MAX_OUTPUT_BYTES = 8388608;   // cap captured stdout/stderr per stream
const NAME_RE         = '/^opus-workspace-[a-z0-9][a-z0-9-]{0,100}$/';
const TEMPLATE_RE     = '/^[a-z0-9][a-z0-9-]{0,31}$/';

$CFG_DIR  = '/boot/config/plugins/opus-connect';
$CFG_FILE = $CFG_DIR . '/opus-connect.cfg';
$KEY_FILE = $CFG_DIR . '/api-key';
$PEM_FILE = $CFG_DIR . '/cert/agent.pem';
$LOG_DIR  = '/var/log/opus-connect';
$LOG_FILE = $LOG_DIR . '/agent.log';
$RUN_DIR  = '/var/run/opus-connect';
$PID_FILE = $RUN_DIR . '/agentd.pid';
$HELPER   = '/usr/local/opus-connect/opus-lxc';

// ── config ────────────────────────────────────────────────────────────────────

function load_cfg(): array {
  global $CFG_FILE;
  $cfg = [
    'SERVICE'     => 'enable',
    'PORT'        => '9123',
    'BIND'        => '0.0.0.0',
    'ALLOWED_IPS' => '',
    'LXC_BASE'    => '',          // blank = auto-detect from lxc.lxcpath
    'SHARE_ROOT'  => '/mnt/user/opus-projects',
    'LXC_DIST'    => 'ubuntu',
    'LXC_RELEASE' => 'noble',
    'LXC_ARCH'    => 'amd64',
  ];
  foreach (@file($CFG_FILE) ?: [] as $line) {
    if (preg_match('/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"\r\n]*)"?\s*$/', $line, $m)) {
      $cfg[$m[1]] = $m[2];
    }
  }
  return $cfg;
}

// LXC base path: explicit setting wins, otherwise resolve the system lxcpath
// the same way the LXC tools do.
function lxc_base(array $cfg): string {
  if (trim($cfg['LXC_BASE']) !== '') return rtrim(trim($cfg['LXC_BASE']), '/');
  $r = run_cmd(['lxc-config', 'lxc.lxcpath'], null, 5);
  $p = trim($r['stdout']);
  if ($r['code'] === 0 && $p !== '') return rtrim($p, '/');
  foreach (@file('/etc/lxc/lxc.conf') ?: [] as $line) {
    if (preg_match('/^\s*lxc\.lxcpath\s*=\s*(.+)$/', $line, $m)) return rtrim(trim($m[1]), '/');
  }
  return '/var/lib/lxc';
}

// ── logging ───────────────────────────────────────────────────────────────────

function alog(string $msg): void {
  global $LOG_FILE;
  if (@filesize($LOG_FILE) > 1048576) @rename($LOG_FILE, $LOG_FILE . '.1');
  @file_put_contents($LOG_FILE, '[' . date('Y-m-d H:i:s') . '] ' . $msg . "\n", FILE_APPEND | LOCK_EX);
}

// ── command runner (argv arrays only — no host shell interpolation) ──────────

function run_cmd(array $argv, ?string $stdin, int $timeoutSec, array $extraEnv = []): array {
  $env = array_merge([
    'PATH' => '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'HOME' => '/root',
  ], $extraEnv);
  $spec = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
  $proc = @proc_open($argv, $spec, $pipes, '/', $env);
  if (!is_resource($proc)) {
    return ['code' => -1, 'stdout' => '', 'stderr' => 'failed to spawn ' . $argv[0], 'timedOut' => false];
  }
  foreach ($pipes as $p) stream_set_blocking($p, false);

  $stdout = '';
  $stderr = '';
  $inBuf  = (string)($stdin ?? '');
  $inOff  = 0;
  $inLen  = strlen($inBuf);
  if ($inLen === 0) { fclose($pipes[0]); $pipes[0] = null; }
  $deadline = microtime(true) + $timeoutSec;
  $timedOut = false;
  $exitCode = null;

  while (true) {
    $status = proc_get_status($proc);
    if (!$status['running'] && $exitCode === null) $exitCode = $status['exitcode'];

    $read = [];
    $write = [];
    if ($pipes[1]) $read[] = $pipes[1];
    if ($pipes[2]) $read[] = $pipes[2];
    if ($pipes[0]) $write[] = $pipes[0];

    if (!$read && !$write && !$status['running']) break;

    $left = $deadline - microtime(true);
    if ($left <= 0) { $timedOut = true; break; }

    if ($read || $write) {
      $except = null;
      $n = @stream_select($read, $write, $except, 0, 250000);
      if ($n === false) break;
    } else {
      usleep(50000);
      continue;
    }

    foreach ($read as $r) {
      $chunk = fread($r, 65536);
      if (is_string($chunk) && $chunk !== '') {
        if ($r === $pipes[1] && strlen($stdout) < MAX_OUTPUT_BYTES) $stdout .= $chunk;
        if ($r === $pipes[2] && strlen($stderr) < MAX_OUTPUT_BYTES) $stderr .= $chunk;
      } elseif (feof($r)) {
        if ($r === $pipes[1]) { fclose($pipes[1]); $pipes[1] = null; }
        if ($r === $pipes[2]) { fclose($pipes[2]); $pipes[2] = null; }
      }
    }
    foreach ($write as $w) {
      $n = @fwrite($w, substr($inBuf, $inOff, 65536));
      if ($n === false) { fclose($pipes[0]); $pipes[0] = null; continue; }
      $inOff += $n;
      if ($inOff >= $inLen) { fclose($pipes[0]); $pipes[0] = null; }
    }
  }

  if ($timedOut) {
    @proc_terminate($proc, 15);
    usleep(400000);
    $st = proc_get_status($proc);
    if ($st['running']) @proc_terminate($proc, 9);
  }
  foreach ($pipes as $p) { if ($p) @fclose($p); }
  $close = proc_close($proc);
  $code = $exitCode !== null ? $exitCode : $close;
  return ['code' => $code, 'stdout' => $stdout, 'stderr' => $stderr, 'timedOut' => $timedOut];
}

function run_helper(array $cfg, string $subcmd, array $args, int $timeoutSec): array {
  global $HELPER;
  $env = [
    'OPUS_LXC_BASE'    => lxc_base($cfg),
    'OPUS_SHARE_ROOT'  => rtrim($cfg['SHARE_ROOT'], '/'),
    'OPUS_LXC_DIST'    => $cfg['LXC_DIST'],
    'OPUS_LXC_RELEASE' => $cfg['LXC_RELEASE'],
    'OPUS_LXC_ARCH'    => $cfg['LXC_ARCH'],
  ];
  return run_cmd(array_merge([$HELPER, $subcmd], $args), null, $timeoutSec, $env);
}

// ── validation ────────────────────────────────────────────────────────────────

function valid_name($name): bool {
  return is_string($name) && preg_match(NAME_RE, $name) === 1;
}

function valid_project_path($path, array $cfg): bool {
  if (!is_string($path) || $path === '' || $path[0] !== '/') return false;
  if (preg_match('/[\x00-\x1f]/', $path) || strpos($path, '\\') !== false) return false;
  foreach (explode('/', $path) as $seg) { if ($seg === '..') return false; }
  $root = rtrim($cfg['SHARE_ROOT'], '/');
  return $root !== '' && strpos($path, $root . '/') === 0 && strlen($path) > strlen($root) + 1;
}

function valid_cwd($cwd): bool {
  if (!is_string($cwd)) return false;
  if ($cwd === '/workspace') return true;
  return strpos($cwd, '/workspace/') === 0
    && strpos($cwd, '..') === false
    && preg_match('/[\x00-\x1f]/', $cwd) !== 1;
}

function shq(string $v): string {
  return "'" . str_replace("'", "'\\''", $v) . "'";
}

function clamp_int($v, int $min, int $max, int $def): int {
  $n = is_numeric($v) ? (int)$v : $def;
  return max($min, min($max, $n));
}

function cmd_result(array $r): array {
  return ['code' => $r['code'], 'stdout' => $r['stdout'], 'stderr' => $r['stderr'], 'timedOut' => $r['timedOut']];
}

function fail(string $msg, int $http = 400): array {
  return ['__http' => $http, 'ok' => false, 'error' => $msg];
}

function parse_key_values(string $stdout): array {
  $out = [];
  foreach (explode("\n", $stdout) as $line) {
    if (preg_match('/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/', $line, $m)) $out[$m[1]] = $m[2];
  }
  return $out;
}

// ── actions ───────────────────────────────────────────────────────────────────

// name-only helper passthroughs: action → [helper subcommand, timeout seconds]
const SIMPLE_ACTIONS = [
  'lxc.status'  => ['status',   25],
  'lxc.start'   => ['start',    90],
  'lxc.stop'    => ['stop',     60],
  'lxc.restart' => ['restart', 150],
  'lxc.destroy' => ['destroy',  90],
];

function dispatch(array $cfg, string $action, array $p): array {
  if ($action === 'host.ping') {
    return [
      'ok' => true,
      'plugin' => PLUGIN_NAME,
      'agentVersion' => AGENT_VERSION,
      'hostname' => php_uname('n'),
      'time' => date('c'),
    ];
  }

  if ($action === 'lxc.preflight') {
    $r = run_helper($cfg, 'preflight', [], 60);
    return ['ok' => true] + cmd_result($r) + ['lxcBase' => lxc_base($cfg), 'shareRoot' => rtrim($cfg['SHARE_ROOT'], '/')];
  }

  if (isset(SIMPLE_ACTIONS[$action])) {
    if (!valid_name($p['name'] ?? null)) return fail('invalid container name');
    [$sub, $t] = SIMPLE_ACTIONS[$action];
    $r = run_helper($cfg, $sub, ['--name', $p['name']], $t);
    return ['ok' => true] + cmd_result($r);
  }

  switch ($action) {
    case 'lxc.create': {
      if (!valid_name($p['name'] ?? null)) return fail('invalid container name');
      if (!valid_project_path($p['projectPath'] ?? null, $cfg)) {
        return fail('project path must be under ' . rtrim($cfg['SHARE_ROOT'], '/'));
      }
      $template = $p['template'] ?? 'claude-code';
      if (!is_string($template) || preg_match(TEMPLATE_RE, $template) !== 1) return fail('invalid template');
      $r = run_helper($cfg, 'create', [
        '--name', $p['name'],
        '--project-path', $p['projectPath'],
        '--template', $template,
      ], 600);
      return ['ok' => true] + cmd_result($r);
    }

    case 'lxc.waitAttachable': {
      if (!valid_name($p['name'] ?? null)) return fail('invalid container name');
      $attempts = clamp_int($p['attempts'] ?? null, 1, 120, 25);
      $delayMs  = clamp_int($p['delayMs'] ?? null, 100, 3000, 400);
      $used = 0;
      $ready = false;
      for ($i = 1; $i <= $attempts; $i++) {
        $used = $i;
        $r = run_cmd(['lxc-attach', '-n', $p['name'], '--', 'true'], null, 8);
        if ($r['code'] === 0) { $ready = true; break; }
        usleep($delayMs * 1000);
      }
      return ['ok' => true, 'ready' => $ready, 'attempts' => $used];
    }

    case 'lxc.provision': {
      // Executes a caller-supplied provisioning script INSIDE the named
      // workspace container (never on the host). The script travels over TLS
      // and is delivered via stdin, so secrets in it never appear in argv.
      if (!valid_name($p['name'] ?? null)) return fail('invalid container name');
      $script = $p['script'] ?? null;
      if (!is_string($script) || $script === '') return fail('script is required');
      if (strlen($script) > MAX_BODY_BYTES / 2) return fail('script too large');
      $timeoutSec = clamp_int($p['timeoutSec'] ?? null, 30, 900, 600);
      $r = run_cmd(['lxc-attach', '-n', $p['name'], '--', 'bash', '-s'], $script, $timeoutSec);
      return ['ok' => true] + cmd_result($r);
    }

    case 'workspace.exec': {
      // Run one command inside the container via a login shell, mirroring the
      // legacy `lxc-attach -- bash -lc` SSH shape (Git menu, Docker controls,
      // terminal-agent restart). The command string is interpreted by bash
      // INSIDE the container only.
      if (!valid_name($p['name'] ?? null)) return fail('invalid container name');
      $command = $p['command'] ?? null;
      if (!is_string($command) || trim($command) === '') return fail('command is required');
      if (strlen($command) > 1048576) return fail('command too large');
      $cwd = $p['cwd'] ?? '/workspace';
      if (!valid_cwd($cwd)) return fail('cwd must be /workspace or below');
      $timeoutSec = clamp_int(isset($p['timeoutMs']) ? (int)ceil($p['timeoutMs'] / 1000) : null, 1, 600, 60);
      $inner = 'cd ' . shq($cwd) . ' 2>/dev/null; HOME=/root GIT_TERMINAL_PROMPT=0 ' . $command;
      $r = run_cmd(['lxc-attach', '-n', $p['name'], '--', 'bash', '-lc', $inner], null, $timeoutSec);
      return ['ok' => true] + cmd_result($r);
    }

    case 'terminal.setAgentToken': {
      // Rotate the per-workspace terminal-agent bearer token. The token is
      // delivered via stdin (argv is world-readable in /proc) and written 0600
      // outside the bind-mounted share. The agent re-reads it per request, so
      // no restart is needed.
      if (!valid_name($p['name'] ?? null)) return fail('invalid container name');
      $token = $p['token'] ?? null;
      if (!is_string($token) || preg_match('/^[\x21-\x7e]{16,512}$/', $token) !== 1) {
        return fail('invalid token');
      }
      $r = run_cmd([
        'lxc-attach', '-n', $p['name'], '--', 'bash', '-c',
        'umask 077; mkdir -p /etc/opus && cat > /etc/opus/terminal-agent.token && chmod 600 /etc/opus/terminal-agent.token',
      ], $token, 20);
      if ($r['code'] !== 0) return fail('token write failed: ' . trim($r['stderr'] ?: $r['stdout']), 500);
      return ['ok' => true];
    }

    case 'terminal.probeAgent': {
      // Probe the in-container terminal-agent over the LAN, exactly as the
      // Opus Command terminal proxy does. The IP is resolved HERE from the
      // container — a caller-supplied IP is never accepted, so this cannot be
      // used as a generic HTTP proxy.
      if (!valid_name($p['name'] ?? null)) return fail('invalid container name');
      $port = clamp_int($p['port'] ?? null, 1, 65535, 7681);
      $r = run_helper($cfg, 'status', ['--name', $p['name']], 25);
      $values = parse_key_values($r['stdout']);
      $ip = trim($values['IP'] ?? '');
      $state = $values['STATE'] ?? 'UNKNOWN';
      if ($r['code'] !== 0 || $ip === '' || !filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
        return ['ok' => true, 'state' => $state, 'ip' => null, 'healthy' => false];
      }
      $ctx = stream_context_create(['http' => ['timeout' => 4, 'ignore_errors' => true]]);
      $body = @file_get_contents('http://' . $ip . ':' . $port . '/health', false, $ctx);
      $healthy = is_string($body) && preg_match('/"status"\s*:\s*"ok"/', $body) === 1;
      return ['ok' => true, 'state' => $state, 'ip' => $ip, 'healthy' => $healthy];
    }
  }

  return fail('unknown action: ' . $action, 404);
}

// ── HTTP over TLS ─────────────────────────────────────────────────────────────

const STATUS_TEXT = [
  200 => 'OK', 400 => 'Bad Request', 401 => 'Unauthorized', 403 => 'Forbidden',
  404 => 'Not Found', 405 => 'Method Not Allowed', 413 => 'Payload Too Large',
  431 => 'Request Header Fields Too Large', 500 => 'Internal Server Error',
  503 => 'Service Unavailable',
];

function respond($conn, int $code, array $data): void {
  $body = json_encode($data, JSON_UNESCAPED_SLASHES);
  if ($body === false) { $body = '{"ok":false,"error":"response encoding failed"}'; $code = 500; }
  $head = 'HTTP/1.1 ' . $code . ' ' . (STATUS_TEXT[$code] ?? 'OK') . "\r\n"
    . "Content-Type: application/json\r\n"
    . 'Content-Length: ' . strlen($body) . "\r\n"
    . "Connection: close\r\n\r\n";
  $out = $head . $body;
  $off = 0;
  $len = strlen($out);
  while ($off < $len) {
    $n = @fwrite($conn, substr($out, $off, 65536));
    if ($n === false || $n === 0) break;
    $off += $n;
  }
}

function peer_ip(string $peer): string {
  $pos = strrpos($peer, ':');
  return $pos === false ? $peer : substr($peer, 0, $pos);
}

function read_exact($conn, int $want, string $already): ?string {
  $buf = $already;
  while (strlen($buf) < $want) {
    $chunk = fread($conn, min(65536, $want - strlen($buf)));
    if ($chunk === false || $chunk === '') {
      $meta = stream_get_meta_data($conn);
      if ($meta['timed_out'] || $meta['eof']) return null;
      usleep(10000);
      continue;
    }
    $buf .= $chunk;
  }
  return $buf;
}

function handle_conn($conn, string $peer, array $cfg): void {
  global $KEY_FILE;
  stream_set_blocking($conn, true);
  stream_set_timeout($conn, 20);

  $ip = peer_ip($peer);
  $allowed = array_filter(array_map('trim', explode(',', $cfg['ALLOWED_IPS'])));
  // The allowlist gates before the TLS handshake even starts.
  if ($allowed && !in_array($ip, $allowed, true)) {
    alog("DENY ip=$ip (not in ALLOWED_IPS)");
    fclose($conn);
    return;
  }

  if (!@stream_socket_enable_crypto($conn, true, STREAM_CRYPTO_METHOD_TLS_SERVER)) {
    alog("TLS handshake failed ip=$ip");
    fclose($conn);
    return;
  }

  // request head
  $head = '';
  while (strpos($head, "\r\n\r\n") === false) {
    $chunk = fread($conn, 4096);
    if ($chunk === false || $chunk === '') {
      $meta = stream_get_meta_data($conn);
      if ($meta['timed_out'] || $meta['eof']) { fclose($conn); return; }
      usleep(10000);
      continue;
    }
    $head .= $chunk;
    if (strlen($head) > MAX_HEAD_BYTES) { respond($conn, 431, ['ok' => false, 'error' => 'headers too large']); fclose($conn); return; }
  }
  [$rawHead, $rest] = explode("\r\n\r\n", $head, 2);
  $lines = explode("\r\n", $rawHead);
  if (!preg_match('#^(GET|POST)\s+(\S+)\s+HTTP/1\.[01]$#', $lines[0], $m)) {
    respond($conn, 400, ['ok' => false, 'error' => 'bad request line']);
    fclose($conn);
    return;
  }
  $method = $m[1];
  $path = $m[2];
  $headers = [];
  foreach (array_slice($lines, 1) as $line) {
    $pos = strpos($line, ':');
    if ($pos !== false) $headers[strtolower(trim(substr($line, 0, $pos)))] = trim(substr($line, $pos + 1));
  }

  // auth
  $key = trim((string)@file_get_contents($KEY_FILE));
  if ($key === '') {
    respond($conn, 503, ['ok' => false, 'error' => 'agent has no API key — open the Opus Connect settings page on Unraid']);
    fclose($conn);
    return;
  }
  $auth = $headers['authorization'] ?? '';
  $given = preg_match('/^Bearer\s+(\S+)$/i', $auth, $am) ? $am[1] : '';
  if ($given === '' || !hash_equals($key, $given)) {
    usleep(400000); // throttle brute force
    alog("AUTH-FAIL ip=$ip path=$path");
    respond($conn, 401, ['ok' => false, 'error' => 'invalid API key']);
    fclose($conn);
    return;
  }

  if ($method === 'GET' && $path === '/v1/ping') {
    respond($conn, 200, dispatch($cfg, 'host.ping', []));
    fclose($conn);
    return;
  }
  if ($method !== 'POST' || $path !== '/v1/rpc') {
    respond($conn, 404, ['ok' => false, 'error' => 'not found']);
    fclose($conn);
    return;
  }

  $cl = (int)($headers['content-length'] ?? 0);
  if ($cl <= 0) { respond($conn, 400, ['ok' => false, 'error' => 'missing body']); fclose($conn); return; }
  if ($cl > MAX_BODY_BYTES) { respond($conn, 413, ['ok' => false, 'error' => 'body too large']); fclose($conn); return; }
  $body = read_exact($conn, $cl, $rest);
  if ($body === null) { fclose($conn); return; }

  $req = json_decode($body, true);
  if (!is_array($req) || !is_string($req['action'] ?? null)) {
    respond($conn, 400, ['ok' => false, 'error' => 'body must be JSON {action, params}']);
    fclose($conn);
    return;
  }
  $action = $req['action'];
  $params = is_array($req['params'] ?? null) ? $req['params'] : [];

  $t0 = microtime(true);
  try {
    $result = dispatch($cfg, $action, $params);
  } catch (Throwable $e) {
    alog('ERROR action=' . $action . ' ip=' . $ip . ' ' . $e->getMessage());
    respond($conn, 500, ['ok' => false, 'error' => 'internal error: ' . $e->getMessage()]);
    fclose($conn);
    return;
  }
  $ms = (int)round((microtime(true) - $t0) * 1000);
  $http = 200;
  if (isset($result['__http'])) { $http = $result['__http']; unset($result['__http']); }
  $nameNote = isset($params['name']) && is_string($params['name']) ? ' name=' . $params['name'] : '';
  alog("action=$action ip=$ip$nameNote ok=" . (($result['ok'] ?? false) ? '1' : '0') . " http=$http ms=$ms");
  respond($conn, $http, $result);
  fclose($conn);
}

// ── main ──────────────────────────────────────────────────────────────────────

@mkdir($RUN_DIR, 0755, true);
@mkdir($LOG_DIR, 0755, true);

$bootCfg = load_cfg();
if (!is_file($PEM_FILE)) {
  fwrite(STDERR, "opus-connect: TLS certificate missing at $PEM_FILE — run ensure-secrets.sh\n");
  alog('FATAL: TLS certificate missing');
  exit(1);
}

$ctx = stream_context_create(['ssl' => [
  'local_cert'          => $PEM_FILE,
  'verify_peer'         => false,
  'verify_peer_name'    => false,
  'allow_self_signed'   => true,
  'disable_compression' => true,
  'honor_cipher_order'  => true,
]]);
$server = @stream_socket_server(
  'tcp://' . $bootCfg['BIND'] . ':' . $bootCfg['PORT'],
  $errno, $errstr, STREAM_SERVER_BIND | STREAM_SERVER_LISTEN, $ctx
);
if (!$server) {
  fwrite(STDERR, "opus-connect: listen failed: $errstr ($errno)\n");
  alog("FATAL: listen failed on {$bootCfg['BIND']}:{$bootCfg['PORT']}: $errstr");
  exit(1);
}

@file_put_contents($PID_FILE, (string)getmypid());
$canFork = function_exists('pcntl_fork');
$running = true;
if (function_exists('pcntl_async_signals')) {
  pcntl_async_signals(true);
  pcntl_signal(SIGTERM, function () use (&$running) { $running = false; });
  pcntl_signal(SIGINT,  function () use (&$running) { $running = false; });
}
alog('agent v' . AGENT_VERSION . ' listening on ' . $bootCfg['BIND'] . ':' . $bootCfg['PORT']
  . ($canFork ? ' (forking)' : ' (serial — pcntl unavailable)'));

while ($running) {
  $conn = @stream_socket_accept($server, 2, $peer);
  if ($canFork) {
    while (pcntl_waitpid(-1, $st, WNOHANG) > 0) { /* reap finished request children */ }
  }
  if (!$conn) continue;
  // Config (paths, allowlist) and the API key are re-read per request, so
  // settings changes apply without a restart; BIND/PORT changes still need one.
  if ($canFork) {
    $pid = pcntl_fork();
    if ($pid === 0) {
      fclose($server);
      handle_conn($conn, (string)$peer, load_cfg());
      exit(0);
    }
    fclose($conn);
  } else {
    handle_conn($conn, (string)$peer, load_cfg());
  }
}

@unlink($PID_FILE);
alog('agent stopped');
