# Opus Command — Roadmap

> 🟢 Done &nbsp; 🟡 Partial &nbsp; 🔴 Not yet implemented

---

## Opus Command V1

### Authentication & Security

| Status | Feature |
|--------|---------|
| 🟢 | First-run setup screen — creates admin account on first launch |
| 🟢 | Login with bcrypt password hashing (cost factor 12) |
| 🟢 | Session-based auth — HttpOnly, SameSite=Strict cookies |
| 🟢 | Server-side session storage (SQLite-backed) |
| 🟢 | CSRF protection on all state-changing requests |
| 🟢 | Login rate limiting — 5 failed attempts per 15 min per IP |
| 🟢 | Setup permanently disabled after first account is created |
| 🟢 | Change password from Settings (requires current password) |
| 🟢 | Single admin account — no public signup |
| 🟢 | Path traversal prevention on all file operations |
| 🔴 | Browser push notifications (cross-device background alerts) |

---

### Project Management

| Status | Feature |
|--------|---------|
| 🟢 | Create project — name, folder path, workspace template |
| 🟢 | Project list with live workspace status (Running / Starting / Stopped / Error) |
| 🟢 | Project card — status pill, AI badge, terminal count |
| 🟢 | Project dashboard — quick-action cards for Terminal, Files, Git |
| 🟢 | Project activity feed |
| 🟢 | Delete project — removes container + home volume, preserves project files on disk |
| 🔴 | Project description / notes |
| 🔴 | Project search / filter in the project list |
| 🔴 | Project archiving |

---

### Workspace Containers

| Status | Feature |
|--------|---------|
| 🟢 | Isolated Docker container per project, provisioned automatically |
| 🟢 | Workspace templates: General, Node.js, Python, PowerShell |
| 🟢 | Start / Stop / Restart / Recreate / Rebuild / Reset Environment |
| 🟢 | Confirmation modals describing what will and won't be deleted |
| 🟢 | Container logs viewer |
| 🟢 | Workspace health status (Running / Starting / Stopped / Error) |
| 🟢 | Persistent home volume — tools and config survive restarts |
| 🟢 | Workspace containers isolated from the Docker socket |
| 🟢 | Template images published to GHCR on release |
| 🔴 | Workspace resource monitoring (CPU, memory, disk per container) |
| 🔴 | Custom workspace Dockerfiles per project |
| 🔴 | Docker Compose file management |
| 🔴 | Template change without Rebuild (apply new template to existing project) |

---

### Terminal System

| Status | Feature |
|--------|---------|
| 🟢 | Multiple named PTY sessions per project |
| 🟢 | Sessions owned by the server — survive browser refresh and tab close |
| 🟢 | Reconnect from any device (PC, tablet, phone) |
| 🟢 | 5,000-line server-side scrollback — restored on reconnect |
| 🟢 | Editable session names (double-click to rename) |
| 🟢 | Create and kill sessions |
| 🟢 | Two-click kill confirmation |
| 🟢 | Auto-reattach on network reconnection |
| 🟢 | Reconnect overlay ("Reconnecting…" → "Connection lost. Retrying…") |
| 🟢 | Hide / show terminal panel without killing the session |
| 🟢 | Horizontally scrollable tab bar on overflow |
| 🟢 | Mobile terminal (calc(100dvh - 56px), touch-scrollable, overscroll:none) |
| 🟢 | Mobile terminal toolbar (session name, Paste, Keyboard, Sessions) |
| 🟢 | Mobile session switcher bottom sheet |
| 🔴 | Terminal panel vertical resize handle |
| 🔴 | Split-pane view within a single terminal window |
| 🔴 | Terminal search (Ctrl+F) |
| 🔴 | Custom shell selection per session (bash / zsh / fish / pwsh) |

---

### AI Session Awareness

| Status | Feature |
|--------|---------|
| 🟢 | PTY output monitoring per session |
| 🟢 | Pattern-based active session detection (Claude Code, Codex CLI, OpenCode) |
| 🟢 | Waiting-for-input detection — 1-second silence after trigger pattern |
| 🟢 | Notification within 5 seconds |
| 🟢 | Pulsing "Waiting" badge on terminal tab |
| 🟢 | Pulsing "Waiting" badge on project card |
| 🟡 | Click badge to navigate to waiting terminal — tab badge works; project card badge navigates to the project, not the specific terminal |
| 🟢 | Visual distinction between active AI tab and plain terminal tab |
| 🟢 | Optional sound notification — configurable in Settings, default off |
| 🟢 | Pattern file at `/app/data/agent-patterns.json` — edit without restart |
| 🟢 | Default patterns: Claude Code, Codex CLI, OpenCode |
| 🟢 | AI state machine: None → Active → Waiting → Active → None |
| 🔴 | Browser push notifications (when app tab is not in focus) |
| 🔴 | AI session history / timeline per project |
| 🔴 | AI task queue (queue multiple instructions for an agent) |
| 🔴 | AI cost tracking (token usage per session) |
| 🔴 | Detect agent errors / crashes as a separate notification state |

