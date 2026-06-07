---
title: Opus Command v1
status: final
created: 2026-06-07
updated: 2026-06-07
---

# Opus Command — Product Requirements Document

## 1. Vision

Opus Command is a self-hosted Docker web application and **AI project cockpit** for vibe coding — directing AI coding agents rather than writing code manually. It replaces a fragmented toolchain (tmux, SSH, separate git tools, manual terminal polling) with a unified, mobile-capable interface that persists sessions across devices and browsers.

This is not a browser-based IDE. It is a control surface for AI-driven development.

**Three differentiating pillars:**
1. **No tmux** — terminal sessions live on the server, survive browser refreshes, and reconnect from any device
2. **AI agent awareness** — the app detects when an agent is waiting for input and surfaces notifications without manual polling
3. **Git safety** — a lightweight git UI for the snapshot → AI session → review → commit workflow

Open source, hosted at https://github.com/Karlmit/Opus-Command, distributed via GitHub Container Registry.

---

## 2. Problem Statement

A vibe coder directing AI agents from multiple devices faces:

- **Lost terminal context** when switching devices or refreshing the browser; tmux is the workaround but adds cognitive overhead
- **Invisible agent state** — no way to know an agent is waiting for approval without polling the terminal manually; on a phone, this is impractical
- **Risky git workflows** — AI agents make broad changes; without a lightweight snapshot/review/revert flow, mistakes are costly
- **Tool fragmentation** — file browser, editor, terminal, git, and Docker management are separate tools with no shared context

---

## 3. Goals & Success Metrics

| Goal | Metric |
|------|--------|
| Eliminate tmux dependency | Terminal sessions survive browser refresh and device switch 100% of the time |
| Enable mobile work continuation | User can view files, read terminal output, and receive AI notifications from a phone |
| AI agent waiting state surfaced promptly | Waiting-for-input state detected and notification shown within 5 seconds |
| Safe git workflow | Snapshot creation, diff view, revert, and commit all available without leaving the app |
| Zero-touch upgrades | Container replacement with existing data volume restores full app state; no manual steps |
| Fast startup | App fully ready to serve within 30 seconds of container start |

**Counter-metrics:**
- File operations must never expose paths outside the configured project volume
- Terminal management must not require more steps than the current tmux workflow

---

## 4. Scope

### V1 In Scope
All feature groups defined in Section 6.

### V1 Out of Scope
The following are tracked as ideas in the project README and are explicitly deferred:

- **Opus Connector** — planned as a follow-on product after V1; see `OpusConnector_ProjectSpec.md`
- AI Chat Sidebar, Voice Input, AI Session History / Timeline, AI Task Queue
- GitHub / Azure DevOps repository integration (beyond basic git operations)
- Multi-user / team workspaces / workspace sharing
- Web app preview inside browser
- Docker Compose file management
- Automatic workspace backups
- AI cost tracking, workspace resource monitoring
- Claude Code Session Timeline

**Editor nice-to-haves (post-V1):** Split view, diff view, Ask AI About File, Explain File, Summarize File — deferred to keep the editor lightweight in V1.

---

## 5. User & Context

**Primary user:** Single admin (personal use). Accesses from PC, laptop, tablet, and phone. Primarily directs Claude Code, Codex CLI, and OpenCode. Occasionally edits files directly. Runs on an Unraid home server. Accesses via Nginx Proxy Manager at `https://opus.jabba.se`.

**Deployment context:** Self-hosted on Unraid. Managed via Unraid UI, Watchtower, or Portainer using the standard Docker update workflow — no custom scripts.

**User type:** Single admin account. No multi-user support in V1.

---

## 6. Functional Requirements

### FR-AUTH: Authentication & Security

