<div align="center">

<img src="Logos/mark-dark.svg" alt="Opus Command" width="80" height="80" />

<img src="Logos/wordmark-dark.svg" alt="Opus Command" width="260" height="78" />

**A self-hosted Docker web app and AI project cockpit.**  
Replace tmux, SSH, and fragmented tooling with a unified interface for directing AI coding agents — from any device.

[![Build](https://github.com/Karlmit/Opus-Command/actions/workflows/docker.yml/badge.svg)](https://github.com/Karlmit/Opus-Command/actions/workflows/docker.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![ghcr.io](https://img.shields.io/badge/ghcr.io-karlmit%2Fopus--command-blue?logo=github)](https://github.com/Karlmit/Opus-Command/pkgs/container/opus-command)
[![Roadmap](https://img.shields.io/badge/Roadmap-view-green)](ROADMAP.md)

</div>

---

## What is Opus Command?

Opus Command is built around three ideas:

- **No tmux** — terminal sessions live on the server and survive browser refreshes. Reconnect from your phone, tablet, or another computer without losing anything.
- **AI agent awareness** — the app watches PTY output and detects when Claude Code, Codex CLI, or OpenCode is waiting for your input. You get a badge notification without polling terminals manually.
- **Git safety** — create a snapshot before every AI session, review the diff, revert individual files or everything, and commit — all without leaving the app.

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

#### Terminal System
- Multiple named PTY sessions per project, running inside workspace containers
- Sessions survive browser refresh and tab close — the PTY keeps running server-side
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
- Click badge to navigate directly to the waiting terminal
- Optional audio notification — configurable in Settings, default off
- Pattern file is hot-reloaded every 5 seconds — add new agents without restarting

#### File Management
- File tree rooted at project folder, auto-refreshes within 2 seconds of AI agent changes
- Toolbar with New File and New Folder buttons (also available via right-click context menu)
- Operations: create, rename, delete (with confirmation), download, copy absolute path
- Drag-and-drop file upload — per-file progress toasts, error toasts per failed file
- File name search — filters tree in real time as you type
- Full-text content search across all text files

#### Code Editor
- Simple text editor with Ctrl+S / Cmd+S save and explicit Save button
- Unsaved indicator (`·` appended to filename in tab)
- Navigation-away confirmation: "Save / Discard / Cancel" when closing a dirty tab
- Markdown: Edit / Preview / Split mode toggle
- JSON: Format button (pretty-print)
- Image viewer for PNG, JPG, GIF, SVG, WebP
- "This file cannot be displayed." for binary and unsupported types

#### Git Integration
- Branch name, changed file count, and clean/dirty status
- Changed files list with status badges (M / A / D / R / ?)
- Unified diff view — added lines in green (20% opacity), removed lines in red (20% opacity)
- Stage and unstage files via checkbox; commit with message
- Single-file revert — inline two-click confirmation
- Revert all changes — modal confirmation
- Create branch from current HEAD
- Snapshots — annotated git tags (`snapshot/YYYY-MM-DD-HH-MM-SS`) with optional label
- Snapshot list with human-readable timestamps ("Today at 14:22")
- Restore from snapshot — modal confirmation warns uncommitted changes will be overwritten
- Git panel auto-refreshes within 3 seconds
- All git operations execute inside the workspace container

#### Settings
- Change password (requires current password confirmation)
- Theme: Dark (default), Light, System — applies immediately, persists across sessions
- Sound notifications — enable/disable + sound picker with Preview buttons (default off)
- Update check — fetches latest release from GitHub API, shows version diff and link
- Version displayed as `vX.Y.Z`, embedded at build time

#### Mobile
- Full app accessible on iOS Safari and Android Chrome
- Bottom navigation bar (Dashboard | Terminal | Files | Git)
- Terminal fills `calc(100dvh - 56px)`, touch-scrollable, `overscroll-behavior: none`
- Mobile terminal toolbar: session name, Paste, Keyboard, Sessions buttons
- Session switcher bottom sheet
- Minimum 44×44px touch targets

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
| **Git** | No push/pull — remote operations must be done in the terminal |
| **Terminal** | No split-pane view within a single session |
| **Notifications** | Badge + sound only when the browser tab is open — no background push notifications |
| **Bundle size** | JS bundle is ~560 KB (xterm.js is the main contributor) — loads fast on LAN |

---

### 🗺️ Planned (Post-V1)

- **CodeMirror editor** — full syntax highlighting for JS, TS, Python, Go, Rust, CSS, and all other CodeMirror-supported languages
- **File copy and move** — drag-and-drop within the file tree
- **Git push / pull** — remote operations from the Git panel (requires credential management in home volume)
- **Multi-terminal split view** — side-by-side terminal panes
- **Opus Connector** — companion product for cross-device background AI notifications (see `OpusConnector_ProjectSpec.md`)
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
| General | `ubuntu:22.04` | Git, curl, wget |
| Node.js | `node:20-bookworm-slim` | Node.js LTS, npm, pnpm, yarn, Git |
| Python | `python:3.12-slim-bookworm` | Python 3, pip, pipenv, poetry, Git |
| PowerShell | `mcr.microsoft.com/powershell:7.4` | PowerShell 7, Git |

All templates: install Claude Code inside the terminal after first start with `npm install -g @anthropic-ai/claude-code`. Credentials persist in the named home volume.

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

See [`ROADMAP.md`](ROADMAP.md) for the full feature status — what's done, what's planned for V1, and the post-V1 **Opus Connector** (remote execution environments for Windows, macOS, Android and more).

## License

MIT
