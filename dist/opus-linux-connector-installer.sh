#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
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
  [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]]
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
  if [[ -n "${default_value}" ]]; then
    read -r -p "${prompt} [${default_value}]: " value
    echo "${value:-${default_value}}"
  else
    read -r -p "${prompt}: " value
    echo "${value}"
  fi
}

prompt_yes_no() {
  local prompt="$1"
  local default_value="$2"
  local value=""
  local hint="[y/N]"
  [[ "${default_value}" == "yes" ]] && hint="[Y/n]"
  while true; do
    read -r -p "${prompt} ${hint}: " value
    value="${value:-${default_value}}"
    case "${value}" in
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
    PROFILE="$(prompt_line "Dependency profile" "${PROFILE}")"
    case "${PROFILE}" in
      none|minimal|docker|browser|full) break ;;
      *) echo "Choose one of: none, minimal, docker, browser, full" >&2 ;;
    esac
  done

  SERVICE="$(prompt_yes_no "Install and start system service after boot?" "${SERVICE}")"
  AUTOSTART="$(prompt_yes_no "Also start after desktop login for this user?" "${AUTOSTART}")"
  SERVER="$(prompt_line "Opus Command URL, blank to pair later" "${SERVER}")"
  if [[ -n "${SERVER}" ]]; then
    PAIR="$(prompt_line "Pairing token" "${PAIR}")"
  fi
  NAME="$(prompt_line "Connector display name, optional" "${NAME}")"
  LABELS="$(prompt_line "Extra comma-separated labels, optional" "${LABELS}")"
  UI_PORT="$(prompt_line "Local status UI port" "${UI_PORT}")"

  cat <<SUMMARY

Ready to install:
  Prefix: ${PREFIX}
  Profile: ${PROFILE}
  System service: $(yn "${SERVICE}")
  Login autostart: $(yn "${AUTOSTART}")
  Opus URL: ${SERVER:-pair later}
  Connector name: ${NAME:-default}
  Extra labels: ${LABELS:-none}
  Status UI: http://127.0.0.1:${UI_PORT}

SUMMARY

  local confirm
  confirm="$(prompt_yes_no "Start installation now?" "no")"
  if [[ "${confirm}" != "yes" ]]; then
    echo "Installation canceled. No changes were made by this installer run."
    exit 0
  fi
}

run_gui_install() {
  local args=()
  args+=(--prefix "${PREFIX}")
  args+=(--profile "${PROFILE}")
  args+=(--service "${SERVICE}")
  args+=(--autostart "${AUTOSTART}")
  args+=(--ui-port "${UI_PORT}")
  [[ -n "${SERVER}" ]] && args+=(--server "${SERVER}")
  [[ -n "${PAIR}" ]] && args+=(--pair "${PAIR}")
  [[ -n "${NAME}" ]] && args+=(--name "${NAME}")
  [[ -n "${LABELS}" ]] && args+=(--labels "${LABELS}")

  if [[ "$(id -u)" -eq 0 ]]; then
    "$0" "${args[@]}"
  elif command -v pkexec >/dev/null 2>&1; then
    pkexec "$0" "${args[@]}"
  else
    zenity --error --title "Opus Connector Installer" --width 520 \
      --text "Administrator access is required. Install policykit or run this installer from a terminal with sudo." || true
    return 1
  fi
}