| ID | Requirement |
|----|-------------|
| FR-AUTH-1 | On first startup with no existing data, display a first-run setup screen to create the admin account (username, password, confirm password). |
| FR-AUTH-2 | After first-run setup, all subsequent app access requires login. No unauthenticated access to any route. |
| FR-AUTH-3 | Passwords stored using bcrypt with a cost factor appropriate for the deployment (minimum 12). |
| FR-AUTH-4 | Session-based authentication using server-side sessions. Session cookie is HttpOnly, SameSite=Strict. |
| FR-AUTH-5 | CSRF protection on all state-changing HTTP requests. |
| FR-AUTH-6 | Login rate limiting: maximum 5 failed attempts per 15-minute window per IP; clear error message displayed after lockout. |
| FR-AUTH-7 | No public signup. Account creation is disabled after first-run setup completes. |
| FR-AUTH-8 | User can change their password from Settings. Requires current password confirmation. |
| FR-AUTH-9 | Single admin account only. No multi-user support in V1. |
| FR-AUTH-10 | All file system operations server-side validate that the resolved path is within `/projects`. Attempts to access outside this boundary are rejected with an error and logged. |

### FR-PROJ: Project Management

| ID | Requirement |
|----|-------------|
| FR-PROJ-1 | User creates a project by providing: project name, project folder (subdirectory path within `/projects`), and workspace template selection. |
| FR-PROJ-2 | On project creation, the system automatically: creates a project database record, provisions a workspace container from the chosen template, mounts the project folder to `/workspace` inside the container, creates a persistent named volume for the container's home directory (`~`), and starts the container. |
| FR-PROJ-3 | Project list view shows each project with: name, workspace status indicator, active AI session count, active terminal session count. |
| FR-PROJ-4 | Opening a project displays a project dashboard: project name, workspace status, active AI sessions, active terminal sessions, current git branch + changed file count, recent activity feed, and pending notifications. |
| FR-PROJ-5 | User can delete a project with a confirmation step. Deletion removes: the project database record, the workspace container, the home volume. The project folder on the host disk is **not** deleted. |

### FR-FILE: File Management

| ID | Requirement |
|----|-------------|
| FR-FILE-1 | File manager displays a folder tree rooted at the project folder. |
| FR-FILE-2 | Supported operations: create file, create folder, rename, delete (with confirmation), copy, move, upload (single and multi-file drag-and-drop), download, copy absolute file path to clipboard. |
| FR-FILE-3 | File search: search files by name within the project tree. Results update as the user types. |
| FR-FILE-4 | Content search: full-text search across all text-based files in the project. Displays filename and matching line. |
| FR-FILE-5 | Supported file types: plain text, Markdown, JSON, YAML, all common source code formats, images (PNG, JPG, GIF, SVG, WebP). |
| FR-FILE-6 | The file manager rejects navigation and operations outside the project folder boundary (server-side enforcement). |
| FR-FILE-7 | File tree reflects changes made by AI agents within 2 seconds (watch-based or polling). |

### FR-EDIT: Editor

| ID | Requirement |
|----|-------------|
| FR-EDIT-1 | Clicking a supported text or code file opens it in the editor. |
| FR-EDIT-2 | Syntax highlighting for common languages: JavaScript, TypeScript, Python, Go, Rust, CSS, HTML, JSON, YAML, Markdown, Bash, PowerShell, and other CodeMirror-supported languages. |
| FR-EDIT-3 | Markdown files have a live preview toggle (edit / preview / split). |
| FR-EDIT-4 | JSON and YAML files can be formatted (pretty-printed) with a single action. |
| FR-EDIT-5 | Save via keyboard shortcut (Ctrl+S / Cmd+S) and explicit Save button. |
| FR-EDIT-6 | Auto-save is configurable in Settings (default: off). |
| FR-EDIT-7 | Unsaved changes are visually indicated. Navigating away with unsaved changes triggers a confirmation prompt. |
| FR-EDIT-8 | Image files open in a dedicated viewer (not the text editor). |

### FR-TERM: Terminal System

| ID | Requirement |
|----|-------------|
| FR-TERM-1 | Each project workspace supports multiple named terminal sessions, each a PTY running inside the workspace container. |
| FR-TERM-2 | Terminal sessions are owned by the workspace container, not the browser. Closing the browser or refreshing does not terminate any session. |
| FR-TERM-3 | User can reconnect to any existing terminal session from any device (PC, tablet, phone) and resume from the current state. |
| FR-TERM-4 | Each terminal session has a user-editable name. Default names: "Terminal 1", "Terminal 2", etc. |
| FR-TERM-5 | Terminal scrollback is stored server-side and restored on reconnect (minimum last 5,000 lines). |
| FR-TERM-6 | Terminal UI is mobile-optimised: touch-scrollable, keyboard-accessible via on-screen keyboard, responsive to all viewport sizes. |
| FR-TERM-7 | Standard copy (select to copy or explicit copy button) and paste support across all platforms including mobile. |
| FR-TERM-8 | Terminal panel can be hidden and shown without ending the session. |
| FR-TERM-9 | Terminal panel height is user-resizable. |
| FR-TERM-10 | User can close (kill) a terminal session explicitly. |
| FR-TERM-11 | Terminal sessions are listed in a tabs/sidebar; switching between sessions requires a single tap or click. |
| FR-TERM-12 | On network reconnection, the client automatically re-attaches to existing terminal sessions without manual action. |

