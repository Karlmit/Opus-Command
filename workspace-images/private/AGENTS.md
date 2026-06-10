# Opus Command — Codex Workspace Instructions

This workspace runs inside a Linux Docker container. Your home directory (`~`)
is stored in a persistent Docker volume and survives container restarts and
recreates. Install tools into `~`, not system directories.

## Persistent Tool Installs

- npm global packages: use `npm install -g <package>`; the prefix is already
  configured to `~/.npm-global`.
- Python packages: use `pip install --user <package>`.
- Standalone binaries: place them in `~/bin`.
- Azure CLI: install with
  `curl -L https://aka.ms/InstallAzureCli | bash -s -- -i ~/.azure-cli -b ~/bin`.
- Avoid `apt install` for task tooling when possible because system packages are
  lost when the workspace container is recreated.

## Opus Managed Skills

Also read the managed Opus skill files in this project:

- `.opus/skills/connectors.md`
