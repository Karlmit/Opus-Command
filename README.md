<div align="center">

<img src="Logos/mark-dark.svg" alt="Opus Command" width="100" height="100" />

<img src="Logos/wordmark-dark.svg" alt="Opus Command" width="325" height="98" />

*An opus is a work. A magnum opus is **the** work. Opus Command helps you build both.*

**An AI Development Control Plane.**  
Give every project its own isolated, reproducible workspace — files, terminals, tools, connectors, and AI agents — managed from a single interface, on any device.

[![Build](https://github.com/Karlmit/Opus-Command/actions/workflows/docker.yml/badge.svg)](https://github.com/Karlmit/Opus-Command/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![ghcr.io](https://img.shields.io/badge/ghcr.io-karlmit%2Fopus--command-blue?logo=github)](https://github.com/Karlmit/Opus-Command/pkgs/container/opus-command)
[![Roadmap](https://img.shields.io/badge/Roadmap-view-green)](ROADMAP.md)

</div>

---

## What is Opus Command?

Opus Command is an **AI Development Control Plane**.

Instead of running Claude Code, Codex, and your development tools directly on your local machine, Opus Command gives every project its own isolated workspace that can be accessed from anywhere.

Each workspace acts like a dedicated development environment with its own files, terminal sessions, tools, configuration, and AI agents. Projects stay isolated from one another while still being managed from a single interface.

Opus Command is designed for developers who primarily **direct AI agents** rather than manually write every line of code. It provides a central place to manage projects, workspaces, terminals, connectors, files, and future AI tooling — without requiring a traditional IDE.

### Core Principles

- **One project = one isolated workspace**
- Claude Code and Codex run **where the project lives**, not on your laptop
- Access projects from **desktop, tablet, or mobile**
- **Terminal-first** experience with AI-friendly workflows
- **Connectors** extend workspaces to Windows, Linux, Android, and other environments
- Workspaces are **disposable, reproducible, and portable**
- Opus Command is the **control plane**, not the development machine

Opus Command is not trying to replace Claude Code or Codex. It provides the **infrastructure around them**.

### Built around three ideas

- **No tmux** — terminal sessions live on the server and survive browser refreshes. Reconnect from your phone, tablet, or another computer without losing anything.
- **AI agent awareness** — the app watches PTY output and detects when Claude Code, Codex CLI, or OpenCode is waiting for your input. You get a badge notification without polling terminals manually.
- **Git safety** — create a snapshot before every AI session, review the diff, revert individual files or everything, and commit — all without leaving the app.

### Terminal sessions survive Opus Command restarts

PTY sessions are owned by the workspace container, not the main app. Each workspace runs a lightweight `terminal-agent` process that holds all PTY sessions independently.

```
Browser
  ↕ Socket.io
Opus Command  ← can be updated/restarted freely
  ↕ WebSocket (internal Docker network)
terminal-agent  ← lives inside the workspace container
  ↕ node-pty
bash / Claude Code / Codex CLI
```

When Opus Command restarts or updates, it reconnects to the surviving terminal-agents. Claude Code keeps running. Your terminal picks up exactly where it left off — no lost input, no dead session overlay, resize still works.

If the workspace container itself restarts, sessions end (the PTY process is gone). Everything else — Opus Command updates, container image swaps, service restarts — is transparent to running sessions.

---

## Projects

**Projects are the heart of Opus Command.** Everything else — terminals, files, git, AI agents, connectors — hangs off a project.

A **project** is a folder on disk paired with its own isolated **workspace container**. Creating a project provisions a dedicated Docker environment from a workspace template; from then on, that project has everything it needs in one place:

- **Its own files** — rooted at the project folder, never touched by other projects
- **Its own terminal sessions** — running inside the project's workspace container
- **Its own tools and configuration** — a persistent home volume that survives restarts and container replacement
- **Its own AI agents** — Claude Code and Codex run *inside* the project's workspace, where the code lives
- **Its own connector access** — reach Windows, Linux, and other machines through the `opus` CLI

Projects are fully isolated from one another, yet managed from a single interface. Create one in a 3-step modal (**name → folder → workspace template**), and the project dashboard gives you live workspace status (Running / Starting / Stopped / Error) with quick-action cards for **Terminal**, **Files**, and **Git**.

Because the workspace is just a container over a persistent volume, a project is **disposable and reproducible**: Start, Stop, Restart, Recreate, Rebuild, or Reset Environment at will. Deleting a project removes the container and home volume — **your project files on disk are always preserved.**

```text
Project
 ├── Folder on disk (/projects/my-app)   ← your files, never deleted
 └── Workspace container                 ← disposable & reproducible
      ├── Terminal sessions (survive restarts)
      ├── Claude Code / Codex CLI
      ├── Tools & config (persistent home volume)
      └── opus CLI → connectors (Windows, Linux, …)
```

---

## Quick Start

```yaml
# docker-compose.yml
services:
  opus-command:
    image: ghcr.io/karlmit/opus-command:latest
    container_name: opus-command
    ports:
      - "3000:3000"
    volumes:
      - /mnt/user/appdata/OpusCommand:/app/data
      - /mnt/user/opus-projects:/projects
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - SESSION_SECRET=change-me-to-a-random-string
    restart: unless-stopped
```

```bash
# Generate a strong secret
openssl rand -hex 32

# Start
docker compose up -d
```

Open **http://localhost:3000**. First startup shows a setup screen to create your admin account.

---

## Features

### ✅ Implemented

#### Authentication & Security
- First-run setup screen — creates admin account on first launch
- Session-based auth with bcrypt (cost 12), HttpOnly + SameSite=Strict cookies
- CSRF protection on all state-changing requests
- Login rate limiting — 5 failed attempts per 15 minutes per IP
- Path traversal prevention on all file operations
- Single admin account — no public signup

#### Project Management
- Create projects with a 3-step modal (name → folder → workspace template)
- Project list with live workspace status (Running / Starting / Stopped / Error)
- Project dashboard with quick-action cards for Terminal, Files, and Git
- Delete project — removes container and home volume; project files on disk are preserved

#### Workspace Containers
- Isolated Docker containers per project, provisioned automatically on creation
- Workspace templates: General, Node.js, Python, PowerShell
- Full lifecycle controls: Start, Stop, Restart, Recreate, Rebuild, Reset Environment
- Each action has a confirmation modal describing exactly what will and won't be deleted
- Container logs viewer (live tail)
- Persistent home volume — tools and config survive restarts and container replacement
- Workspace containers do not have access to the Docker socket
- Workspace-scoped `opus` CLI is installed automatically for connector access
- Managed Opus skills are refreshed under `.opus/skills/` on workspace start, while user-owned `CLAUDE.md` and `AGENTS.md` files are only given a small pointer if missing

#### Terminal System
- Multiple named PTY sessions per project, running inside workspace containers
- Sessions survive browser refresh, tab close, **and Opus Command restarts** — PTYs live in the workspace container, not the main app
- Reconnect from any device (PC, tablet, phone) and pick up where you left off
- 5,000-line scrollback stored server-side and restored on reconnect
- Editable session names (double-click to rename)
- Two-click kill confirmation ("Kill?" on first click, confirm on second within 3s)
- Reconnect overlay — "Reconnecting…" on disconnect, "Connection lost. Retrying… Ns" after 5s
- Auto-reattach on reconnect with no user action required

#### AI Session Awareness
- Monitors PTY output against `/app/data/agent-patterns.json`
- Detects active AI sessions (Claude Code, Codex CLI, OpenCode) from output patterns
- Detects waiting-for-input state — requires 1 second of silence after trigger pattern
- Notification within 5 seconds: pulsing accent badge on terminal tab and project card
- Clicking a terminal tab with the waiting badge activates that terminal
- Optional audio notification — configurable in Settings, default off
- Pattern file is hot-reloaded every 5 seconds — add new agents without restarting

#### File Management
- File tree rooted at project folder, auto-refreshes within 2 seconds of AI agent changes
- **Git status indicators** — coloured dots and tinted filenames in the tree (M=amber, A=green, D=red, R=blue, ?=grey); directory dot when any child has changes
- Toolbar with New File and New Folder buttons (also available via right-click context menu)
- Operations: create, rename, delete (with confirmation), download, copy absolute path
- Drag-and-drop file upload — per-file progress toasts, error toasts per failed file
- File name search — filters tree in real time as you type
- Full-text content search across all text files

#### Opus Connector
The **Opus Connector** is a core part of Opus Command. It lets a remote machine — Windows or Linux — act as an execution environment for your workspaces. The connector dials outbound to Opus Command, then workspaces run jobs on it through the `opus` CLI. This extends a project's reach beyond its container: PowerShell on a Windows box, builds on a Linux server, hardware and local tooling on either.

> **Linux and Windows targets are available today.** The **Linux connector is currently the most capable** — it supports async/background jobs, job management (list/status/cancel), bidirectional file transfer, multiple shells, dependency profiles, systemd/autostart service install, self-update, and browser screenshots via Playwright. The **Windows connector** focuses on the core pairing + run flow with an Electron GUI; richer features are being brought to parity. macOS and Android are on the roadmap.

- Connectors pair outbound — no inbound ports to open on the target machine
- Workspaces get connector access through the `opus` CLI, not by talking directly to connector machines
- Connector jobs run through Opus Command over the connector WebSocket and return stdout, stderr, exit code, and artifacts
- Settings page can generate pairing tokens and shows both GUI setup values and a CLI fallback command
- Existing workspaces receive connector access after Rebuild or Recreate; new workspaces get it automatically

**Linux connector** (most feature-complete):
- One-file installer with interactive terminal wizard, `--gui` (Zenity/PolicyKit), or unattended/silent flags
- Local status UI (`http://127.0.0.1:3899`) showing pairing, connection, capabilities, and logs
- systemd service or desktop autostart, plus self-update from a newer installer
- Shells: `bash`, `sh`, `python`/`python3`, `pwsh`, and direct executables
- Async jobs (`--wait false`), job `list` / `status` / `cancel`, and bidirectional `put` / `get` file transfer
- Browser screenshots when Playwright is available

**Windows connector:**
- One-file NSIS installer for `C:\OpusConnector`; config, logs, and working data in `C:\ProgramData\OpusConnector`
- Electron GUI pairing flow: paste the server URL and pairing token, click Connect, watch Online / Connecting / Error status

```bash
# Works against any paired connector — match by name or label
opus connectors list
opus connector run linux   -- bash "uname -a"
opus connector run windows -- powershell "Get-ComputerInfo"
opus connector artifacts get <job-id>
```

#### Code Editor
- Simple text editor with Ctrl+S / Cmd+S save and explicit Save button
- Unsaved indicator (`·` appended to filename in tab)
- Navigation-away confirmation: "Save / Discard / Cancel" when closing a dirty tab
- Markdown: Edit / Preview / Split mode toggle
- JSON: Format button (pretty-print)
- Image viewer for PNG, JPG, GIF, SVG, WebP
- "This file cannot be displayed." for binary and unsupported types

#### Git Integration
- **Three-pane layout with a "metro-map" style visualization** — toolbar, left changes panel, right diff/history
- Branch pill showing current branch; new-branch form to create and switch in one step
- Ahead/behind commit counts with Fetch, Pull, and Push buttons
- Changed files list with coloured status badges (M / A / D / R / ?)
- Line-numbered unified diff view — added lines green, removed lines red, hunk headers accented
- Stage / unstage files via checkbox; commit with message (Ctrl+Enter shortcut)
- Single-file revert — inline two-click confirmation; Revert All with modal confirmation
- Create branch from current HEAD
- **Commit history with visual branch graph** — coloured dots per branch, relative timestamps, ref pills (HEAD, branch, remote, tag)
- Snapshots — annotated git tags (`snapshot/YYYY-MM-DD-HH-MM-SS`) with optional label
- Snapshot list with human-readable timestamps ("Today at 14:22"), restore with one-click confirmation
- Restore fully resets working tree: `git checkout tag -- .` + `git clean -fd`
- Git panel auto-refreshes within 3 seconds
- Auto-detects git root inside workspace container (handles repos in subdirectories)
- All git operations execute inside the workspace container

#### Settings
- Change password (requires current password confirmation)
- Theme: Dark (default), Light, System — applies immediately, persists across sessions
- Sound notifications — enable/disable + sound picker with Preview buttons (default off)
- Update check — fetches latest release from GitHub API, shows version diff and link
- Version displayed as `vX.Y.Z`, embedded at build time

#### Mobile
- Full app accessible on iOS Safari and Android Chrome
- Bottom navigation bar (Terminal | Files | Git | Workspace)
- Files, Git, and Workspace panels work correctly on mobile
- Device-type detection (touch vs. mouse) keeps desktop layout stable when a browser window is narrowed
- Interface mode override in Settings (Auto / Force desktop / Force mobile)

> **Note — mobile terminal:** The terminal view on mobile uses a plain log viewer (read-only scrollable output + command input bar) rather than a full xterm.js emulator. This works for simple commands but does **not** work correctly with full-screen TUI programs like **Claude Code**, which rely on cursor positioning, screen redraws, and precise terminal dimensions. The mobile terminal is not recommended for Claude Code sessions at this time. A future release will add push notifications so you can monitor Claude Code from your phone without needing a working terminal view.

#### Distribution & CI/CD
- Docker image: `ghcr.io/karlmit/opus-command:latest` and `:vX.Y.Z`
- GitHub Actions builds and pushes on every push to `main` and on release tags
- Multi-arch: `linux/amd64` and `linux/arm64`
- Workspace template images built and pushed on release tags
- Database migrations run automatically on startup — no manual commands
- All user data in `/app/data` — container replacement with the volume preserves everything
- Compatible with Unraid, Docker Compose v2, Portainer, Watchtower

---

### 🚧 Known Limitations (V1)

| Area | Limitation |
|------|-----------|
| **Editor** | Simple textarea — no syntax highlighting yet (CodeMirror integration planned) |
| **Workspace images** | Template images are published on release tags; the `general` template falls back to `ubuntu:22.04` in development |
| **File operations** | Copy and Move not yet implemented (workaround: download + re-upload, or use the terminal) |
| **Git** | No interactive rebase, stash, or cherry-pick — complex operations must be done in the terminal |
| **Terminal** | No split-pane view within a single session |
| **Notifications** | Badge + sound only when the browser tab is open — no background push notifications |
| **Mobile terminal** | Log viewer works for simple commands but not full-screen TUIs (Claude Code, htop, vim). Mobile terminal is read-only with command input; it does not render cursor-addressed output correctly |
| **Bundle size** | JS bundle is ~560 KB (xterm.js is the main contributor) — loads fast on LAN |
| **Connector workspace rollout** | Existing workspace containers must be Rebuilt or Recreated once after upgrading to get the `opus` CLI and workspace token |

---

### 🗺️ Planned (Post-V1)

- **CodeMirror editor** — full syntax highlighting for JS, TS, Python, Go, Rust, CSS, and all other CodeMirror-supported languages
- **File copy and move** — drag-and-drop within the file tree
- **Stash / unstash, cherry-pick, interactive rebase** — advanced git operations from the panel
- **Multi-terminal split view** — side-by-side terminal panes
- **Push notifications** — notify your phone when Claude Code is waiting for input, without needing the browser open
- **Additional Opus Connector targets** — macOS and Android, Windows feature parity with Linux, and richer artifact workflows
- **Additional workspace templates** — community-contributed templates for Rust, Go, Java, etc.
- **AI session timeline** — history of AI sessions per project with diffs at each checkpoint
- **Web app preview** — embedded browser preview inside the cockpit for web projects
- **Workspace resource monitoring** — CPU, memory, disk usage per workspace container

---

## Volumes

| Mount | Purpose |
|-------|---------|
| `/app/data` | SQLite database, sessions, settings, AI agent pattern config |
| `/projects` | Project files — never deleted by Opus Command |
| `/var/run/docker.sock` | Required for workspace container management |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_SECRET` | `change-me-in-production` | **Must be changed.** Run `openssl rand -hex 32`. |
| `DATA_DIR` | `/app/data` | Override data directory path |
| `PROJECTS_DIR` | `/projects` | Override projects directory path |
| `PORT` | `3000` | HTTP port |

## Workspace Templates

Workspace containers are isolated Docker environments per project:

| Template | Image | Pre-installed |
|----------|-------|--------------|
| Work | `ghcr.io/karlmit/opus-command-workspace-claude-code:latest` | Node.js, npm, Git, GitHub CLI, Claude Code, Opus CLI, Azure AI Foundry Claude settings |
| Private | `ghcr.io/karlmit/opus-command-workspace-private:latest` | Node.js, npm, Git, GitHub CLI, Claude Code, Codex CLI, Opus CLI |

Template changes are made from the project Workspace panel and require Rebuild to apply. Switching a project to Private clears Claude API environment settings from Opus Command and removes Azure AI Foundry startup exports on the next rebuild.

## Managed Workspace Skills

Opus Command treats project-level agent instruction files as user-owned:

- `/workspace/CLAUDE.md`
- `/workspace/AGENTS.md`
- `~/.claude/CLAUDE.md`

These files may grow over time as Claude, Codex, or the user adds project-specific guidance. Recreate, Rebuild, and Reset Environment must not replace them.

Instead, Opus-owned guidance is written to managed skill files under:

```text
.opus/skills/
```

Current managed skills:

```text
.opus/skills/connectors.md
```

On workspace start, Opus refreshes the managed skill files from the workspace image. It then checks the user-owned agent instruction files and appends this pointer only if it is missing:

```md
## Opus Managed Skills

Also read:
- .opus/skills/connectors.md
```

This lets Opus update connector and future platform guidance across existing workspaces without overwriting custom `CLAUDE.md` or `AGENTS.md` content. Future Opus features that need agent instructions should add or update files in `.opus/skills/`, then reference them through the same pointer block rather than replacing the main agent files.

## Opus Connector

The Opus Connector is a core part of Opus Command. It lets a remote machine act
as an execution environment for your workspaces — without exposing any inbound
ports. The connector dials **outbound** to Opus Command, then workspaces run
jobs on it through the `opus` CLI. A project's AI agent stays in the cockpit
while real work is routed to whatever machine can do it.

```text
Workspace
  ↕ opus CLI + workspace token
Opus Command
  ↕ connector WebSocket (connector dials outbound)
Opus Connector on Linux / Windows
  ↕ bash / PowerShell / local tools
Filesystem, build tools, hardware, Android tooling, etc.
```

### Platform support

| Platform | Status | Highlights |
|----------|--------|-----------|
| **Linux** | ✅ Available — **most feature-complete** | Async jobs + job list/status/cancel, bidirectional `put`/`get` file transfer, multiple shells (`bash`/`sh`/`python`/`pwsh`), one-file installer (terminal wizard, `--gui`, silent), local status UI, systemd/autostart service, self-update, Playwright browser screenshots |
| **Windows** | ✅ Available | NSIS installer, Electron GUI pairing, PowerShell / CMD execution. Advanced job and file-transfer features are being brought to parity with Linux |
| **macOS / Android** | 🗺️ Roadmap | Planned connector targets |

> The Linux connector currently has more features than the Windows connector.
> Both share the same pairing model and `opus` CLI surface; the Linux build
> simply exposes more of the connector protocol today.

### Install and pair a Linux connector

Build the one-file installer from this repo and copy it to the Linux machine:

```bash
cd connectors/linux
npm run build:installer
# → dist/opus-linux-connector-installer.sh
```

Run it (interactive wizard if no flags, `--gui` for a graphical installer, or
fully unattended with explicit options):

```bash
sudo ./opus-linux-connector-installer.sh --server http://OPUS_HOST:3000 --pair PAIRING_TOKEN
```

The connector exposes a local status UI at `http://127.0.0.1:3899` showing
pairing state, connection state, detected capabilities, and logs. Install it as
a systemd service with `--install-service`.

### Install and pair a Windows connector

1. Install `OpusConnector-Setup-0.1.3.exe` on the Windows machine.
2. Open Opus Connector from the Start menu or `C:\OpusConnector\OpusConnector.exe`.
3. In Opus Command, open Settings → Opus Connectors.
4. Create a pairing token.
5. Paste the server URL, pairing token, name, and labels into the connector GUI.
6. Click Connect.

The connector GUI shows the current status and recent logs. When it is paired
successfully, it should show `Online`, and the Settings connector list should
update within 10 seconds.

Windows install layout:

| Path | Purpose |
|------|---------|
| `C:\OpusConnector` | Installed app files |
| `C:\ProgramData\OpusConnector` | Connector config, logs, working folders, artifacts |

### Use connectors from workspaces

New workspaces get the `opus` CLI and connector skill automatically. Existing
workspaces need one Rebuild or Recreate after upgrading to Opus Command
`v0.4.8` or newer.

```bash
opus connectors list
```

Run commands through a matching connector name or label:

```bash
opus connector run linux   -- bash "uname -a"
opus connector run windows -- powershell "Get-ComputerInfo"
opus connector run windows -- cmd "whoami"
```

The Linux connector adds async jobs and file transfer:

```bash
# async job + management
opus connector run linux --wait false -- bash "sleep 60"
opus connector jobs list linux
opus connector jobs status JOB_ID
opus connector jobs cancel JOB_ID

# bidirectional file transfer
opus connector put ./local.txt linux:/tmp/local.txt
opus connector get linux:/tmp/local.txt ./downloaded.txt
```

Connector artifacts can be fetched into the project:

```bash
opus connector artifacts get <job-id>
```

Artifacts are written under:

```text
.opus/artifacts/<job-id>
```

## AI Agent Detection

Pattern matching runs against `/app/data/agent-patterns.json`. Edit this file to add new agents — changes are picked up within 5 seconds without a restart.

Default patterns cover Claude Code, Codex CLI, and OpenCode. A session is promoted to "Waiting" when a trigger pattern appears and no new output follows for 1 second.

## Updating

```bash
# Docker Compose
docker compose pull && docker compose up -d

# Unraid / Portainer / Watchtower
# Use the standard Docker update workflow — no manual steps required.
```

All data in `/app/data` is preserved across updates.

## Roadmap

See [`ROADMAP.md`](ROADMAP.md) for the full feature status — what's done, what's planned for V1, and future **Opus Connector** targets such as macOS and Android, plus Windows feature parity with the Linux connector and richer artifact workflows.

## License

MIT