### FR-AI: AI Session Awareness

| ID | Requirement |
|----|-------------|
| FR-AI-1 | The system monitors PTY output of all running terminal sessions to detect active AI coding agent sessions (Claude Code, Codex CLI, OpenCode). |
| FR-AI-2 | The system detects when an AI agent enters a waiting-for-input state (awaiting user approval, confirmation, or response). |
| FR-AI-3 | When a waiting state is detected, a notification is surfaced within 5 seconds. |
| FR-AI-4 | Notifications appear as: a badge on the project in the project list, and a badge on the relevant terminal session tab. **V1 notification scope:** badges and sound are visible/audible only when the user has the app open in a browser tab. Cross-device background notification (browser push) is out of scope for V1; the intended mobile use case is a user who opens the app on their phone and sees the badge state. |
| FR-AI-5 | Optional audio notification: configurable in Settings. User can enable/disable and select from a set of built-in sounds. Default: off. |
| FR-AI-6 | Clicking the notification badge navigates the user to the relevant terminal session. |
| FR-AI-7 | Agent detection uses pattern matching against PTY output. The pattern set is stored in a configurable format (JSON config in `/app/data`) to allow future agents to be added without code changes. See Appendix B for the V1 starter pattern set. |
| FR-AI-8 | A session detected as an active AI session is visually distinguished from a plain terminal session in the terminal tab list. |

### FR-GIT: Git Integration

| ID | Requirement |
|----|-------------|
| FR-GIT-1 | Git panel shows: current branch name, count of changed files, working tree status (clean / dirty). |
| FR-GIT-2 | Changed files list shows each modified, added, deleted, renamed, and untracked file with its status indicator. |
| FR-GIT-3 | Selecting a file in the changed files list displays a unified diff view for that file. |
| FR-GIT-4 | User can revert a single file to the last committed state (with confirmation prompt). |
| FR-GIT-5 | User can revert all changes in the working tree (with a prominent confirmation prompt). |
| FR-GIT-6 | User can select files to stage and commit with a commit message. |
| FR-GIT-7 | User can create a new branch from the current HEAD. |
| FR-GIT-8 | Create Snapshot: creates an annotated git tag with format `snapshot/YYYY-MM-DD-HH-MM-SS` and an optional user-provided label appended to the tag message. Snapshots are listed in a Snapshots panel within the git section. Provides a safe restore point before starting an AI session; covers all git-tracked files at that moment. |
| FR-GIT-9 | All git operations execute inside the workspace container (which has git installed). |
| FR-GIT-10 | Git panel auto-refreshes when the working tree changes (max 3-second lag). |
| FR-GIT-11 | Restore from Snapshot: user can select a snapshot from the Snapshots panel and restore the working tree to that snapshot state (equivalent to `git checkout <tag> -- .`). A confirmation prompt clearly states that uncommitted changes will be overwritten. |

### FR-WORK: Workspace Management

