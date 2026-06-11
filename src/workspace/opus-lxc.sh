#!/usr/bin/env bash
#
# opus-lxc — Opus Command helper for managing Unraid LXC workspaces.
#
# Installed to /usr/local/bin/opus-lxc on the Unraid host and invoked over SSH
# by Opus Command's UnraidLxcService. Keeping all host-side logic here means a
# future V2 can replace SSH/root access with a local host agent that calls the
# same script, unchanged.
#
# Safety rules (V1):
#   - Only manages containers whose name starts with "opus-workspace-".
#   - Only binds project paths under the configured workspace share root.
#   - Never deletes project files; destroy removes the container only.
#
# Configuration via environment (set by the caller; sane defaults below):
#   OPUS_LXC_BASE     LXC rootfs/runtime path (default /mnt/system_nvme/linux)
#   OPUS_SHARE_ROOT   project files share root (default /mnt/user/opus-projects)
#   OPUS_LXC_DIST     download dist        (default ubuntu)
#   OPUS_LXC_RELEASE  download release     (default noble)
#   OPUS_LXC_ARCH     download arch        (default amd64)
#
# Exit codes: 0 success, non-zero on failure. Diagnostic text goes to stderr,
# machine-readable results to stdout.

set -u

OPUS_LXC_BASE="${OPUS_LXC_BASE:-/mnt/system_nvme/linux}"
OPUS_SHARE_ROOT="${OPUS_SHARE_ROOT:-/mnt/user/opus-projects}"
OPUS_LXC_DIST="${OPUS_LXC_DIST:-ubuntu}"
OPUS_LXC_RELEASE="${OPUS_LXC_RELEASE:-noble}"
OPUS_LXC_ARCH="${OPUS_LXC_ARCH:-amd64}"

NAME_PREFIX="opus-workspace-"

err()  { echo "opus-lxc: $*" >&2; }
die()  { err "$*"; exit 1; }

# ── argument parsing ──────────────────────────────────────────────────────────
# Parses --key value flags up to a literal "--", after which the rest is CMD.
ARG_NAME=""
ARG_PROJECT_PATH=""
ARG_TEMPLATE=""
ARG_CWD="/workspace"
REST=()

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --name)         ARG_NAME="${2:-}"; shift 2 ;;
      --project-path) ARG_PROJECT_PATH="${2:-}"; shift 2 ;;
      --template)     ARG_TEMPLATE="${2:-}"; shift 2 ;;
      --cwd)          ARG_CWD="${2:-/workspace}"; shift 2 ;;
      --)             shift; REST=("$@"); break ;;
      *)              err "unknown argument: $1"; shift ;;
    esac
  done
}

require_name() {
  [ -n "$ARG_NAME" ] || die "--name is required"
  case "$ARG_NAME" in
    "$NAME_PREFIX"*) : ;;
    *) die "refusing to manage container '$ARG_NAME' — name must start with '$NAME_PREFIX'" ;;
  esac
}

container_exists() {
  lxc-ls -1 2>/dev/null | grep -qx "$ARG_NAME"
}

container_state() {
  # Prints RUNNING / STOPPED / FROZEN, or NOTFOUND if it does not exist.
  if ! container_exists; then echo "NOTFOUND"; return; fi
  lxc-info -n "$ARG_NAME" -s 2>/dev/null | awk '{print $2}' | head -1
}

config_path() { echo "$OPUS_LXC_BASE/$ARG_NAME/config"; }

# ── subcommands ───────────────────────────────────────────────────────────────

cmd_preflight() {
  local rc=0
  check() { # label  test-expr
    if eval "$2" >/dev/null 2>&1; then echo "$1=OK"; else echo "$1=FAIL"; rc=1; fi
  }
  check lxc_create   "command -v lxc-create"
  check lxc_start    "command -v lxc-start"
  check lxc_attach   "command -v lxc-attach"
  check lxc_stop     "command -v lxc-stop"
  check lxc_ls       "command -v lxc-ls"
  check lxc_destroy  "command -v lxc-destroy"
  check base_path    "test -d '$OPUS_LXC_BASE'"
  check share_path   "test -d '$OPUS_SHARE_ROOT'"
  check helper       "test -x '$0'"
  check list         "lxc-ls -1"
  echo "container_count=$(lxc-ls -1 2>/dev/null | grep -c "^$NAME_PREFIX" || echo 0)"
  return $rc
}

ensure_mount_entry() {
  # Idempotently add the /workspace bind mount to the container config.
  local cfg; cfg="$(config_path)"
  [ -f "$cfg" ] || die "container config not found at $cfg"
  local entry="lxc.mount.entry = $ARG_PROJECT_PATH workspace none bind,create=dir 0 0"
  if ! grep -qF "$ARG_PROJECT_PATH workspace none bind" "$cfg"; then
    printf '\n# Opus Command workspace bind mount\n%s\n' "$entry" >> "$cfg"
  fi
}

