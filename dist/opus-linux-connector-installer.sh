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