| ID | Requirement |
|----|-------------|
| FR-WORK-1 | Each project's workspace container supports the following lifecycle actions from the UI: Start, Stop, Restart, Recreate (delete and recreate container from the current image without pulling a new one — useful after config changes), Rebuild (pull latest template image and recreate container), Reset Environment (wipe and recreate the home volume without touching the project folder). |
| FR-WORK-2 | Each action displays a confirmation prompt that clearly describes what will and will not be deleted. |
| FR-WORK-3 | Container logs viewable from the workspace panel: live log tail with scrollback. |
| FR-WORK-4 | Workspace health status displayed at all times: Running, Starting, Stopped, Error. |
| FR-WORK-5 | Tools installed by the user and AI agent configurations (API keys, CLI login state, `.claude` config, etc.) stored in the persistent home volume and survive container restarts. Both the home directory (`~`) and any workspace-level config are persisted via named Docker volumes; a container restart or Recreate does not wipe them. |
| FR-WORK-6 | Workspace containers do not have access to the Docker socket. Only the main Opus Command container has Docker API access. |
| FR-WORK-7 | V1 workspace templates (see Appendix A). Template selection is made at project creation time; template change requires a Rebuild. |
| FR-WORK-8 | Workspace template images are pre-built and published to GHCR as part of the Opus Command CI/CD pipeline (`ghcr.io/karlmit/opus-command-workspace-{template}:latest`). The main app pulls the appropriate image when creating a workspace container. |
| FR-WORK-9 | AI agent credentials (Claude Code API key, Codex CLI auth, etc.) are configured by the user inside the workspace terminal after first start. These configurations persist in the named home volume (`~/.claude`, `~/.codex`, etc.) and survive restarts, Recreate, and container replacement. No credential injection from the host is required. |

### FR-MOB: Mobile Experience

| ID | Requirement |
|----|-------------|
| FR-MOB-1 | The full application is accessible and functional from a mobile browser (iOS Safari, Android Chrome). |
| FR-MOB-2 | Project list, project dashboard, file browser, file/image viewer, and terminal panels are all usable on a phone screen without horizontal scrolling. |
| FR-MOB-3 | AI session notifications (badge + sound) are visible and functional on mobile. |
| FR-MOB-4 | Terminal sessions started on PC are fully reconnectable and usable on mobile. |
| FR-MOB-5 | Navigation between major sections (projects, files, terminals, git) is accessible from a persistent mobile-friendly nav element. |
| FR-MOB-6 | The editor opens and displays content correctly on mobile. Text editing is functional; advanced features (keyboard shortcuts, large file performance) are not required but must not crash or corrupt files. |
| FR-MOB-7 | Switching between named terminal sessions is accessible on mobile via a visible session list or tab strip (single tap). |

### FR-UPD: Update Detection

| ID | Requirement |
|----|-------------|
| FR-UPD-1 | Settings > Updates panel displays: current application version, latest available version (from GitHub Releases API), and release notes for the latest release. |
| FR-UPD-2 | "Check for Updates" button manually triggers a fetch from `https://api.github.com/repos/Karlmit/Opus-Command/releases/latest`. |
| FR-UPD-3 | If a newer version exists, the UI displays: "Update Available — Current: X.Y.Z → Latest: A.B.C" with a link to the GitHub release page. |
| FR-UPD-4 | The application does **not** perform self-updates in V1. Update instructions direct the user to their container management tool (Unraid, Watchtower, Portainer, `docker compose pull && docker compose up -d`). |
| FR-UPD-5 | Current application version is embedded at build time from the git tag / `package.json` version field. |

### FR-DIST: Distribution & Deployment

| ID | Requirement |
|----|-------------|
| FR-DIST-1 | Application distributed as a pre-built Docker image: `ghcr.io/karlmit/opus-command:latest` and `ghcr.io/karlmit/opus-command:vX.Y.Z`. |
| FR-DIST-2 | GitHub Actions workflow builds, tags, and pushes the Docker image to GHCR on every push to `main` and on every tagged release. Multi-arch build targeting `linux/amd64` and `linux/arm64`. |
| FR-DIST-3 | Application listens on HTTP port 3000 inside the container. TLS termination handled externally by user's reverse proxy. |
| FR-DIST-4 | Reference Docker Compose configuration included in the README. Required volume mounts: `/app/data` (application data and SQLite database), `/projects` (project files). Required socket mount: `/var/run/docker.sock`. |
| FR-DIST-5 | All user-generated data (accounts, settings, projects, workspace metadata, session history, application configuration, AI agent pattern config) stored exclusively in `/app/data`. Container replacement without removing this volume preserves all data. |
| FR-DIST-6 | Database schema migrations run automatically on application startup using the ORM migration system. No manual migration commands required. |
| FR-DIST-7 | Compatible with Unraid Docker, Docker Compose v2, Portainer CE, and Watchtower without requiring custom scripts or hooks. |

---

