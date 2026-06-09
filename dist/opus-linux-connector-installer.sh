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
