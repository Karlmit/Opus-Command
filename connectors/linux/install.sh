#!/usr/bin/env bash
if [ -z "${BASH_VERSION:-}" ]; then
  exec bash "$0" "$@"
fi
set -euo pipefail

PROFILE="${1:-full}"

if [[ "${PROFILE}" == "--help" || "${PROFILE}" == "-h" ]]; then
  cat <<'HELP'
Opus Connector Linux dependency profiles

Usage:
  sudo ./install.sh minimal
  sudo ./install.sh docker
  sudo ./install.sh browser
  sudo ./install.sh full

Profiles:
  minimal   Core OS packages only.
  docker    Docker and Docker Compose.
  browser   Chromium and Playwright browser support.
  full      Development tools, Docker, and browser testing.
HELP
  exit 0
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo $0 ${PROFILE}" >&2
  exit 1
fi

if [[ ! -r /etc/os-release ]]; then
  echo "Cannot detect Linux distribution." >&2
  exit 1
fi

. /etc/os-release

install_apt_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends "$@"
}

install_base() {
  install_apt_packages ca-certificates curl gnupg
}

install_dev() {
  install_apt_packages git jq rsync openssh-client python3 python3-pip nodejs npm build-essential
}

install_docker() {
  install_apt_packages docker.io docker-compose-plugin
  systemctl enable --now docker || true
}

install_browser() {
  install_apt_packages nodejs npm chromium
  npm install -g playwright || true
  npx playwright install --with-deps chromium || playwright install chromium || true
}

case "${ID}" in
  ubuntu|debian|linuxmint)
    install_base
    case "${PROFILE}" in
      minimal)
        ;;
      docker)
        install_docker
        ;;
      browser)
        install_browser
        ;;
      full)
        install_dev
        install_docker
        install_browser
        ;;
      *)
        echo "Unknown profile: ${PROFILE}" >&2
        echo "Profiles: minimal, docker, browser, full" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported distribution for automatic dependency install: ${ID}" >&2
    echo "Supported today: ubuntu, debian, linuxmint" >&2
    exit 1
    ;;
esac

echo "Dependency profile '${PROFILE}' complete."