---

### File Management

| Status | Feature |
|--------|---------|
| 🟢 | File tree rooted at project folder with expand/collapse |
| 🟢 | New file and new folder buttons in toolbar |
| 🟢 | Right-click context menu: New File, New Folder, Rename, Delete, Copy Path, Download |
| 🟢 | Rename |
| 🟢 | Delete with confirmation |
| 🟢 | Download file |
| 🟢 | Copy absolute file path to clipboard |
| 🟢 | Single and multi-file drag-and-drop upload |
| 🟢 | Per-file upload progress toasts |
| 🟢 | File tree auto-refreshes within 2 seconds of AI agent changes |
| 🟢 | File name search — filters tree in real time |
| 🟢 | Full-text content search across text files |
| 🟢 | Path traversal blocked server-side |
| 🔴 | Copy file / folder |
| 🔴 | Move file / folder (drag-and-drop within tree) |
| 🔴 | Multi-select for bulk operations |
| 🟢 | File status indicators from git — coloured dots + tinted names (M/A/D/R/?) in tree |

---

### Code Editor

| Status | Feature |
|--------|---------|
| 🟢 | Text file editing |
| 🟢 | Save via Ctrl+S / Cmd+S and Save button |
| 🟢 | Unsaved indicator (`·` after filename) |
| 🟢 | Navigation-away confirmation (Save / Discard / Cancel) |
| 🟢 | Markdown — Edit / Preview / Split toggle |
| 🟢 | JSON pretty-print Format button |
| 🟢 | Image viewer — PNG, JPG, GIF, SVG, WebP |
| 🔴 | Auto-save configurable in Settings (default off) |
| 🟢 | "This file cannot be displayed." for binary files |
| 🔴 | Syntax highlighting (CodeMirror integration) |
| 🔴 | YAML pretty-print Format button |
| 🔴 | Split editor view (two files side by side) |
| 🔴 | In-editor diff view |
| 🔴 | Ask AI about file |
| 🔴 | Explain file |
| 🔴 | Summarize file |
| 🔴 | Multiple open editor tabs |
| 🔴 | Find and replace |

---

### Git Integration

| Status | Feature |
|--------|---------|
| 🟢 | GitKraken-inspired three-pane layout (toolbar / changes+commit / diff+history) |
| 🟢 | Branch pill — current branch name, new-branch form to create and switch |
| 🟢 | Ahead/behind commit counts with Fetch, Pull, and Push buttons |
| 🟢 | Changed file count and working tree status |
| 🟢 | Changed files list with coloured status badges (M / A / D / R / ?) |
| 🟢 | Line-numbered unified diff view — added green, removed red, hunk headers accented |
| 🟢 | Stage and unstage files via checkbox |
| 🟢 | Commit with message (Ctrl+Enter shortcut) |
| 🟢 | Revert single file — inline two-click confirmation |
| 🟢 | Revert all changes — modal confirmation |
| 🟢 | Create branch from current HEAD |
| 🟢 | Commit history with visual branch graph — coloured dots, relative timestamps, ref pills |
| 🟢 | Snapshots — annotated tags `snapshot/YYYY-MM-DD-HH-MM-SS` with optional label |
| 🟢 | Snapshot list with human-readable timestamps |
| 🟢 | Restore from snapshot — `git checkout tag -- .` + `git clean -fd` for full reset |
| 🟢 | Git panel auto-refreshes within 3 seconds |
| 🟢 | Auto-detects git root inside container (handles repos in subdirectories) |
| 🟢 | All git ops execute inside the workspace container |
| 🔴 | Stash / unstash |
| 🔴 | Cherry-pick commit |
| 🔴 | Interactive rebase |
| 🔴 | GitHub / Azure DevOps pull request integration |

---

### Mobile Experience

| Status | Feature |
|--------|---------|
| 🟢 | Full app accessible on iOS Safari and Android Chrome |
| 🟢 | Bottom navigation bar (Dashboard / Terminal / Files / Git) |
| 🟢 | Project list usable on phone without horizontal scrolling |
| 🟢 | File browser full-screen on mobile |
| 🟢 | AI waiting badge visible on mobile |
| 🟢 | Terminal sessions started on desktop reconnectable on mobile |
| 🔴 | Session switcher accessible on mobile via bottom sheet |
| 🟢 | iOS Safari: 100dvh, overscroll-behavior:none |
| 🟢 | Android Chrome: window.visualViewport for keyboard height |
| 🟡 | Mobile terminal toolbar — quick-key row (Enter, Ctrl+C, Esc, arrows, Tab) + input bar; no session name / Paste / Keyboard / Sessions buttons |
| 🟢 | Minimum 44×44px touch targets |