cmd_create() {
  require_name
  [ -n "$ARG_PROJECT_PATH" ] || die "--project-path is required"
  case "$ARG_PROJECT_PATH" in
    "$OPUS_SHARE_ROOT"/*) : ;;
    *) die "project path must be under $OPUS_SHARE_ROOT (got '$ARG_PROJECT_PATH')" ;;
  esac

  mkdir -p "$ARG_PROJECT_PATH/.planning" || die "could not create project path $ARG_PROJECT_PATH"
  touch "$ARG_PROJECT_PATH/.gitignore" || die "could not create .gitignore in $ARG_PROJECT_PATH"
  if ! grep -qxF ".planning/" "$ARG_PROJECT_PATH/.gitignore" 2>/dev/null; then
    printf ".planning/\n" >> "$ARG_PROJECT_PATH/.gitignore"
  fi

  if container_exists; then
    ensure_mount_entry
    echo "RESULT=exists"
    echo "NAME=$ARG_NAME"
    return 0
  fi

  err "creating container $ARG_NAME ($OPUS_LXC_DIST $OPUS_LXC_RELEASE $OPUS_LXC_ARCH)…"
  if ! lxc-create -n "$ARG_NAME" -t download -- \
        --dist "$OPUS_LXC_DIST" --release "$OPUS_LXC_RELEASE" --arch "$OPUS_LXC_ARCH" >&2; then
    die "lxc-create failed"
  fi

  ensure_mount_entry
  echo "RESULT=created"
  echo "NAME=$ARG_NAME"
}

cmd_start() {
  require_name
  container_exists || die "container $ARG_NAME does not exist"
  local state; state="$(container_state)"
  if [ "$state" = "RUNNING" ]; then echo "STATE=RUNNING"; return 0; fi
  lxc-start -n "$ARG_NAME" >&2 || die "lxc-start failed"
  # Wait briefly for the container to report RUNNING.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(container_state)" = "RUNNING" ] && break
    sleep 0.5
  done
  # RUNNING is reported before init is fully up, so lxc-attach can fail with
  # "Failed to get init pid". Wait until the container is actually attachable
  # so the first terminal/update after a start doesn't hit that race.
  for _ in $(seq 1 30); do
    lxc-attach -n "$ARG_NAME" -- true >/dev/null 2>&1 && break
    sleep 0.5
  done
  echo "STATE=$(container_state)"
}

cmd_stop() {
  require_name
  container_exists || die "container $ARG_NAME does not exist"
  local state; state="$(container_state)"
  if [ "$state" = "STOPPED" ]; then echo "STATE=STOPPED"; return 0; fi
  lxc-stop -n "$ARG_NAME" -t 15 >&2 || lxc-stop -n "$ARG_NAME" -k >&2 || die "lxc-stop failed"
  echo "STATE=$(container_state)"
}

cmd_restart() {
  cmd_stop >/dev/null
  cmd_start
}

cmd_status() {
  require_name
  echo "STATE=$(container_state)"
}

cmd_destroy() {
  require_name
  if ! container_exists; then echo "RESULT=absent"; return 0; fi
  lxc-stop -n "$ARG_NAME" -k >/dev/null 2>&1 || true
  lxc-destroy -n "$ARG_NAME" >&2 || die "lxc-destroy failed"
  echo "RESULT=destroyed"
}

cmd_exec() {
  require_name
  container_exists || die "container $ARG_NAME does not exist"
  [ "$(container_state)" = "RUNNING" ] || die "container $ARG_NAME is not running"
  local cmd="bash"
  if [ "${#REST[@]}" -gt 0 ]; then cmd="${REST[*]}"; fi
  exec lxc-attach -n "$ARG_NAME" -- bash -lc "cd '$ARG_CWD' 2>/dev/null; exec $cmd"
}

# Build the in-container provisioning script for a template.
provision_script() {
  local template="$1"
  case "$template" in
    work|claude-code) template="claude-code" ;;
    private)          template="private" ;;
    *)                template="claude-code" ;;
  esac

  cat <<PROVISION
set -e
export DEBIAN_FRONTEND=noninteractive
mkdir -p /workspace/.planning
touch /workspace/.gitignore
grep -qxF ".planning/" /workspace/.gitignore 2>/dev/null || printf ".planning/\n" >> /workspace/.gitignore
echo "[opus-lxc] apt update…"
apt-get update -y || true
echo "[opus-lxc] ensuring base packages…"
apt-get install -y --no-install-recommends git curl wget ca-certificates gnupg gh python3-pip python3-venv pipx xvfb ffmpeg >/dev/null 2>&1 || true

if ! command -v node >/dev/null 2>&1; then
  echo "[opus-lxc] installing Node.js 20…"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
  apt-get install -y nodejs >/dev/null 2>&1 || true
fi
echo "[opus-lxc] node: \$(node -v 2>/dev/null || echo missing), npm: \$(npm -v 2>/dev/null || echo missing)"

if command -v npm >/dev/null 2>&1; then
  command -v claude >/dev/null 2>&1 || { echo "[opus-lxc] installing Claude Code…"; npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 || true; }
  command -v codex >/dev/null 2>&1 || { echo "[opus-lxc] installing Codex CLI…"; npm install -g @openai/codex >/dev/null 2>&1 || true; }
  { command -v playwright >/dev/null 2>&1 && command -v playwright-mcp >/dev/null 2>&1; } || { echo "[opus-lxc] installing Playwright + MCP…"; npm install -g playwright @playwright/mcp >/dev/null 2>&1 || true; }
  command -v playwright >/dev/null 2>&1 && playwright install --with-deps chromium >/dev/null 2>&1 || true
fi

if command -v pipx >/dev/null 2>&1; then
  export PIPX_HOME=/opt/pipx
  export PIPX_BIN_DIR=/usr/local/bin
  command -v markitdown >/dev/null 2>&1 || { echo "[opus-lxc] installing MarkItDown…"; pipx install 'markitdown[all]' >/dev/null 2>&1 || true; }
  command -v markitdown-mcp >/dev/null 2>&1 || { echo "[opus-lxc] installing MarkItDown MCP…"; pipx install markitdown-mcp >/dev/null 2>&1 || true; }
fi

command -v claude >/dev/null 2>&1 && command -v playwright-mcp >/dev/null 2>&1 && { claude mcp get playwright >/dev/null 2>&1 || claude mcp add -s user playwright -- playwright-mcp >/dev/null 2>&1; } || true
command -v claude >/dev/null 2>&1 && command -v markitdown-mcp >/dev/null 2>&1 && { claude mcp get markitdown >/dev/null 2>&1 || claude mcp add -s user markitdown -- markitdown-mcp >/dev/null 2>&1; } || true
command -v codex >/dev/null 2>&1 && command -v playwright-mcp >/dev/null 2>&1 && { codex mcp get playwright >/dev/null 2>&1 || codex mcp add playwright -- playwright-mcp >/dev/null 2>&1; } || true
command -v codex >/dev/null 2>&1 && command -v markitdown-mcp >/dev/null 2>&1 && { codex mcp get markitdown >/dev/null 2>&1 || codex mcp add markitdown -- markitdown-mcp >/dev/null 2>&1; } || true

# Write Opus workspace instructions if missing.
if [ ! -f /workspace/CLAUDE.md ]; then
  cat > /workspace/CLAUDE.md <<'EOFCLAUDE'
# Opus Command — Unraid LXC Workspace

This workspace runs inside an Unraid LXC container managed by Opus Command.

- Your project files live in /workspace (bind-mounted from the Unraid share).
- Files written here are visible on the Unraid share and persist across restarts.
- Install tools normally (apt, npm -g, pip). The container is persistent — it is
  not recreated on stop/start, so changes you make here stick around.
EOFCLAUDE
fi

echo "[opus-lxc] update complete."
PROVISION
}

cmd_update() {
  require_name
  container_exists || die "container $ARG_NAME does not exist"
  [ "$(container_state)" = "RUNNING" ] || die "container $ARG_NAME is not running (start it first)"
  local template="${ARG_TEMPLATE:-claude-code}"
  err "running update (template: $template) inside $ARG_NAME…"
  provision_script "$template" | lxc-attach -n "$ARG_NAME" -- bash -s
  local rc=$?
  [ $rc -eq 0 ] && echo "RESULT=updated" || die "update failed (exit $rc)"
}

# ── dispatch ──────────────────────────────────────────────────────────────────

SUBCMD="${1:-}"
[ -n "$SUBCMD" ] || die "usage: opus-lxc <preflight|create|start|stop|restart|status|destroy|exec|update> [flags]"
shift || true
parse_args "$@"

case "$SUBCMD" in
  preflight) cmd_preflight ;;
  create)    cmd_create ;;
  start)     cmd_start ;;
  stop)      cmd_stop ;;
  restart)   cmd_restart ;;
  status)    cmd_status ;;
  destroy)   cmd_destroy ;;
  exec)      cmd_exec ;;
  update)    cmd_update ;;
  *)         die "unknown subcommand: $SUBCMD" ;;
esac