## 7. Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-1 | Performance | Application UI loads within 3 seconds on a LAN connection. Terminal input-to-output latency under 50ms on LAN. |
| NFR-2 | Reliability | Terminal sessions automatically reconnect after transient network interruptions within 5 seconds. |
| NFR-3 | Data safety | No persistent user data stored inside the container filesystem. All writes go to volume-mounted paths. |
| NFR-4 | Security | Path traversal prevented on all file operations (server-side). Workspace containers isolated from Docker socket. Session cookies are HttpOnly and SameSite=Strict. |
| NFR-5 | Portability | Docker image published for both `linux/amd64` and `linux/arm64`. |
| NFR-6 | Startup | Application fully ready to serve requests within 30 seconds of container start, including completing database migrations. |
| NFR-7 | Compatibility | Tested against: Unraid 6.12+, Docker Compose v2, Portainer CE latest, Watchtower latest. |
| NFR-8 | Maintainability | Workspace template configurations defined in data files (not hardcoded logic) so new templates can be added without core code changes. |
| NFR-9 | Zero-touch upgrade | Acceptance criterion: pull new image → `docker compose up -d` (or equivalent Unraid/Watchtower action) → application is fully functional with all prior data intact. No manual commands, file edits, or migration steps required from the user at any point. |

---

## 8. Technology Stack

[ASSUMPTION: Stack chosen by AI author for implementability and ecosystem fit. Karl confirmed: "You decide."]

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | Node.js LTS | Excellent PTY/WebSocket ecosystem; dockerode, simple-git, node-pty are mature Node libraries |
| Backend | Express.js | Broad ecosystem, well-understood by AI coding agents, good session/auth middleware |
| Frontend | React + Vite | Component model suits the multi-panel cockpit layout; fast HMR for development |
| Database | SQLite + Drizzle ORM | Zero-setup, file-based, single-user workload; Drizzle provides type-safe migrations |
| Terminal | node-pty + xterm.js | De-facto standard for web terminals; xterm.js handles mobile rendering |
| Real-time | Socket.io | Handles WebSocket with automatic reconnection — critical for multi-device terminal reattach |
| Docker | dockerode | Official-style Node.js Docker API client |
| Git | simple-git | Node.js wrapper around the git CLI; sufficient for all V1 git operations |
| Auth | express-session + bcrypt | Standard session auth; bcrypt for password hashing |
| CI/CD | GitHub Actions + Docker Buildx | Native GHCR integration; Buildx for multi-arch image builds |

---

## 9. Appendix A: Workspace Templates

All templates include Claude Code and Codex CLI as standard AI agent tooling.

| Template | Included Tools |
|----------|----------------|
| General Development | Git, Claude Code, Codex CLI, curl, wget |
| Node.js Development | Node.js LTS, npm, pnpm, yarn, Git, Claude Code, Codex CLI |
| Python Development | Python 3, pip, venv, Git, Claude Code, Codex CLI |
| PowerShell Development | PowerShell, Git, Claude Code, Codex CLI |

---

## 10. Appendix B: AI Agent Waiting-State Detection Patterns

These are the V1 starter patterns for PTY output monitoring (FR-AI-2, FR-AI-7). Stored in `/app/data/agent-patterns.json`; editable without code changes.

| Agent | Waiting-state trigger patterns | Clear/resume signal |
|-------|-------------------------------|---------------------|
| Claude Code | `Do you want to proceed`, `❯ Yes`, `❯ No`, `(Y/n)`, `Allow`, `Deny`, `Approve` appearing at end of output with input cursor | Next line of output after user input |
| Codex CLI | `Allow command`, `Approve`, `Deny`, `(y/n)`, `[y/N]` at end of output with cursor | Next output line after user input |
| OpenCode | `(y/n)`, `[yes/no]`, `Approve`, `Continue?` at end of output with cursor | Next output line after user input |

Pattern matching is line-based (check last N lines of scrollback). A session is considered "waiting" when a trigger pattern is matched and no new output has followed for 1 second.

---

## 11. Future Work: Opus Connector

Opus Connector is the planned follow-on product after V1 ships. It is a separate project (`OpusConnector_ProjectSpec.md`) and is out of scope for this PRD. The V1 data model and workspace architecture must not preclude its integration.

---

## 12. Open Items

None. All discovery questions resolved during PRD creation.
