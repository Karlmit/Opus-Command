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
