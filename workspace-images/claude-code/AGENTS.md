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

Opus Command's Git menu auto-discovers Git repositories under `/workspace`: it
checks `/workspace/.git` and one level down (e.g. `/workspace/<project>/.git`),
recognising `.git` as a directory *or* a `gitdir:` pointer file (worktrees and
submodules). A repo nested in a subfolder such as `/workspace/my-project` is
fully supported — no need to move it to `/workspace`. Never put `.git` under
`/root`.

- If more than one repo is found, the Git menu shows a picker and remembers the
  active repo per project; all actions operate on the active repo.
- If Git is not initialized and the user expects the Git menu to work, run
  `git init` in the repository folder.
- Run Git commands from the repo root, or use `git -C <repo-root> ...`.
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
