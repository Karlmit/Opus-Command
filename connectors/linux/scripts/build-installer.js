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
GUI_MODE="auto"
ORIGINAL_ARGC=$#
INTERACTIVE_MODE="auto"

has_graphical_session() {
  [[ -n "\${DISPLAY:-}" || -n "\${WAYLAND_DISPLAY:-}" ]]
}

has_gui_toolkit() {
  command -v zenity >/dev/null 2>&1
}

yn() {
  case "$1" in
    yes|true|1) echo "yes" ;;
    *) echo "no" ;;
  esac
}

prompt_line() {
  local prompt="$1"
  local default_value="$2"
  local value=""
  if [[ -n "\${default_value}" ]]; then
    read -r -p "\${prompt} [\${default_value}]: " value
    echo "\${value:-\${default_value}}"
  else
    read -r -p "\${prompt}: " value
    echo "\${value}"
  fi
}

prompt_yes_no() {
  local prompt="$1"
  local default_value="$2"
  local value=""
  local hint="[y/N]"
  [[ "\${default_value}" == "yes" ]] && hint="[Y/n]"
  while true; do
    read -r -p "\${prompt} \${hint}: " value
    value="\${value:-\${default_value}}"
    case "\${value}" in
      y|Y|yes|YES|Yes) echo "yes"; return 0 ;;
      n|N|no|NO|No) echo "no"; return 0 ;;
      *) echo "Please answer yes or no." >&2 ;;
    esac
  done
}

launch_tui() {
  if [[ ! -t 0 ]]; then
    echo "No installer options were provided and stdin is not interactive." >&2
    echo "Use explicit flags for silent install, for example:" >&2
    echo "  sudo $0 --profile full --service yes" >&2
    exit 1
  fi

  cat <<'INTRO'
Opus Connector for Linux installer

This interactive setup has not changed your system yet. Review the choices
below, then confirm before installation starts.

Dependency profiles:
  full     Development tools, Docker, browser testing, and connector
  minimal  Core connector dependencies only
  docker   Docker and connector dependencies
  browser  Browser testing and connector dependencies
  none     Connector only; do not install system dependencies

For unattended/silent installs, pass explicit flags such as:
  sudo ./opus-linux-connector-installer.sh --profile full --service yes

INTRO

  while true; do
    PROFILE="$(prompt_line "Dependency profile" "\${PROFILE}")"
    case "\${PROFILE}" in
      none|minimal|docker|browser|full) break ;;
      *) echo "Choose one of: none, minimal, docker, browser, full" >&2 ;;
    esac
  done

  SERVICE="$(prompt_yes_no "Install and start system service after boot?" "\${SERVICE}")"
  AUTOSTART="$(prompt_yes_no "Also start after desktop login for this user?" "\${AUTOSTART}")"
  SERVER="$(prompt_line "Opus Command URL, blank to pair later" "\${SERVER}")"
  if [[ -n "\${SERVER}" ]]; then
    PAIR="$(prompt_line "Pairing token" "\${PAIR}")"
  fi
  NAME="$(prompt_line "Connector display name, optional" "\${NAME}")"
  LABELS="$(prompt_line "Extra comma-separated labels, optional" "\${LABELS}")"
  UI_PORT="$(prompt_line "Local status UI port" "\${UI_PORT}")"

  cat <<SUMMARY

Ready to install:
  Prefix: \${PREFIX}
  Profile: \${PROFILE}
  System service: $(yn "\${SERVICE}")
  Login autostart: $(yn "\${AUTOSTART}")
  Opus URL: \${SERVER:-pair later}
  Connector name: \${NAME:-default}
  Extra labels: \${LABELS:-none}
  Status UI: http://127.0.0.1:\${UI_PORT}

SUMMARY

  local confirm
  confirm="$(prompt_yes_no "Start installation now?" "no")"
  if [[ "\${confirm}" != "yes" ]]; then
    echo "Installation canceled. No changes were made by this installer run."
    exit 0
  fi
}

run_gui_install() {
  local args=()
  args+=(--prefix "\${PREFIX}")
  args+=(--profile "\${PROFILE}")
  args+=(--service "\${SERVICE}")
  args+=(--autostart "\${AUTOSTART}")
  args+=(--ui-port "\${UI_PORT}")
  [[ -n "\${SERVER}" ]] && args+=(--server "\${SERVER}")
  [[ -n "\${PAIR}" ]] && args+=(--pair "\${PAIR}")
  [[ -n "\${NAME}" ]] && args+=(--name "\${NAME}")
  [[ -n "\${LABELS}" ]] && args+=(--labels "\${LABELS}")

  if [[ "$(id -u)" -eq 0 ]]; then
    "$0" "\${args[@]}"
  elif command -v pkexec >/dev/null 2>&1; then
    pkexec "$0" "\${args[@]}"
  else
    zenity --error --title "Opus Connector Installer" --width 520 \\
      --text "Administrator access is required. Install policykit or run this installer from a terminal with sudo." || true
    return 1
  fi
}