---

### Settings & Updates

| Status | Feature |
|--------|---------|
| 🟢 | Change password |
| 🟢 | Dark / Light / System theme — applies immediately |
| 🟢 | Sound notifications — enable/disable, sound picker, preview |
| 🟢 | Update check via GitHub Releases API |
| 🟢 | Current version displayed (embedded at build time) |
| 🟢 | Docker update instructions in settings |
| 🔴 | Additional built-in notification sounds |
| 🔴 | Font size preference |
| 🔴 | Custom theme / accent colour |

---

### Distribution & Infrastructure

| Status | Feature |
|--------|---------|
| 🟢 | Docker image: `ghcr.io/karlmit/opus-command:latest` and `:vX.Y.Z` |
| 🟢 | GitHub Actions — builds and pushes on push to main and release tags |
| 🟢 | Multi-arch: linux/amd64 and linux/arm64 |
| 🟢 | Workspace template images pushed to GHCR on release |
| 🟢 | Database migrations run automatically on startup |
| 🟢 | All user data in `/app/data` — container replacement preserves everything |
| 🟢 | Compatible with Unraid, Docker Compose v2, Portainer, Watchtower |
| 🟢 | Port 3000, TLS termination external |
| 🔴 | Automatic workspace backups to `/app/data` |
| 🔴 | Export / import project metadata |

---

## Opus Connector (Separate Product — Post-V1)

Opus Connector extends Opus Command with remote execution environments — Windows PCs, macOS machines, Android build machines, Linux test servers. The AI agent stays in the cockpit while tasks are routed to capable connectors.

### Core Architecture

| Status | Feature |
|--------|---------|
| 🔴 | Connector Agent — lightweight daemon for remote machines |
| 🔴 | Connector registration and authentication |
| 🔴 | Capability advertisement (OS, tools, hardware access) |
| 🔴 | Secure authenticated channel (TLS) between Connector and Control Plane |
| 🔴 | Connector dashboard — status, capabilities, active jobs, health metrics |

### Job Execution

| Status | Feature |
|--------|---------|
| 🔴 | Job queue — route tasks to capable connectors |
| 🔴 | Command execution on remote machine |
| 🔴 | Streaming job logs back to the cockpit |
| 🔴 | Job status tracking |
| 🔴 | Artifact return — APK, EXE, screenshots, reports, build outputs |

### File Synchronisation

| Status | Feature |
|--------|---------|
| 🔴 | Sync project folder to temporary connector workspace before execution |
| 🔴 | Return changed files and artifacts to project folder after execution |
| 🔴 | Connector never permanently owns project files |

### Approval System

| Status | Feature |
|--------|---------|
| 🔴 | Per-job approval prompt in the cockpit (Approve / Deny) |
| 🔴 | Trusted command list — bypass approval for known-safe commands |
| 🔴 | Job audit log |

### Connector Types (Planned)

| Status | Connector |
|--------|-----------|
| 🔴 | Windows Desktop / Windows VM |
| 🔴 | macOS machine (Xcode, iOS Simulator, Apple SDKs) |
| 🔴 | Android build machine (Android Studio, Gradle, ADB) |
| 🔴 | Linux test server |
| 🔴 | Raspberry Pi / embedded hardware |
| 🔴 | Cloud runners |
| 🔴 | Kubernetes runners |

### Future Connector Features

| Status | Feature |
|--------|---------|
| 🔴 | Live remote desktop view |
| 🔴 | Remote browser access |
| 🔴 | Android device mirroring |
| 🔴 | iPhone device mirroring |
| 🔴 | USB device management |
| 🔴 | GPU workload routing |
| 🔴 | Distributed build systems |
| 🔴 | AI agent task scheduling across connectors |
| 🔴 | Automatic test farms |

---

## Further Future (Opus Command)

| Status | Feature |
|--------|---------|
| 🔴 | AI Chat Sidebar — conversational interface alongside the terminal |
| 🔴 | Voice input |
| 🔴 | Claude Code Session Timeline — visual history of what the agent did |
| 🔴 | Web app preview — embedded browser inside the cockpit |
| 🔴 | GitHub / Azure DevOps repository integration |
| 🔴 | One-click workspace sharing |
| 🔴 | Multi-user / team workspaces |
| 🔴 | Project templates — scaffold new projects from a template |
| 🔴 | Docker Compose file management |
| 🔴 | Automatic workspace backups |
| 🔴 | AI cost tracking |
