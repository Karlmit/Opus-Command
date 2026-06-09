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