launch_gui() {
  if ! has_gui_toolkit; then
    echo "Graphical installer requires zenity. Run from terminal with sudo, or install zenity first." >&2
    exit 1
  fi

  zenity --question --title "Opus Connector Installer" --width 520 \\
    --text "Install Opus Connector for Linux on this computer?" || exit 0

  local selected_profile
  selected_profile="$(zenity --list --radiolist --title "Opus Connector Installer" --width 620 --height 330 \\
    --text "Choose what this installer should set up." \\
    --column "" --column "Profile" --column "Installs" \\
    TRUE full "Development tools, Docker, browser testing, and connector" \\
    FALSE minimal "Core connector dependencies only" \\
    FALSE docker "Docker and connector dependencies" \\
    FALSE browser "Browser testing and connector dependencies" \\
    FALSE none "Connector only; do not install system dependencies")" || exit 0
  PROFILE="\${selected_profile:-full}"

  if zenity --question --title "Opus Connector Installer" --width 520 \\
    --text "Start Opus Connector automatically as a system service after boot?"; then
    SERVICE="yes"
  else
    SERVICE="no"
  fi

  if zenity --question --title "Opus Connector Installer" --width 520 \\
    --text "Also start Opus Connector after desktop login for this user?"; then
    AUTOSTART="yes"
  else
    AUTOSTART="no"
  fi

  SERVER="$(zenity --entry --title "Opus Connector Installer" --width 620 \\
    --text "Opus Command URL. Leave blank to pair later in the local status UI." \\
    --entry-text "\${SERVER}")" || exit 0

  if [[ -n "\${SERVER}" ]]; then
    PAIR="$(zenity --entry --title "Opus Connector Installer" --width 620 \\
      --text "Pairing token from Opus Command." \\
      --entry-text "\${PAIR}")" || exit 0
  fi

  NAME="$(zenity --entry --title "Opus Connector Installer" --width 620 \\
    --text "Connector display name. Optional." \\
    --entry-text "\${NAME}")" || exit 0

  LABELS="$(zenity --entry --title "Opus Connector Installer" --width 620 \\
    --text "Extra comma-separated labels. Optional." \\
    --entry-text "\${LABELS}")" || exit 0

  UI_PORT="$(zenity --entry --title "Opus Connector Installer" --width 420 \\
    --text "Local status UI port." \\
    --entry-text "\${UI_PORT}")" || exit 0

  zenity --question --title "Opus Connector Installer" --width 620 \\
    --text "Ready to install.\\n\\nProfile: \${PROFILE}\\nSystem service: $(yn "\${SERVICE}")\\nLogin autostart: $(yn "\${AUTOSTART}")\\nStatus UI: http://127.0.0.1:\${UI_PORT}" || exit 0

  local log_file
  log_file="$(mktemp -t opus-connector-install.XXXXXX.log)"

  (
    if run_gui_install >"\${log_file}" 2>&1; then
      echo "# Opus Connector installation complete"
      echo
      echo "Status UI: http://127.0.0.1:\${UI_PORT}"
      echo
      cat "\${log_file}"
    else
      echo "# Opus Connector installation failed"
      echo
      cat "\${log_file}"
      exit 1
    fi
  ) | zenity --text-info --title "Opus Connector Installer" --width 900 --height 640 --auto-scroll --ok-label "Close"

  if [[ "\${PIPESTATUS[0]}" -eq 0 ]]; then
    zenity --question --title "Opus Connector Installer" --width 520 \\
      --text "Installation complete. Open the local status UI now?" && xdg-open "http://127.0.0.1:\${UI_PORT}" >/dev/null 2>&1 || true
  fi
  exit 0
}

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
    --gui) GUI_MODE="yes"; shift ;;
    --no-gui) GUI_MODE="no"; shift ;;
    --tui) INTERACTIVE_MODE="yes"; GUI_MODE="no"; shift ;;
    --no-tui) INTERACTIVE_MODE="no"; shift ;;
    --help|-h)
      cat <<'HELP'
Opus Connector for Linux installer

Usage:
  sudo ./opus-linux-connector-installer.sh --server http://OPUS:3000 --pair TOKEN
  sudo ./opus-linux-connector-installer.sh --profile full --service yes
  ./opus-linux-connector-installer.sh --gui

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
  --gui               Open the graphical installer.
  --no-gui            Force terminal mode.
  --tui               Open the terminal installer wizard.
  --no-tui            Disable the terminal wizard for explicit terminal installs.
HELP
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ "\${GUI_MODE}" == "yes" ]] || [[ "\${GUI_MODE}" == "auto" && "\${ORIGINAL_ARGC}" -eq 0 && "$(id -u)" -ne 0 ]] && has_graphical_session && has_gui_toolkit; then
  launch_gui
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo/root." >&2
  exit 1
fi

if [[ "\${INTERACTIVE_MODE}" == "yes" || ( "\${INTERACTIVE_MODE}" == "auto" && "\${ORIGINAL_ARGC}" -eq 0 ) ]]; then
  launch_tui
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
