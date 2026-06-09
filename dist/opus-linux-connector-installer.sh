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
