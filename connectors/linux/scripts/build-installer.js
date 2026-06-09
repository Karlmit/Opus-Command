#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..', '..');
const distDir = path.join(repoRoot, 'dist');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opus-linux-installer-'));
const payloadDir = path.join(workDir, 'opus-linux-connector');
const archivePath = path.join(workDir, 'payload.tar.gz');
const outputPath = path.join(distDir, 'opus-linux-connector-installer.sh');

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(source)) {
    const from = path.join(source, name);
    const to = path.join(target, name);
    const stat = fs.statSync(from);
    if (stat.isDirectory()) copyDir(from, to);
    else if (stat.isFile()) copyFile(from, to);
  }
}

fs.mkdirSync(payloadDir, { recursive: true });
copyFile(path.join(root, 'package.json'), path.join(payloadDir, 'package.json'));
copyFile(path.join(root, 'package-lock.json'), path.join(payloadDir, 'package-lock.json'));
copyFile(path.join(root, 'README.md'), path.join(payloadDir, 'README.md'));
copyFile(path.join(root, 'install.sh'), path.join(payloadDir, 'install.sh'));
copyDir(path.join(root, 'src'), path.join(payloadDir, 'src'));
copyDir(path.join(repoRoot, 'connectors', 'shared'), path.join(workDir, 'shared'));

execFileSync('tar', ['-czf', archivePath, '-C', workDir, 'opus-linux-connector', 'shared']);
const payload = fs.readFileSync(archivePath).toString('base64');

const installer = `#!/usr/bin/env bash
if [ -z "\${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

PREFIX="/opt/opus-connector"
PROFILE="full"
SERVICE="yes"
AUTOSTART="no"
SERVER=""
PAIR=""
NAME=""
LABELS=""
UI_PORT="3899"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prefix) PREFIX="$2"; shift 2 ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    --autostart) AUTOSTART="$2"; shift 2 ;;
    --server) SERVER="$2"; shift 2 ;;
    --pair) PAIR="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --labels) LABELS="$2"; shift 2 ;;
    --ui-port) UI_PORT="$2"; shift 2 ;;
    --help|-h)
      cat <<'HELP'
Opus Connector for Linux installer

Usage:
  sudo ./opus-linux-connector-installer.sh --server http://OPUS:3000 --pair TOKEN
  sudo ./opus-linux-connector-installer.sh --profile full --service yes

Options:
  --prefix PATH       Install path. Default: /opt/opus-connector
  --profile NAME      Dependency profile: none, minimal, docker, browser, full. Default: full
  --service yes|no    Install systemd boot service. Default: yes
  --autostart yes|no  Install desktop-login autostart for invoking user. Default: no
  --server URL        Opus Command URL for pairing
  --pair TOKEN        Pairing token
  --name NAME         Connector display name
  --labels LABELS     Extra comma-separated labels
  --ui-port PORT      Local status UI port. Default: 3899
HELP
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo/root." >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required." >&2
  exit 1
fi

if [[ "\${PROFILE}" != "none" ]]; then
  if [[ -r /etc/os-release ]]; then
    . /etc/os-release
  else
    echo "Cannot detect Linux distribution." >&2
    exit 1
  fi
  case "\${ID}" in
    ubuntu|debian|linuxmint)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update
      apt-get install -y --no-install-recommends ca-certificates curl gnupg nodejs npm
      ;;
    *)
      echo "Unsupported distribution for automatic dependency install: \${ID}" >&2
      if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
        echo "Node.js/npm are already available; continuing without dependency profile install."
        PROFILE="none"
      else
        echo "Install Node.js/npm manually, then rerun with --profile none." >&2
        exit 1
      fi
      ;;
  esac
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
base64 -d > "$tmp/payload.tar.gz" <<'PAYLOAD'
${payload}
PAYLOAD

mkdir -p "\${PREFIX}"
tar -xzf "$tmp/payload.tar.gz" -C "$tmp"
rsync -a --delete "$tmp/opus-linux-connector/" "\${PREFIX}/" 2>/dev/null || cp -a "$tmp/opus-linux-connector/." "\${PREFIX}/"
mkdir -p "$(dirname "\${PREFIX}")/shared"
rsync -a --delete "$tmp/shared/" "$(dirname "\${PREFIX}")/shared/" 2>/dev/null || cp -a "$tmp/shared/." "$(dirname "\${PREFIX}")/shared/"
chmod +x "\${PREFIX}/install.sh"

if [[ "\${PROFILE}" != "none" ]]; then
  bash "\${PREFIX}/install.sh" "\${PROFILE}"
fi

cd "\${PREFIX}"
npm install --omit=dev

pair_args=()
if [[ -n "\${SERVER}" && -n "\${PAIR}" ]]; then
  pair_args+=(--server "\${SERVER}" --pair "\${PAIR}")
  [[ -n "\${NAME}" ]] && pair_args+=(--name "\${NAME}")
  [[ -n "\${LABELS}" ]] && pair_args+=(--labels "\${LABELS}")
  node src/index.js --home /var/lib/opus-connector "\${pair_args[@]}" --no-ui
fi

if [[ "\${SERVICE}" == "yes" ]]; then
  if [[ ! -d /run/systemd/system ]]; then
    echo "systemd was not detected; skipping service install."
    echo "Start manually with: cd \${PREFIX} && node src/index.js --home /var/lib/opus-connector"
  else
  node src/index.js --home /var/lib/opus-connector --ui-port "\${UI_PORT}" --install-service
  fi
fi

if [[ "\${AUTOSTART}" == "yes" ]]; then
  target_user="\${SUDO_USER:-}"
  if [[ -n "\${target_user}" && "\${target_user}" != "root" ]]; then
    runuser -u "\${target_user}" -- node "\${PREFIX}/src/index.js" --home "/home/\${target_user}/.opus-connector" --ui-port "\${UI_PORT}" --install-autostart
  else
    node "\${PREFIX}/src/index.js" --home /var/lib/opus-connector --ui-port "\${UI_PORT}" --install-autostart
  fi
fi

echo
echo "Opus Connector installed at \${PREFIX}"
echo "Status UI: http://127.0.0.1:\${UI_PORT}"
if [[ "\${SERVICE}" == "yes" ]]; then
  echo "Service: systemctl status opus-connector"
fi
`;

fs.mkdirSync(distDir, { recursive: true });
fs.writeFileSync(outputPath, installer, { mode: 0o755 });
console.log(outputPath);
