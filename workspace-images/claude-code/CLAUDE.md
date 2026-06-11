# Opus Command — Workspace Instructions

This terminal runs inside a Docker container. Your **home directory (`~`)
is stored in a persistent Docker volume** and survives container restarts
and recreations. The container's system directories (`/usr/local`, `/usr`,
etc.) are wiped when the container is recreated.

**Always install to `~` so your tools survive.**

---

## npm — global packages

Default `npm install -g` installs to `/usr/local` which is wiped on Recreate.
Use the persistent prefix instead:

```bash
npm install -g <package>
```

This works automatically — the npm prefix is already configured to
`~/.npm-global` in this workspace, so all global installs go to the
home volume.

---

## pip — Python packages

Always use `--user`:

```bash
pip install --user <package>
```

Installs to `~/.local/lib/...` which persists.

---

## apt — system packages

`apt install` writes to the container filesystem and is lost on Recreate.
Prefer alternatives:

- Download a pre-built binary to `~/bin/`
- Use `pip install --user` or `npm install -g` where possible
- For the Azure CLI specifically, see below

---

## Azure CLI

```bash
curl -L https://aka.ms/InstallAzureCli | bash -s -- -i ~/.azure-cli -b ~/bin
```

Installs entirely to `~/.azure-cli` and `~/bin/az` — fully persistent.

---

## PATH

The following are already in `PATH` in this workspace:

- `~/.npm-global/bin` — npm global packages
- `~/.local/bin` — pip --user packages, pipx
- `~/bin` — manually placed binaries

---

## Git and the Opus Command Git Menu

Opus Command's Git menu looks for a repository at `/workspace/.git` first, then
for one repository one or two levels under `/workspace`. To keep the Git menu
working correctly:

- Keep the project repository rooted at `/workspace` whenever possible.
- If cloning into a subdirectory, clone directly under `/workspace`, not deeper.
- Do not move `.git` outside `/workspace` or work from a repo under `/root`.
- If the project is not initialized and the user expects the Git menu to work,
  run `git init` in `/workspace` before making changes.
- Run Git commands from the repo root, or use `git -C /workspace ...`.
- Check `git status --porcelain` before and after edits so the Git menu and your
  summary agree about changed files.
- Do not run destructive commands such as `git reset --hard`, `git clean -fd`,
  rebases, or history rewrites unless the user explicitly asks.
- Opus snapshots are annotated tags named `snapshot/YYYY-MM-DD-HH-MM-SS`; do not
  delete, move, or overwrite them unless the user explicitly asks.

Stage or commit only when the user asks. Otherwise leave changed files visible
for review in the Opus Command Git menu.

---

## Opus Managed Skills

Also read the managed Opus skill files in this project:

- `.opus/skills/connectors.md`

---

## Summary

| Tool | Persistent command |
|------|--------------------|
| npm global | `npm install -g <pkg>` (prefix pre-set to `~/.npm-global`) |
| pip | `pip install --user <pkg>` |
| binary | copy to `~/bin/` |
| Azure CLI | install script with `-i ~/.azure-cli -b ~/bin` |
| apt | avoid — use one of the above instead |
