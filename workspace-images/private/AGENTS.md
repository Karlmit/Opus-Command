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

## Git and Opus Command

Opus Command's Git menu works best when the repo is rooted at `/workspace`.
It can also detect one repo directly below `/workspace`, but deeper nesting is
unreliable. Keep `.git` under `/workspace`, never under `/root`.

- If Git is not initialized and the user expects the Git menu to work, run
  `git init` in `/workspace`.
- Run Git commands from the repo root, or use `git -C /workspace ...`.
- Check `git status --porcelain` before and after edits.
- Do not run destructive commands like `git reset --hard`, `git clean -fd`,
  rebases, or history rewrites unless explicitly requested.
- Do not delete or rewrite Opus snapshot tags named
  `snapshot/YYYY-MM-DD-HH-MM-SS`.
- Stage or commit only when asked; otherwise leave changes visible in the Git
  menu for review.

## Opus Managed Skills

Also read the managed Opus skill files in this project:

- `.opus/skills/connectors.md`
