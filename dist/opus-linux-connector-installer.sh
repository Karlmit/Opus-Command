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