launch_gui() {
  if ! has_gui_toolkit; then
    echo "Graphical installer requires zenity. Run from terminal with sudo, or install zenity first." >&2
    exit 1
  fi

  zenity --question --title "Opus Connector Installer" --width 520 \
    --text "Install Opus Connector for Linux on this computer?" || exit 0

  local selected_profile
  selected_profile="$(zenity --list --radiolist --title "Opus Connector Installer" --width 620 --height 330 \
    --text "Choose what this installer should set up." \
    --column "" --column "Profile" --column "Installs" \
    TRUE full "Development tools, Docker, browser testing, and connector" \
    FALSE minimal "Core connector dependencies only" \
    FALSE docker "Docker and connector dependencies" \
    FALSE browser "Browser testing and connector dependencies" \
    FALSE none "Connector only; do not install system dependencies")" || exit 0
  PROFILE="${selected_profile:-full}"

  if zenity --question --title "Opus Connector Installer" --width 520 \
    --text "Start Opus Connector automatically as a system service after boot?"; then
    SERVICE="yes"
  else
    SERVICE="no"
  fi

  if zenity --question --title "Opus Connector Installer" --width 520 \
    --text "Also start Opus Connector after desktop login for this user?"; then
    AUTOSTART="yes"
  else
    AUTOSTART="no"
  fi

  SERVER="$(zenity --entry --title "Opus Connector Installer" --width 620 \
    --text "Opus Command URL. Leave blank to pair later in the local status UI." \
    --entry-text "${SERVER}")" || exit 0

  if [[ -n "${SERVER}" ]]; then
    PAIR="$(zenity --entry --title "Opus Connector Installer" --width 620 \
      --text "Pairing token from Opus Command." \
      --entry-text "${PAIR}")" || exit 0
  fi

  NAME="$(zenity --entry --title "Opus Connector Installer" --width 620 \
    --text "Connector display name. Optional." \
    --entry-text "${NAME}")" || exit 0

  LABELS="$(zenity --entry --title "Opus Connector Installer" --width 620 \
    --text "Extra comma-separated labels. Optional." \
    --entry-text "${LABELS}")" || exit 0

  UI_PORT="$(zenity --entry --title "Opus Connector Installer" --width 420 \
    --text "Local status UI port." \
    --entry-text "${UI_PORT}")" || exit 0

  zenity --question --title "Opus Connector Installer" --width 620 \
    --text "Ready to install.\n\nProfile: ${PROFILE}\nSystem service: $(yn "${SERVICE}")\nLogin autostart: $(yn "${AUTOSTART}")\nStatus UI: http://127.0.0.1:${UI_PORT}" || exit 0

  local log_file
  log_file="$(mktemp -t opus-connector-install.XXXXXX.log)"

  (
    if run_gui_install >"${log_file}" 2>&1; then
      echo "# Opus Connector installation complete"
      echo
      echo "Status UI: http://127.0.0.1:${UI_PORT}"
      echo
      cat "${log_file}"
    else
      echo "# Opus Connector installation failed"
      echo
      cat "${log_file}"
      exit 1
    fi
  ) | zenity --text-info --title "Opus Connector Installer" --width 900 --height 640 --auto-scroll --ok-label "Close"

  if [[ "${PIPESTATUS[0]}" -eq 0 ]]; then
    zenity --question --title "Opus Connector Installer" --width 520 \
      --text "Installation complete. Open the local status UI now?" && xdg-open "http://127.0.0.1:${UI_PORT}" >/dev/null 2>&1 || true
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

if [[ "${GUI_MODE}" == "yes" ]] || [[ "${GUI_MODE}" == "auto" && "${ORIGINAL_ARGC}" -eq 0 && "$(id -u)" -ne 0 ]] && has_graphical_session && has_gui_toolkit; then
  launch_gui
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run with sudo/root." >&2
  exit 1
fi

if [[ "${INTERACTIVE_MODE}" == "yes" || ( "${INTERACTIVE_MODE}" == "auto" && "${ORIGINAL_ARGC}" -eq 0 ) ]]; then
  launch_tui
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required." >&2
  exit 1
fi

if [[ "${PROFILE}" != "none" ]]; then
  if [[ -r /etc/os-release ]]; then
    . /etc/os-release
  else
    echo "Cannot detect Linux distribution." >&2
    exit 1
  fi
  case "${ID}" in
    ubuntu|debian|linuxmint)
      export DEBIAN_FRONTEND=noninteractive
      apt-get update
      apt-get install -y --no-install-recommends ca-certificates curl gnupg nodejs npm
      ;;
    *)
      echo "Unsupported distribution for automatic dependency install: ${ID}" >&2
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
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
PAYLOAD

mkdir -p "${PREFIX}"
tar -xzf "$tmp/payload.tar.gz" -C "$tmp"
rsync -a --delete "$tmp/opus-linux-connector/" "${PREFIX}/" 2>/dev/null || cp -a "$tmp/opus-linux-connector/." "${PREFIX}/"
mkdir -p "$(dirname "${PREFIX}")/shared"
rsync -a --delete "$tmp/shared/" "$(dirname "${PREFIX}")/shared/" 2>/dev/null || cp -a "$tmp/shared/." "$(dirname "${PREFIX}")/shared/"
chmod +x "${PREFIX}/install.sh"

if [[ "${PROFILE}" != "none" ]]; then
  bash "${PREFIX}/install.sh" "${PROFILE}"
fi

cd "${PREFIX}"
npm install --omit=dev

pair_args=()
if [[ -n "${SERVER}" && -n "${PAIR}" ]]; then
  pair_args+=(--server "${SERVER}" --pair "${PAIR}")
  [[ -n "${NAME}" ]] && pair_args+=(--name "${NAME}")
  [[ -n "${LABELS}" ]] && pair_args+=(--labels "${LABELS}")
  node src/index.js --home /var/lib/opus-connector "${pair_args[@]}" --no-ui
fi

if [[ "${SERVICE}" == "yes" ]]; then
  if [[ ! -d /run/systemd/system ]]; then
    echo "systemd was not detected; skipping service install."
    echo "Start manually with: cd ${PREFIX} && node src/index.js --home /var/lib/opus-connector"
  else
  node src/index.js --home /var/lib/opus-connector --ui-port "${UI_PORT}" --install-service
  fi
fi

if [[ "${AUTOSTART}" == "yes" ]]; then
  target_user="${SUDO_USER:-}"
  if [[ -n "${target_user}" && "${target_user}" != "root" ]]; then
    runuser -u "${target_user}" -- node "${PREFIX}/src/index.js" --home "/home/${target_user}/.opus-connector" --ui-port "${UI_PORT}" --install-autostart
  else
    node "${PREFIX}/src/index.js" --home /var/lib/opus-connector --ui-port "${UI_PORT}" --install-autostart
  fi
fi

echo
echo "Opus Connector installed at ${PREFIX}"
echo "Status UI: http://127.0.0.1:${UI_PORT}"
if [[ "${SERVICE}" == "yes" ]]; then
  echo "Service: systemctl status opus-connector"
fi
