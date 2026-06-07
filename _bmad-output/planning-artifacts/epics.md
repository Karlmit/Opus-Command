---
stepsCompleted: ["step-01", "step-02", "step-03", "step-04"]
inputDocuments:
  - planning-artifacts/prds/prd-OpusCommand-2026-06-07/prd.md
  - planning-artifacts/ux-designs/ux-OpusCommand-2026-06-07/DESIGN.md
  - planning-artifacts/ux-designs/ux-OpusCommand-2026-06-07/EXPERIENCE.md
---

# OpusCommand - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Opus Command, decomposing the requirements from the PRD, UX Design, and Architecture (via PRD Section 8) into implementable stories.

---

## Requirements Inventory

### Functional Requirements

FR-AUTH-1: On first startup with no existing data, display a first-run setup screen to create the admin account (username, password, confirm password).
FR-AUTH-2: After first-run setup, all subsequent app access requires login. No unauthenticated access to any route.
FR-AUTH-3: Passwords stored using bcrypt with a cost factor appropriate for the deployment (minimum 12).
FR-AUTH-4: Session-based authentication using server-side sessions. Session cookie is HttpOnly, SameSite=Strict.
FR-AUTH-5: CSRF protection on all state-changing HTTP requests.
FR-AUTH-6: Login rate limiting: maximum 5 failed attempts per 15-minute window per IP; clear error message displayed after lockout.
FR-AUTH-7: No public signup. Account creation is disabled after first-run setup completes.
FR-AUTH-8: User can change their password from Settings. Requires current password confirmation.
FR-AUTH-9: Single admin account only. No multi-user support in V1.
FR-AUTH-10: All file system operations server-side validate that the resolved path is within `/projects`. Attempts to access outside this boundary are rejected with an error and logged.

FR-PROJ-1: User creates a project by providing: project name, project folder (subdirectory path within `/projects`), and workspace template selection.
FR-PROJ-2: On project creation, the system automatically: creates a project database record, provisions a workspace container from the chosen template, mounts the project folder to `/workspace` inside the container, creates a persistent named volume for the container's home directory (`~`), and starts the container.
FR-PROJ-3: Project list view shows each project with: name, workspace status indicator, active AI session count, active terminal session count.
FR-PROJ-4: Opening a project displays a project dashboard: project name, workspace status, active AI sessions, active terminal sessions, current git branch + changed file count, recent activity feed, and pending notifications.
FR-PROJ-5: User can delete a project with a confirmation step. Deletion removes: the project database record, the workspace container, the home volume. The project folder on the host disk is not deleted.

FR-FILE-1: File manager displays a folder tree rooted at the project folder.
FR-FILE-2: Supported operations: create file, create folder, rename, delete (with confirmation), copy, move, upload (single and multi-file drag-and-drop), download, copy absolute file path to clipboard.
FR-FILE-3: File search: search files by name within the project tree. Results update as the user types.
FR-FILE-4: Content search: full-text search across all text-based files in the project. Displays filename and matching line.
FR-FILE-5: Supported file types: plain text, Markdown, JSON, YAML, all common source code formats, images (PNG, JPG, GIF, SVG, WebP).
FR-FILE-6: The file manager rejects navigation and operations outside the project folder boundary (server-side enforcement).
FR-FILE-7: File tree reflects changes made by AI agents within 2 seconds (watch-based or polling).

FR-EDIT-1: Clicking a supported text or code file opens it in the editor.
FR-EDIT-2: Syntax highlighting for common languages: JavaScript, TypeScript, Python, Go, Rust, CSS, HTML, JSON, YAML, Markdown, Bash, PowerShell, and other CodeMirror-supported languages.
FR-EDIT-3: Markdown files have a live preview toggle (edit / preview / split).
FR-EDIT-4: JSON and YAML files can be formatted (pretty-printed) with a single action.
FR-EDIT-5: Save via keyboard shortcut (Ctrl+S / Cmd+S) and explicit Save button.
FR-EDIT-6: Auto-save is configurable in Settings (default: off).
FR-EDIT-7: Unsaved changes are visually indicated. Navigating away with unsaved changes triggers a confirmation prompt.
FR-EDIT-8: Image files open in a dedicated viewer (not the text editor).

FR-TERM-1: Each project workspace supports multiple named terminal sessions, each a PTY running inside the workspace container.
FR-TERM-2: Terminal sessions are owned by the workspace container, not the browser. Closing the browser or refreshing does not terminate any session.
FR-TERM-3: User can reconnect to any existing terminal session from any device (PC, tablet, phone) and resume from the current state.
FR-TERM-4: Each terminal session has a user-editable name. Default names: "Terminal 1", "Terminal 2", etc.
FR-TERM-5: Terminal scrollback is stored server-side and restored on reconnect (minimum last 5,000 lines).
FR-TERM-6: Terminal UI is mobile-optimised: touch-scrollable, keyboard-accessible via on-screen keyboard, responsive to all viewport sizes.
FR-TERM-7: Standard copy (select to copy or explicit copy button) and paste support across all platforms including mobile.
FR-TERM-8: Terminal panel can be hidden and shown without ending the session.
FR-TERM-9: Terminal panel height is user-resizable.
FR-TERM-10: User can close (kill) a terminal session explicitly.
FR-TERM-11: Terminal sessions are listed in a tabs/sidebar; switching between sessions requires a single tap or click.
FR-TERM-12: On network reconnection, the client automatically re-attaches to existing terminal sessions without manual action.

FR-AI-1: The system monitors PTY output of all running terminal sessions to detect active AI coding agent sessions (Claude Code, Codex CLI, OpenCode).
FR-AI-2: The system detects when an AI agent enters a waiting-for-input state (awaiting user approval, confirmation, or response).
FR-AI-3: When a waiting state is detected, a notification is surfaced within 5 seconds.
FR-AI-4: Notifications appear as: a badge on the project in the project list, and a badge on the relevant terminal session tab. V1 scope: badges and sound visible/audible only when app is open in browser tab.
FR-AI-5: Optional audio notification: configurable in Settings. User can enable/disable and select from a set of built-in sounds. Default: off.
FR-AI-6: Clicking the notification badge navigates the user to the relevant terminal session.
FR-AI-7: Agent detection uses pattern matching against PTY output. The pattern set is stored in `/app/data/agent-patterns.json` to allow future agents to be added without code changes.
FR-AI-8: A session detected as an active AI session is visually distinguished from a plain terminal session in the terminal tab list.

FR-GIT-1: Git panel shows: current branch name, count of changed files, working tree status (clean / dirty).
FR-GIT-2: Changed files list shows each modified, added, deleted, renamed, and untracked file with its status indicator.
FR-GIT-3: Selecting a file in the changed files list displays a unified diff view for that file.
FR-GIT-4: User can revert a single file to the last committed state (with confirmation prompt).
FR-GIT-5: User can revert all changes in the working tree (with a prominent confirmation prompt).
FR-GIT-6: User can select files to stage and commit with a commit message.
FR-GIT-7: User can create a new branch from the current HEAD.
FR-GIT-8: Create Snapshot: creates an annotated git tag with format `snapshot/YYYY-MM-DD-HH-MM-SS` and an optional user-provided label. Snapshots listed in a Snapshots panel within the git section.
FR-GIT-9: All git operations execute inside the workspace container (which has git installed).
FR-GIT-10: Git panel auto-refreshes when the working tree changes (max 3-second lag).
FR-GIT-11: Restore from Snapshot: user can select a snapshot and restore the working tree to that state. Confirmation prompt warns that uncommitted changes will be overwritten.

FR-WORK-1: Workspace container lifecycle actions from the UI: Start, Stop, Restart, Recreate, Rebuild (pull latest template image), Reset Environment (wipe home volume, preserve project folder).
FR-WORK-2: Each lifecycle action displays a confirmation prompt that clearly describes what will and will not be deleted.
FR-WORK-3: Container logs viewable from the workspace panel: live log tail with scrollback.
FR-WORK-4: Workspace health status displayed at all times: Running, Starting, Stopped, Error.
FR-WORK-5: Tools and AI agent configurations stored in the persistent home volume; survive container restarts, Recreate, and container replacement.
FR-WORK-6: Workspace containers do not have access to the Docker socket.
FR-WORK-7: V1 workspace templates: General Development, Node.js Development, Python Development, PowerShell Development. Template change requires Rebuild.
FR-WORK-8: Workspace template images pre-built and published to GHCR as `ghcr.io/karlmit/opus-command-workspace-{template}:latest`.
FR-WORK-9: AI agent credentials configured by user inside workspace terminal after first start; persist in named home volume.

FR-MOB-1: Full application accessible and functional from a mobile browser (iOS Safari, Android Chrome).
FR-MOB-2: Project list, project dashboard, file browser, file/image viewer, and terminal panels usable on a phone screen without horizontal scrolling.
FR-MOB-3: AI session notifications (badge + sound) visible and functional on mobile.
FR-MOB-4: Terminal sessions started on PC fully reconnectable and usable on mobile.
FR-MOB-5: Navigation between major sections accessible from a persistent mobile-friendly nav element.
FR-MOB-6: Editor opens and displays content correctly on mobile; text editing functional; must not crash or corrupt files.
FR-MOB-7: Switching between named terminal sessions accessible on mobile via visible session list or tab strip (single tap).

FR-UPD-1: Settings > Updates panel: current version, latest available version (GitHub Releases API), release notes.
FR-UPD-2: "Check for Updates" button triggers fetch from `https://api.github.com/repos/Karlmit/Opus-Command/releases/latest`.
FR-UPD-3: If newer version exists, display "Update Available — Current: X.Y.Z → Latest: A.B.C" with link to release page.
FR-UPD-4: Application does not perform self-updates in V1. Instructions direct user to their Docker management tool.
FR-UPD-5: Current application version embedded at build time from git tag / package.json version field.

FR-DIST-1: Application distributed as Docker image: `ghcr.io/karlmit/opus-command:latest` and `ghcr.io/karlmit/opus-command:vX.Y.Z`.
FR-DIST-2: GitHub Actions workflow builds, tags, and pushes to GHCR on every push to `main` and on every tagged release. Multi-arch: linux/amd64 and linux/arm64.
FR-DIST-3: Application listens on HTTP port 3000. TLS termination handled externally.
FR-DIST-4: Reference Docker Compose config in README. Required volumes: `/app/data`, `/projects`. Required socket: `/var/run/docker.sock`.
FR-DIST-5: All user data (accounts, settings, projects, workspace metadata, session history, app config, AI agent pattern config) stored exclusively in `/app/data`.
FR-DIST-6: Database schema migrations run automatically on startup. No manual migration commands required.
FR-DIST-7: Compatible with Unraid Docker, Docker Compose v2, Portainer CE, and Watchtower without custom scripts.

### Non-Functional Requirements

NFR-1: Performance — UI loads within 3 seconds on LAN. Terminal input-to-output latency under 50ms on LAN.
NFR-2: Reliability — Terminal sessions automatically reconnect after transient network interruptions within 5 seconds.
NFR-3: Data Safety — No persistent user data stored inside the container filesystem. All writes go to volume-mounted paths.
NFR-4: Security — Path traversal prevented on all file operations (server-side). Workspace containers isolated from Docker socket. Session cookies HttpOnly and SameSite=Strict.
NFR-5: Portability — Docker image published for both linux/amd64 and linux/arm64.
NFR-6: Startup — Application fully ready within 30 seconds of container start, including completing database migrations.
NFR-7: Compatibility — Tested against Unraid 6.12+, Docker Compose v2, Portainer CE latest, Watchtower latest.
NFR-8: Maintainability — Workspace template configurations defined in data files so new templates can be added without core code changes.
NFR-9: Zero-touch Upgrade — pull new image → docker compose up -d → fully functional with all prior data intact. No manual steps.

### Additional Requirements (Architecture)

ARCH-1: Runtime: Node.js LTS
ARCH-2: Backend: Express.js
ARCH-3: Frontend: React + Vite
ARCH-4: Database: SQLite + Drizzle ORM (file at /app/data/db.sqlite)
ARCH-5: Terminal: node-pty + xterm.js
ARCH-6: Real-time: Socket.io (WebSocket with auto-reconnect)
ARCH-7: Docker integration: dockerode
ARCH-8: Git integration: simple-git
ARCH-9: Auth: express-session + bcrypt
ARCH-10: CI/CD: GitHub Actions + Docker Buildx
ARCH-11: Application listens on HTTP port 3000; TLS termination external
ARCH-12: Required volume mounts: /app/data (SQLite + app data), /projects (project files); Docker socket at /var/run/docker.sock
ARCH-13: Multi-arch image build targeting linux/amd64 and linux/arm64; published to GHCR on push to main and on tagged release
ARCH-14: Database schema migrations run automatically on startup via Drizzle ORM
ARCH-15: All user data in /app/data; container replacement without volume removal preserves all data
ARCH-16: Workspace template images: ghcr.io/karlmit/opus-command-workspace-{template}:latest
ARCH-17: AI agent pattern config stored in /app/data/agent-patterns.json; editable without code change or restart

### UX Design Requirements

UX-DR1: Three-column desktop cockpit layout: Left Sidebar (48px icon rail / 200px expanded, collapsible), File Tree Panel (240px, collapsible), Main Area (flex-grow). All visible simultaneously at ≥1280px.
UX-DR2: Fixed Status Bar at bottom, 24px tall: left = workspace status + git branch + changed file count; right = AI badge (accent if waiting) + terminal count.
UX-DR3: Mobile bottom navigation bar (<600px), 56px tall, 4 items: Dashboard | Terminal | Files | Git. Active item uses accent color.
UX-DR4: Left sidebar toggle states: icon rail (48px) and expanded (200px). Active nav item has 2px accent left border.
UX-DR5: Sidebar nav items: Files, Terminal, Git, Settings. Active item has 2px left border in accent.
UX-DR6: Tablet layout (600–1023px): 48px icon rail + main area. File tree as slide-over drawer.
UX-DR7: Mobile terminal height uses calc(100dvh - 56px). No panel resize affordances on mobile.
UX-DR8: Login / First Run screen: no nav/sidebar. First startup renders first-run form. Fields: Username / Password / Confirm Password. Validate password match and 12-char minimum. On success: redirect to Projects List.
UX-DR9: Standard login form after first-run. Inline error on failure. Rate limit message after 5 failed attempts.
UX-DR10: Projects List as grid/list of project cards (desktop) or vertical list (mobile). Each card: name, workspace status pill, AI waiting badge (if ≥1), terminal count. "New Project" button opens creation modal.
UX-DR11: Project cards: surface background, 1px border, rounded-lg. Hover transitions to surface-elevated at 120ms. Clicking a card with waiting AI badge navigates to waiting terminal.
UX-DR12: New Project modal: 3-step form (Name → Folder → Template). Submit shows loading state. On success: modal closes, card appears with "Starting" pill.
UX-DR13: Mobile Project Status Card: workspace status pill, git branch + count, terminal count, AI count badge, "Open Terminal" button (full width, 48px, accent, rounded-md).
UX-DR14: Workspace Status Pill: 8px dot + status text. "Starting" dot pulses (CSS only, 2s). Color mapping: Running=success, Starting=warning, Stopped=text-tertiary, Error=error.
UX-DR15: Workspace Status Pill ARIA: aria-label="Workspace status: [status text]".
UX-DR16: AI Waiting Badge: accent background, white text, xs semibold, rounded-full. CSS pulse 2s. aria-live="polite". Clicking navigates to waiting terminal.
UX-DR17: Accent blue (#3B82F6) reserved exclusively for AI-agent UI signals. Not for decorative highlights or nav active states.
UX-DR18: Terminal Tab anatomy: [icon][name][ai-badge?][unread-dot?][×]. Name editable on double-click. AI badge pulses when waiting. Unread dot disappears when tab active. Close × uses inline two-click confirm.
UX-DR19: Terminal Tab ARIA: role=tablist/tab/tabpanel, aria-selected, aria-live on AI badge.
UX-DR20: Terminal Tab states: active=text-primary + 2px accent bottom border; inactive=text-tertiary; AI-detected (not waiting)=subtle accent tint; tab bar scrolls horizontally on overflow.
UX-DR21: AI session badge on terminal tab positioned absolutely, top-right corner, overlapping top edge.
UX-DR22: File Tree row anatomy: [chevron?][icon][filename][modified-dot?]. Indent 16px/level. Modified=warning dot. Untracked=text-tertiary. Conflicted=error. Active row=surface-elevated. Updates within 2s of AI file changes.
UX-DR23: File tree context menu on right-click: New File, New Folder, Rename, Delete, Copy Path. ARIA role=menu/menuitem.
UX-DR24: File search input at top of file tree. Filters in real time.
UX-DR25: Git Panel sections: branch bar, Changes (Unstaged + Staged), Snapshots. Auto-refreshes within 3s.
UX-DR26: Git file rows: [status-badge][filename][revert-on-hover]. Inline two-click confirm for revert.
UX-DR27: Diff view in monospace. Added lines: success at 20% opacity. Removed lines: error at 20% opacity.
UX-DR28: Stage/unstage via checkbox. When ≥1 staged: show commit message textarea + Commit button.
UX-DR29: Snapshot rows: [tag-name][timestamp][optional-label][Restore on hover]. "Restore" opens destructive confirmation modal. Timestamp: "Today at 14:22" or "2026-06-07 14:22".
UX-DR30: Editor Tab: [icon][filename][unsaved-dot?][×]. Unsaved indicator = · after filename. Active=text-primary + 2px accent. Unsaved-changes navigation triggers Save/Discard/Cancel modal.
UX-DR31: Markdown editor: Edit | Preview | Split mode toggle.
UX-DR32: Format button (JSON/YAML pretty-print) in editor toolbar when file type is JSON or YAML.
UX-DR33: Auto-save: saves 2s after no typing when enabled in Settings. Default off.
UX-DR34: Editor navigation-away: closing tab or clicking another file prompts save modal. Switching panels does not prompt (tab stays open dirty).
UX-DR35: Image viewer: centered display, zoom controls, no editing. Unknown files show "This file cannot be displayed."
UX-DR36: Toast Notifications: bottom-right, 3s auto-dismiss for success/info, persistent for errors. Max 4 visible. Slide-up + fade-in entrance.
UX-DR37: Panel resize drag handles: 4px wide, invisible until hover. Accent at 40% on hover. File tree min 160px. Terminal panel min 120px.
UX-DR38: File tree collapse via drag to zero or chevron collapse button on drag handle.
UX-DR39: Drag-and-drop file upload onto file tree: accent border overlay on drag-enter. Per-file progress in toast. Error as persistent toast.
UX-DR40: Hover primitive: background transitions to surface-elevated at 120ms. Applied to file tree rows, git rows, project cards, sidebar items, terminal tabs.
UX-DR41: Focus ring: 2px solid accent, offset 2px. Use :focus-visible. Never suppress without replacement.
UX-DR42: Press primitive: buttons scale to 0.97 on press, 80ms. Not applied to icon-only buttons <24px.
UX-DR43: Terminal reconnect overlay: "Reconnecting…" semi-transparent overlay. Silent on success. After >5s: "Connection lost. Retrying…" with elapsed time.
UX-DR44: Modal confirmation dialogs: centered, rounded-lg, surface-elevated, backdrop at 60%. ARIA role=dialog, aria-modal, aria-labelledby, focus trapped.
UX-DR45: Inline two-click confirmation: first click arms (text changes to confirm phrase, warning color). Second click within 3s confirms. Resets if no second click.
UX-DR46: Workspace Lifecycle panel with actions: Start, Stop, Restart, Recreate, Rebuild, Reset Environment. Each requires confirmation modal.
UX-DR47: AI session state machine: No Agent (no indicator) → Active (accent dot + tint) → Waiting (badge + pulse + sound). Transitions on PTY output / process exit.
UX-DR48: All state visual treatments per state table (workspace status, AI session, network, update).
UX-DR49: Keyboard navigation: Tab/Shift-Tab for all interactive elements. Arrow keys within tab bars, file tree, context menus. Focus trapped in modals.
UX-DR50: Color never sole signal: every status uses color + text + (often) icon.
UX-DR51: WCAG AA contrast: text-primary on background ≥4.5:1 dark mode; white text on accent ≥4.5:1.
UX-DR52: Mobile touch targets: minimum 44×44px. "Open Terminal" button full-width, 48px. Terminal tab close 44×44px tap target.
UX-DR53: iOS Safari: 100dvh for terminal height. overscroll-behavior: none in terminal + file tree.
UX-DR54: Android Chrome: window.visualViewport for terminal height when keyboard appears.
UX-DR55: Mobile terminal copy/paste: xterm.js long-press for select-to-copy. Explicit copy + paste buttons in toolbar.
UX-DR56: Mobile terminal toolbar: fixed strip above keyboard when terminal focused. Contains: session name (tap to rename), paste, keyboard toggle, sessions button.
UX-DR57: Mobile session switcher as bottom sheet drawer.
UX-DR58: Settings screen: Account, Appearance, Updates, Sound Notifications.
UX-DR59: Account settings: change-password form. Success toast "Password updated". Error inline "Current password is incorrect."
UX-DR60: Appearance settings: Dark / Light / System theme radio group. Changes apply immediately.
UX-DR61: Updates panel: current version, Check button (spinner during fetch), result display, GitHub link, Docker update instructions.
UX-DR62: Sound Notifications settings: toggle (default off) + sound picker with Preview buttons.
UX-DR63: All approved microcopy implemented exactly as specified in EXPERIENCE.md §3.3.
UX-DR64: All error messages follow "what happened + what to do" pattern as specified in EXPERIENCE.md §3.4.
UX-DR65: All empty states implemented as specified in EXPERIENCE.md §3.5.
UX-DR66: Section headings uppercase with wide tracking (0.04em). Nav labels Title Case. Body sentence case. No exclamation marks in system messages.
UX-DR67: Status text always uses exact values ("3 files changed", "Terminal 1").
UX-DR68: AI agent pattern detection: 1-second silence required before transitioning to Waiting. Pattern file user-editable without restart.
UX-DR69: Color token system implemented as CSS custom properties or Tailwind config. Dark and light mode token sets per DESIGN.md exact values.
UX-DR70: Light mode tokens implemented per DESIGN.md. Terminals always dark.
UX-DR71: Light mode surface vs surface-elevated differentiated by box-shadow only (not background color).
UX-DR72: Dark mode depth via surface token color stack only. No box shadows in dark mode.
UX-DR73: Typography: sans stack for all UI; mono stack exclusively for terminals and code blocks.
UX-DR74: Type scale implemented: xs=11px through 3xl=36px per DESIGN.md.
UX-DR75: Font weights: regular=400, medium=500, semibold=600.
UX-DR76: Line heights: tight=1.2 for headings/labels; normal=1.5 for body/terminal.
UX-DR77: Letter-spacing: tight=-0.02em headings; normal=0em body; wide=0.04em UI labels; wider=0.08em reserved for SVG wordmark only.
UX-DR78: 4px base spacing unit. All spacing values multiples of 4 per DESIGN.md scale.
UX-DR79: Shape tokens enforced per component type per DESIGN.md (sm=badges, md=buttons/inputs, lg=panels, xl=modals, full=pills).
UX-DR80: Button component: height=32px, padding=0 12px, radius=md, font-size=sm, weight=medium. Three variants: Primary, Ghost, Danger.
UX-DR81: Input component: height=32px, padding=0 10px, radius=md, background=surface-elevated, border=1px. Focus: border=accent + ring=accent-subtle.
UX-DR82: AI Signal Badge component: height=18px, rounded-full, xs semibold, accent color + accent-subtle bg. Not reusable for non-AI statuses.
UX-DR83: Status Badge component: same shape as AI badge. State-to-color mapping per DESIGN.md.
UX-DR84: Panel component: radius=lg, border=1px solid border, bg=surface, padding=lg.
UX-DR85: Tab component: height=36px, padding=0 12px, font-size=sm. Active: text-primary + 2px accent bottom. Inactive: text-tertiary. Tab bar flush to container.
UX-DR86: Terminal component: terminal-bg always #1E2024, mono font, base size, cursor=#3B82F6 block. Outer panel radius=lg; inner text area no radius.
UX-DR87: Theme system: dark (default), light, system. Terminal background invariant.
UX-DR88: Wordmark always rendered as SVG asset. Never typeset in HTML/CSS.
UX-DR89: No decorative elements: no gradients, illustrations, decorative icons, background patterns.
UX-DR90: No inflated spacing for aesthetics. Controls 32px tall. Minimum padding for legibility.
UX-DR91: Information density as default: tight line heights, minimum padding.
UX-DR92: All panels use 1px solid border token. Borders define structure; shadows define elevation (light mode only).
UX-DR93: Product mark used only at app load and in wordmark lockup. Never decorative.

### FR Coverage Map

FR-AUTH-1: Epic 1 - First-run setup screen
FR-AUTH-2: Epic 1 - Login required after first-run
FR-AUTH-3: Epic 1 - bcrypt password hashing
FR-AUTH-4: Epic 1 - Session-based auth, HttpOnly cookie
FR-AUTH-5: Epic 1 - CSRF protection
FR-AUTH-6: Epic 1 - Login rate limiting
FR-AUTH-7: Epic 1 - No public signup
FR-AUTH-8: Epic 1/7 - Password change (infrastructure Epic 1, UI Epic 7)
FR-AUTH-9: Epic 1 - Single admin account
FR-AUTH-10: Epic 1 - Path security validation
FR-PROJ-1: Epic 2 - Create project form
FR-PROJ-2: Epic 2 - Workspace container provisioning
FR-PROJ-3: Epic 2 - Project list view
FR-PROJ-4: Epic 2 - Project dashboard
FR-PROJ-5: Epic 2 - Delete project
FR-FILE-1: Epic 3 - File tree
FR-FILE-2: Epic 3 - File CRUD operations
FR-FILE-3: Epic 3 - File name search
FR-FILE-4: Epic 3 - Content search
FR-FILE-5: Epic 3 - File type support
FR-FILE-6: Epic 3 - Path boundary enforcement
FR-FILE-7: Epic 3 - Real-time file tree updates
FR-EDIT-1: Epic 3 - Open file in editor
FR-EDIT-2: Epic 3 - Syntax highlighting
FR-EDIT-3: Epic 3 - Markdown preview
FR-EDIT-4: Epic 3 - JSON/YAML formatting
FR-EDIT-5: Epic 3 - Save keyboard shortcut
FR-EDIT-6: Epic 3 - Auto-save setting
FR-EDIT-7: Epic 3 - Unsaved changes indicator
FR-EDIT-8: Epic 3 - Image viewer
FR-TERM-1: Epic 4 - Multiple named PTY sessions
FR-TERM-2: Epic 4 - Sessions owned by container not browser
FR-TERM-3: Epic 4 - Cross-device reconnect
FR-TERM-4: Epic 4 - Editable session names
FR-TERM-5: Epic 4 - 5000-line scrollback persistence
FR-TERM-6: Epic 4 - Mobile-optimised terminal UI
FR-TERM-7: Epic 4 - Copy/paste support
FR-TERM-8: Epic 4 - Hide/show terminal
FR-TERM-9: Epic 4 - Resizable terminal panel
FR-TERM-10: Epic 4 - Kill terminal session
FR-TERM-11: Epic 4 - Session tab list
FR-TERM-12: Epic 4 - Auto-reattach on reconnect
FR-AI-1: Epic 5 - PTY output monitoring
FR-AI-2: Epic 5 - Waiting-state detection
FR-AI-3: Epic 5 - Notification within 5 seconds
FR-AI-4: Epic 5 - Badge on project card and terminal tab
FR-AI-5: Epic 5 - Audio notifications
FR-AI-6: Epic 5 - Click badge to navigate
FR-AI-7: Epic 5 - Configurable pattern file
FR-AI-8: Epic 5 - AI session visual distinction
FR-GIT-1: Epic 6 - Git panel status
FR-GIT-2: Epic 6 - Changed files list
FR-GIT-3: Epic 6 - Diff viewer
FR-GIT-4: Epic 6 - Revert single file
FR-GIT-5: Epic 6 - Revert all changes
FR-GIT-6: Epic 6 - Stage and commit
FR-GIT-7: Epic 6 - Create branch
FR-GIT-8: Epic 6 - Create snapshot
FR-GIT-9: Epic 6 - Git ops inside workspace container
FR-GIT-10: Epic 6 - Auto-refresh git panel
FR-GIT-11: Epic 6 - Restore from snapshot
FR-WORK-1: Epic 2 - Workspace lifecycle actions
FR-WORK-2: Epic 2 - Lifecycle confirmation prompts
FR-WORK-3: Epic 2 - Container logs viewer
FR-WORK-4: Epic 2 - Workspace health status
FR-WORK-5: Epic 2 - Persistent home volume
FR-WORK-6: Epic 2 - No Docker socket in workspace containers
FR-WORK-7: Epic 2 - Workspace templates
FR-WORK-8: Epic 8 - Template images on GHCR
FR-WORK-9: Epic 2 - AI credentials persist in home volume
FR-MOB-1: Epic 7 - Mobile browser support
FR-MOB-2: Epic 7 - No horizontal scrolling on mobile
FR-MOB-3: Epic 7 - AI notifications on mobile
FR-MOB-4: Epic 4 - Terminal reconnect from mobile
FR-MOB-5: Epic 7 - Mobile nav element
FR-MOB-6: Epic 7 - Editor on mobile
FR-MOB-7: Epic 7 - Terminal session switching on mobile
FR-UPD-1: Epic 7 - Updates settings panel
FR-UPD-2: Epic 7 - Check for updates button
FR-UPD-3: Epic 7 - Update available display
FR-UPD-4: Epic 7 - No self-update
FR-UPD-5: Epic 7 - Version embedded at build time
FR-DIST-1: Epic 8 - GHCR image publishing
FR-DIST-2: Epic 8 - GitHub Actions CI/CD
FR-DIST-3: Epic 1 - HTTP port 3000
FR-DIST-4: Epic 8 - Docker Compose reference config
FR-DIST-5: Epic 1 - All data in /app/data
FR-DIST-6: Epic 1 - Auto database migrations
FR-DIST-7: Epic 8 - Unraid/Compose/Portainer/Watchtower compatibility

## Epic List

### Epic 1: Foundation, Auth & App Shell
User can install, start, log in, and see the application cockpit shell. Sets up the entire technical foundation (Node.js/Express/React/Vite/SQLite/Drizzle/Socket.io), design token system, app layout (sidebar, three-column cockpit, mobile nav, status bar), first-run setup, and login with full security (bcrypt, sessions, CSRF, rate limiting, path security).
**FRs covered:** FR-AUTH-1, FR-AUTH-2, FR-AUTH-3, FR-AUTH-4, FR-AUTH-5, FR-AUTH-6, FR-AUTH-7, FR-AUTH-8, FR-AUTH-9, FR-AUTH-10, FR-DIST-3, FR-DIST-5, FR-DIST-6

### Epic 2: Project Management & Workspace Containers
User can create projects, provision isolated Docker workspace containers, and manage the full workspace lifecycle. Project list UI, create/delete projects, workspace container provisioning via dockerode, Start/Stop/Restart/Recreate/Rebuild/Reset lifecycle actions, container logs viewer, health status display.
**FRs covered:** FR-PROJ-1, FR-PROJ-2, FR-PROJ-3, FR-PROJ-4, FR-PROJ-5, FR-WORK-1, FR-WORK-2, FR-WORK-3, FR-WORK-4, FR-WORK-5, FR-WORK-6, FR-WORK-7, FR-WORK-9

### Epic 3: File Management & Editor
User can browse project files, edit code, view images, and upload/download files. File tree with real-time AI-change detection, all CRUD + drag-and-drop upload, file/content search, CodeMirror editor with syntax highlighting, Markdown preview, JSON/YAML formatting, image viewer, auto-save, unsaved changes protection.
**FRs covered:** FR-FILE-1, FR-FILE-2, FR-FILE-3, FR-FILE-4, FR-FILE-5, FR-FILE-6, FR-FILE-7, FR-EDIT-1, FR-EDIT-2, FR-EDIT-3, FR-EDIT-4, FR-EDIT-5, FR-EDIT-6, FR-EDIT-7, FR-EDIT-8

### Epic 4: Terminal System
User can run and reconnect to persistent terminal sessions across any device. node-pty PTY sessions inside workspace containers, Socket.io streaming, named multi-session support, sessions persist through browser refresh/device switch, 5000-line scrollback, session tabs (create/rename/kill), mobile terminal toolbar and copy/paste.
**FRs covered:** FR-TERM-1, FR-TERM-2, FR-TERM-3, FR-TERM-4, FR-TERM-5, FR-TERM-6, FR-TERM-7, FR-TERM-8, FR-TERM-9, FR-TERM-10, FR-TERM-11, FR-TERM-12, FR-MOB-4

### Epic 5: AI Session Awareness
User is notified when an AI coding agent needs attention, without polling terminals manually. PTY output monitoring, agent-patterns.json pattern matching, waiting-state detection (<5s), pulsing AI badge on project card and terminal tab, click-to-navigate, configurable audio notifications.
**FRs covered:** FR-AI-1, FR-AI-2, FR-AI-3, FR-AI-4, FR-AI-5, FR-AI-6, FR-AI-7, FR-AI-8

### Epic 6: Git Integration
User can safely manage git — snapshot before AI sessions, review diffs, revert, and commit. Git panel (branch/status), changed files list, unified diff viewer, stage/unstage + commit, revert file (inline confirm) + revert all (modal), create branch, Create Snapshot (annotated tag), list + Restore snapshot.
**FRs covered:** FR-GIT-1, FR-GIT-2, FR-GIT-3, FR-GIT-4, FR-GIT-5, FR-GIT-6, FR-GIT-7, FR-GIT-8, FR-GIT-9, FR-GIT-10, FR-GIT-11

### Epic 7: Settings, Mobile Polish & Update Detection
User can configure the app, check for updates, and access it fully from a phone. Settings screens (Account/Appearance/Updates/Sound), password change, dark/light/system theme, update detection via GitHub Releases API, mobile layout (bottom nav, Project Status Card, simplified views), iOS Safari and Android Chrome platform handling.
**FRs covered:** FR-AUTH-8, FR-UPD-1, FR-UPD-2, FR-UPD-3, FR-UPD-4, FR-UPD-5, FR-MOB-1, FR-MOB-2, FR-MOB-3, FR-MOB-5, FR-MOB-6, FR-MOB-7

### Epic 8: Distribution & CI/CD
Application is packaged and published as a production-ready Docker image. Dockerfile (main app), workspace template Dockerfiles (4 templates), docker-compose.yml reference config, GitHub Actions workflow (build + push to GHCR, multi-arch amd64+arm64), version embedding at build time, README deployment instructions.
**FRs covered:** FR-DIST-1, FR-DIST-2, FR-DIST-4, FR-DIST-7, FR-WORK-8

---

## Epic 1: Foundation, Auth & App Shell

User can install, start, log in, and see the application cockpit shell. Sets up the entire technical foundation (Node.js/Express/React/Vite/SQLite/Drizzle/Socket.io), design token system, app layout (sidebar, three-column cockpit, mobile nav, status bar), first-run setup, and login with full security.

### Story 1.1: Project Scaffold, Design System & App Shell

As an admin,
I want the application to have a working technical scaffold with the full app shell layout and design token system,
So that all subsequent features can be built on a consistent, styled foundation.

**Acceptance Criteria:**

**Given** the repository is cloned and `docker compose up` is run,
**When** the container starts,
**Then** the app serves the React frontend on port 3000 and is fully ready within 30 seconds including automatic database migrations.

**Given** the app is running for the first time,
**When** Drizzle ORM runs on startup,
**Then** all database migrations execute automatically with no manual commands required.

**Given** any user data is written (settings, sessions, projects),
**When** the write completes,
**Then** it is stored in `/app/data`; nothing persistent is written inside the container filesystem.

**Given** a desktop browser (≥1024px) opens the app,
**When** the page loads,
**Then** the app shell renders: 48px left sidebar icon rail, file tree panel area (240px default), flex-grow main area, and a 24px fixed status bar at the bottom.

**Given** a mobile browser (<600px) opens the app,
**When** the page loads,
**Then** the layout renders with a 56px bottom nav bar (Dashboard | Terminal | Files | Git) and no left sidebar.

**Given** dark mode is active (default),
**When** any page renders,
**Then** all color tokens resolve to dark mode values: background=#2B2D31, surface=#313338, surface-elevated=#383A40, accent=#3B82F6, and all others per DESIGN.md.

**Given** the Docker image is built via GitHub Actions,
**When** the image is published,
**Then** it supports both linux/amd64 and linux/arm64 architectures.

### Story 1.2: First-Run Setup

As a new admin,
I want to create my admin account on first startup,
So that the application is secured from the moment it runs.

**Acceptance Criteria:**

**Given** `/app/data` is empty (first start with no existing data),
**When** any route is accessed,
**Then** the user is redirected to `/setup` and no other route is accessible.

**Given** I am on the first-run setup screen,
**When** the page renders,
**Then** I see: heading "OPUS COMMAND" (uppercase, wide tracking), subheading "Create your admin account to get started.", fields for Username, Password, Confirm Password, and a "Create Account" button. No sidebar or nav is shown.

**Given** I submit valid credentials (username, password ≥12 chars, passwords match),
**When** the form is submitted,
**Then** the account is created with bcrypt cost factor ≥12, a session is established, and I am redirected to the Projects List.

**Given** I submit a password shorter than 12 characters,
**When** the form is submitted,
**Then** an inline error "Password must be at least 12 characters" is shown and no account is created.

**Given** I submit non-matching passwords,
**When** the form is submitted,
**Then** an inline error "Passwords do not match" is shown and no account is created.

**Given** an admin account already exists,
**When** any user navigates to `/setup`,
**Then** they are redirected to `/login` (setup is permanently disabled after first run).

### Story 1.3: Login & Session Management

As an admin,
I want to log in securely and have my session persist across browser refreshes,
So that I can use the application without re-authenticating constantly.

**Acceptance Criteria:**

**Given** I am not logged in,
**When** I navigate to any protected route,
**Then** I am redirected to `/login`.

**Given** I enter valid credentials and click "Login",
**When** the server authenticates me,
**Then** a server-side session is created, a session cookie is set (HttpOnly, SameSite=Strict), and I am redirected to the Projects List.

**Given** I am logged in and refresh the browser,
**When** the page reloads,
**Then** I remain authenticated and land on the same page.

**Given** I click "Logout",
**When** the action completes,
**Then** my session is destroyed server-side, the cookie is cleared, and I am redirected to `/login`.

**Given** I enter incorrect credentials,
**When** I click "Login",
**Then** the error "Incorrect username or password." is shown inline and no session is created.

**Given** I am not logged in,
**When** I make a direct API request to any protected endpoint,
**Then** the server returns 401 Unauthorized.

### Story 1.4: Security Hardening

As an admin,
I want the app protected against brute force, CSRF, and path traversal attacks,
So that my self-hosted instance is secure.

**Acceptance Criteria:**

**Given** a state-changing HTTP request (POST/PUT/PATCH/DELETE) is made without a valid CSRF token,
**When** the server processes it,
**Then** it returns 403 Forbidden and the action is not performed.

**Given** more than 5 failed login attempts from the same IP within 15 minutes,
**When** the 6th attempt is made,
**Then** the response shows "Too many failed attempts. Try again in 15 minutes." and login is blocked until the window expires.

**Given** a file operation request includes a path containing `../` or resolves outside `/projects`,
**When** the server validates the path,
**Then** it rejects with "Access denied. The path is outside the project folder." and logs the attempt.

**Given** a file operation targets a valid path within the project folder,
**When** the server validates the path,
**Then** it resolves correctly and the operation proceeds.

**Given** first-run setup is complete and an admin account exists,
**When** any request attempts to create a new account,
**Then** the server returns 403 and no account is created.

---

## Epic 2: Project Management & Workspace Containers

User can create projects, provision isolated Docker workspace containers, and manage the full workspace lifecycle.

### Story 2.1: Project List & Create Project

As an admin,
I want to create projects and see them in a list with live workspace status,
So that I can manage multiple isolated development environments.

**Acceptance Criteria:**

**Given** I am logged in and navigate to the Projects List,
**When** the page loads with no projects,
**Then** I see "No projects yet. Create your first project to get started." with a "New Project" button.

**Given** I click "New Project",
**When** the modal opens,
**Then** it shows a 3-step form: (1) Project Name input, (2) Project Folder path input within `/projects`, (3) Workspace Template radio group (General Development / Node.js / Python / PowerShell).

**Given** I complete the form and click "Create Project",
**When** provisioning runs,
**Then** the system creates a project database record, pulls the workspace template image, creates a Docker container with the project folder mounted at `/workspace`, creates a persistent named Docker volume for the container's home directory, and starts the container — all without manual steps.

**Given** the project is being provisioned,
**When** I view the Projects List,
**Then** the new project card appears with a "Starting" status pill (pulsing warning dot) without a page refresh.

**Given** the workspace container starts successfully,
**When** the status check resolves,
**Then** the project card status pill updates to "Running" (success dot) without a page refresh.

**Given** each project card is rendered,
**When** I view the list,
**Then** each card shows: project name, workspace status pill, active AI session count, and active terminal count.

**Given** the workspace container is provisioned,
**When** it is created,
**Then** `/var/run/docker.sock` is not mounted inside the workspace container.

### Story 2.2: Project Dashboard

As an admin,
I want to open a project and see its status dashboard in the cockpit layout,
So that I have full situational awareness before starting work.

**Acceptance Criteria:**

**Given** I click on a project card,
**When** the project opens,
**Then** the cockpit layout renders with: project name and workspace status pill in the top bar, sidebar nav (Files / Terminal / Git / Settings), and the project dashboard as the default main area view.

**Given** the project dashboard renders,
**When** I view it,
**Then** I see: workspace status, active AI session count, active terminal session count, current git branch and changed file count (showing "—" if git not initialized), recent activity feed, and pending notifications.

**Given** the workspace status is "Running",
**When** the dashboard renders,
**Then** the status pill shows a solid success dot with "Running" text and `aria-label="Workspace status: Running"`.

**Given** the workspace status is "Stopped" or "Error",
**When** the dashboard renders,
**Then** the status pill reflects the correct state with the appropriate color and label per DESIGN.md tokens.

### Story 2.3: Workspace Lifecycle Management

As an admin,
I want to control my workspace container (start, stop, restart, recreate, rebuild, reset),
So that I can recover from issues and keep my environment up to date.

**Acceptance Criteria:**

**Given** I am in a project and navigate to the Workspace panel,
**When** the panel renders,
**Then** I see action buttons: Start, Stop, Restart, Recreate, Rebuild, Reset Environment.

**Given** I click any lifecycle action button,
**When** the confirmation modal appears,
**Then** it clearly states what will and will not be deleted for that specific action.

**Given** I confirm Start on a stopped container,
**When** Docker starts it,
**Then** the status updates from "Stopped" → "Starting" (pulse) → "Running" without a page refresh.

**Given** I confirm Recreate,
**When** the action runs,
**Then** the container is removed and recreated from the current image (no image pull); home volume and project files are preserved.

**Given** I confirm Rebuild,
**When** the action runs,
**Then** the latest template image is pulled from GHCR and the container is recreated; home volume and project files are preserved.

**Given** I confirm Reset Environment,
**When** the action runs,
**Then** the home volume is wiped and recreated; the project folder contents are not touched.

**Given** I navigate to the Workspace Logs section,
**When** the panel opens,
**Then** I see a live tail of container logs with scrollback; new lines appear in real time.

### Story 2.4: Delete Project

As an admin,
I want to delete a project and its workspace container,
So that I can clean up projects I no longer need without losing my code.

**Acceptance Criteria:**

**Given** I click "Delete Project",
**When** the confirmation modal appears,
**Then** it shows "Delete project? The project folder will not be deleted." with [Cancel] and [Delete Project] (danger style) buttons.

**Given** I confirm deletion,
**When** the operation completes,
**Then** the project database record is removed, the workspace container is stopped and removed, and the home volume is removed.

**Given** deletion completes,
**When** I view the host filesystem,
**Then** the project folder at `/projects/my-project` and all its files remain on disk untouched.

**Given** I click Cancel,
**When** the modal closes,
**Then** no deletion occurs and the project remains fully intact.

---

## Epic 3: File Management & Editor

User can browse project files, edit code, view images, and upload/download files.

### Story 3.1: File Tree & Core File Operations

As an admin,
I want to browse my project's file tree and perform common file operations,
So that I can navigate and manage files without leaving the cockpit.

**Acceptance Criteria:**

**Given** I open a project and click "Files" in the sidebar,
**When** the file tree panel renders,
**Then** it displays a folder tree rooted at the project folder with expand/collapse chevrons, file/folder icons, and 16px indentation per depth level.

**Given** I right-click a file or folder,
**When** the context menu opens,
**Then** it shows: New File, New Folder, Rename, Delete, Copy Path — with `role="menu"` and `role="menuitem"` ARIA attributes.

**Given** I click "New File" in a folder,
**When** I enter a name and confirm,
**Then** the file is created in that folder and appears in the tree immediately.

**Given** I rename a file,
**When** I submit the new name,
**Then** the file is renamed on disk and the tree updates in place.

**Given** I delete a file and confirm,
**When** deletion completes,
**Then** the file is removed from disk and disappears from the tree.

**Given** an AI agent modifies files in the project folder,
**When** changes occur,
**Then** the file tree reflects additions, deletions, and renames within 2 seconds.

**Given** I click "Copy Path" on a file,
**When** the action completes,
**Then** the absolute file path is copied to the clipboard.

**Given** a file operation targets a path outside `/projects`,
**When** the server validates it,
**Then** it rejects with "Access denied. The path is outside the project folder."

### Story 3.2: File Upload, Download & Search

As an admin,
I want to upload files into my project, download them, and search across the tree,
So that I can quickly find files and move content in and out of the project.

**Acceptance Criteria:**

**Given** I drag files onto the file tree panel,
**When** the drag enters the panel,
**Then** a 2px accent border overlay appears with "Drop files to upload" centered on the panel.

**Given** I drop one or more files,
**When** upload completes,
**Then** each file is uploaded to the selected folder (or project root if none selected) and per-file progress appears in a toast.

**Given** an upload fails for a specific file,
**When** the error occurs,
**Then** a persistent error toast shows "`filename` upload failed: [reason]." and other files continue uploading.

**Given** I right-click a file and select Download,
**When** the download starts,
**Then** the browser downloads the file with the correct filename and content.

**Given** I type in the file search input at the top of the file tree,
**When** I type any character,
**Then** the tree filters in real time to matching filenames. Empty results show "No files match '…'".

**Given** I use content search,
**When** I enter a search term,
**Then** results display matching filenames and the matching line of content. Empty results show "No matches found for '…'".

### Story 3.3: Code Editor

As an admin,
I want to open and edit code files with syntax highlighting and safe save behavior,
So that I can make quick edits without leaving the cockpit.

**Acceptance Criteria:**

**Given** I click a text or code file in the file tree,
**When** the file opens,
**Then** it opens in a CodeMirror editor in the main area with an editor tab showing `[file-icon] [filename]`.

**Given** the file has a recognized extension (JS, TS, Python, Go, Rust, CSS, HTML, JSON, YAML, Markdown, Bash, PowerShell),
**When** the editor renders,
**Then** syntax highlighting is applied for the correct language.

**Given** I edit a file,
**When** the first character is typed,
**Then** the editor tab shows an unsaved indicator (`·` after the filename in text-secondary color).

**Given** I press Ctrl+S or Cmd+S,
**When** the save completes,
**Then** the file is written to disk and the unsaved indicator disappears.

**Given** I have unsaved changes and close the editor tab or click another file,
**When** the navigation is triggered,
**Then** a modal appears: "Save changes to `filename`?" with [Save], [Discard], and [Cancel].

**Given** I have unsaved changes and switch to a different panel (Terminal, Git, Settings),
**When** the panel switches,
**Then** no prompt is shown — the editor tab stays open and dirty in the background.

### Story 3.4: Advanced Editor Features

As an admin,
I want Markdown preview, JSON/YAML formatting, auto-save, and image viewing,
So that the editor handles all common file types I work with.

**Acceptance Criteria:**

**Given** I open a Markdown file,
**When** the editor renders,
**Then** a toggle in the toolbar switches between Edit, Preview, and Split modes. Preview renders the Markdown as HTML.

**Given** I open a JSON or YAML file,
**When** the toolbar renders,
**Then** a "Format" button is visible. Clicking it pretty-prints the content in place.

**Given** auto-save is enabled in Settings,
**When** I stop typing for 2 seconds,
**Then** the file saves automatically and the unsaved indicator clears.

**Given** auto-save is disabled (default),
**When** I stop typing,
**Then** no automatic save occurs.

**Given** I click an image file (PNG, JPG, GIF, SVG, WebP),
**When** the file opens,
**Then** it renders in a dedicated image viewer with zoom controls — not in the text editor.

**Given** I click a binary or unsupported file type,
**When** the viewer attempts to open it,
**Then** an inline message shows "This file cannot be displayed."

---

## Epic 4: Terminal System

User can run and reconnect to persistent terminal sessions across any device.

### Story 4.1: PTY Terminal Sessions & xterm.js Rendering

As an admin,
I want to open terminal sessions inside my workspace container and interact with them from the browser,
So that I can run commands and AI agents without SSH or tmux.

**Acceptance Criteria:**

**Given** I click "Terminal" in the sidebar with no existing sessions,
**When** the terminal panel opens,
**Then** I see "No terminal sessions. Open a new terminal to start." with a "New Terminal" button.

**Given** I click "New Terminal",
**When** the session is created,
**Then** a PTY process is spawned inside the workspace container via node-pty, an xterm.js instance connects to it via Socket.io, and the terminal renders with background #1E2024, text color #E8EAED, and a #3B82F6 block cursor.

**Given** a terminal session is open,
**When** I type a command and press Enter,
**Then** the command executes inside the workspace container and output appears within 50ms on LAN.

**Given** multiple sessions are open,
**When** I view the terminal tab bar,
**Then** each session has its own tab; the active tab has a 2px accent bottom border; switching requires a single click.

**Given** more tabs exist than fit the tab bar width,
**When** I view the bar,
**Then** it scrolls horizontally without wrapping.

### Story 4.2: Persistent Sessions & Cross-Device Reconnect

As an admin,
I want my terminal sessions to survive browser refreshes and reconnect from any device,
So that I never lose a running process by accidentally closing a tab.

**Acceptance Criteria:**

**Given** I have an active terminal session with a running process,
**When** I close the browser tab and reopen the app,
**Then** the PTY process is still running in the workspace container and the session appears in the tab list.

**Given** I reconnect to an existing session,
**When** the terminal renders,
**Then** the last 5,000 lines of scrollback are restored from server-side storage.

**Given** I open the app on a different device while a session is running,
**When** I navigate to Terminal,
**Then** I can reconnect to the existing session and see live output.

**Given** the network connection drops,
**When** connection is lost,
**Then** a semi-transparent "Reconnecting…" overlay appears over the terminal (no spinner, no user action required).

**Given** the network reconnects within 5 seconds,
**When** Socket.io re-establishes the connection,
**Then** the overlay disappears silently and the terminal reattaches with no toast.

**Given** reconnection fails for more than 5 seconds,
**When** the timeout is reached,
**Then** the overlay changes to "Connection lost. Retrying…" with elapsed time displayed.

### Story 4.3: Session Management

As an admin,
I want to rename, kill, hide, and resize terminal sessions,
So that I can organize my workspace and reclaim screen space when needed.

**Acceptance Criteria:**

**Given** I double-click a terminal tab name,
**When** the inline input appears,
**Then** pressing Enter confirms the new name; Escape cancels and restores the original.

**Given** I hover over a terminal tab and click the close button (×),
**When** the first click occurs,
**Then** the button changes to "Kill?" in warning color. A second click within 3 seconds kills the PTY and removes the tab. No action if no second click within 3 seconds.

**Given** I click the hide/toggle button for the terminal panel,
**When** the panel hides,
**Then** the PTY session continues running uninterrupted.

**Given** I drag the terminal panel resize handle vertically,
**When** I drag,
**Then** the terminal panel height changes (minimum 120px) and the xterm.js instance resizes to fill the new dimensions.

### Story 4.4: Mobile Terminal Experience

As an admin,
I want to use terminal sessions from my phone with touch controls and a mobile toolbar,
So that I can interact with running AI agents when away from my desk.

**Acceptance Criteria:**

**Given** I open the app on mobile (<600px) and navigate to Terminal,
**When** the terminal renders,
**Then** it fills `calc(100dvh - 56px)`, is touch-scrollable, and does not trigger browser pull-to-refresh (`overscroll-behavior: none`).

**Given** I tap inside the terminal on mobile,
**When** the terminal focuses,
**Then** a fixed toolbar appears above the keyboard: session name (tap to rename), Paste button, keyboard toggle, Sessions button.

**Given** I tap the Sessions button,
**When** the bottom sheet opens,
**Then** all active sessions are listed; tapping one switches to that session.

**Given** I tap the Paste button,
**When** clipboard permission is granted,
**Then** clipboard contents are pasted at the cursor position.

**Given** the mobile virtual keyboard appears on Android Chrome,
**When** the keyboard opens,
**Then** terminal height adjusts using `window.visualViewport` so the terminal remains visible above the keyboard.

---

## Epic 5: AI Session Awareness

User is notified when an AI coding agent needs attention, without polling terminals manually.

### Story 5.1: AI Session Detection

As an admin,
I want the app to automatically detect when an AI coding agent is running in a terminal,
So that AI sessions are visually distinguished from plain terminal sessions.

**Acceptance Criteria:**

**Given** I run `claude` in a terminal session,
**When** Claude Code initializes and begins outputting,
**Then** the server detects an active AI session via PTY output pattern matching against `/app/data/agent-patterns.json` within 5 seconds.

**Given** an AI session is detected as active,
**When** I view the terminal tab bar,
**Then** the relevant tab shows a subtle accent tint and a small accent dot — visually distinct from a plain terminal tab.

**Given** an AI session process exits,
**When** the PTY signals the process ended,
**Then** the accent tint and dot are removed from the tab.

**Given** `/app/data/agent-patterns.json` is edited to add a new agent pattern,
**When** the file is saved,
**Then** the new patterns are picked up without a server restart or code change.

**Given** no `agent-patterns.json` exists on first startup,
**When** the server initializes,
**Then** a default pattern file is written with V1 starter patterns for Claude Code, Codex CLI, and OpenCode per PRD Appendix B.

### Story 5.2: Waiting-State Detection & Badge Notifications

As an admin,
I want a clear notification when an AI agent is waiting for my input,
So that I don't have to poll the terminal manually — especially when on another device.

**Acceptance Criteria:**

**Given** an agent prints a waiting-state trigger pattern and no new PTY output follows for 1 second,
**When** the waiting state is detected,
**Then** a pulsing accent badge labeled "Waiting" appears on the terminal tab within 5 seconds.

**Given** the waiting state is detected,
**When** I view the Projects List,
**Then** the project card shows the accent "Waiting" badge with a count of waiting sessions.

**Given** the AI badge is rendered,
**When** it is in the DOM,
**Then** it has `aria-live="polite"` on its container.

**Given** I click the "Waiting" badge on a project card or terminal tab,
**When** the click is handled,
**Then** I am navigated to the waiting terminal session and that tab becomes active.

**Given** I respond to the agent and new PTY output is detected,
**When** the agent resumes,
**Then** the "Waiting" badge disappears from both the terminal tab and project card within one polling cycle.

**Given** the AI badge uses accent color (#3B82F6),
**When** I inspect any other non-AI UI element,
**Then** the accent color appears nowhere else in the UI.

### Story 5.3: Audio Notifications & Pattern Configuration

As an admin,
I want an optional sound alert when an AI agent needs attention,
So that I notice waiting states even when looking at another screen.

**Acceptance Criteria:**

**Given** I navigate to Settings > Sound Notifications,
**When** the panel renders,
**Then** I see a toggle "AI session sound notifications" (default: off) and a sound picker with built-in options, each with a "Preview" button.

**Given** sound notifications are enabled and an AI agent enters a waiting state,
**When** the waiting state is detected,
**Then** the selected sound plays in the browser tab once.

**Given** sound notifications are disabled (default),
**When** an AI agent enters a waiting state,
**Then** no sound plays; only the visual badge appears.

**Given** I click "Preview" next to a sound option,
**When** the preview plays,
**Then** the sound plays without triggering any other notification logic.

---

## Epic 6: Git Integration

User can safely manage git — snapshot before AI sessions, review diffs, revert, and commit.

### Story 6.1: Git Status Panel & Changed Files

As an admin,
I want to see my project's git status and changed files at a glance,
So that I always know what state my code is in before and after an AI session.

**Acceptance Criteria:**

**Given** I click "Git" in the sidebar and the workspace has an initialized git repo,
**When** the git panel opens,
**Then** I see: current branch name (monospace, sm), total changed file count, and working tree status (clean/dirty).

**Given** the working tree is clean,
**When** the git panel renders,
**Then** it shows "Working tree clean." with no file list.

**Given** the working tree has changes,
**When** the changed files list renders,
**Then** each file shows a status badge (M/A/D/R/?), the filename in monospace, and the full relative path.

**Given** an AI agent creates, modifies, or deletes files,
**When** changes land on disk,
**Then** the git panel auto-refreshes within 3 seconds to reflect the new state.

**Given** the project folder has no git repository,
**When** the git panel opens,
**Then** it shows a message indicating git is not initialized and no operations are available.

### Story 6.2: Diff Viewer & Revert Operations

As an admin,
I want to review what changed and revert files I don't want to keep,
So that I can safely undo AI changes before committing.

**Acceptance Criteria:**

**Given** I click a file in the changed files list,
**When** the selection is made,
**Then** a unified diff view opens: added lines with success color at 20% opacity, removed lines with error color at 20% opacity, in monospace font.

**Given** I hover over a file row and click the revert button (↩),
**When** the first click occurs,
**Then** the button changes to "Revert?" in warning color. A second click within 3 seconds reverts the file to HEAD. No action if no second click within 3 seconds.

**Given** I confirm a single file revert,
**When** the operation completes,
**Then** the file is restored to HEAD and disappears from the changed files list.

**Given** I click "Revert All Changes" and confirm the modal ("Revert all changes? This cannot be undone."),
**When** the operation completes,
**Then** all working tree changes are discarded and the panel shows "Working tree clean."

### Story 6.3: Stage, Commit & Create Branch

As an admin,
I want to stage files, write a commit message, and commit my changes,
So that I can save my work after reviewing an AI session's output.

**Acceptance Criteria:**

**Given** I check the checkbox next to one or more files in the changed list,
**When** the files are staged,
**Then** they move to a "Staged" section and a commit message textarea + "Commit" button appear below.

**Given** I type a commit message and click "Commit",
**When** the commit runs inside the workspace container via simple-git,
**Then** the staged files are committed, the staged section clears, and the changed file count updates.

**Given** I try to commit with an empty message,
**When** I click "Commit",
**Then** an inline error "Commit message is required." is shown and no commit is made.

**Given** I click "Create Branch" and enter a branch name,
**When** I confirm,
**Then** a new branch is created from the current HEAD and the branch display updates to the new name.

### Story 6.4: Snapshots

As an admin,
I want to create a timestamped git snapshot before starting an AI session,
So that I can restore to a safe state if the AI makes unwanted changes.

**Acceptance Criteria:**

**Given** I click "Create Snapshot",
**When** I confirm (with or without an optional label),
**Then** an annotated git tag `snapshot/YYYY-MM-DD-HH-MM-SS` is created and a success toast shows "Snapshot created — snapshot/2026-06-07-14-30-00".

**Given** snapshots exist,
**When** I view the Snapshots section,
**Then** each row shows: tag name (monospace, xs), human-readable timestamp ("Today at 14:22"), and optional label.

**Given** I hover a snapshot row and click "Restore",
**When** the modal appears,
**Then** it shows "Restore to snapshot/…? Uncommitted changes will be overwritten." with [Cancel] and [Restore] (danger style).

**Given** I confirm restore,
**When** the operation completes,
**Then** the working tree is restored to the snapshot state and the changed files list updates.

**Given** no snapshots exist,
**When** the Snapshots section renders,
**Then** it shows "No snapshots. Create one before starting an AI session."

---

## Epic 7: Settings, Mobile Polish & Update Detection

User can configure the app, check for updates, and access it fully from a phone.

### Story 7.1: Mobile Project Status Card & Responsive Polish

As an admin,
I want a clear mobile-optimised view of my project status and a direct path to the terminal,
So that I can check in on running AI agents from my phone without a cluttered cockpit layout.

**Acceptance Criteria:**

**Given** I open the app on mobile (<600px) and tap a project,
**When** the project view loads,
**Then** the Project Status Card renders: workspace status pill, AI session count badge (accent if any waiting), git branch + changed file count, active terminal count, and a full-width "Open Terminal" button (48px, accent background).

**Given** an AI session is waiting and I tap the AI waiting badge,
**When** the tap is handled,
**Then** I am navigated to the waiting terminal session.

**Given** I tap "Open Terminal",
**When** the terminal view opens,
**Then** the most recently active terminal session fills the screen.

**Given** any interactive element is rendered on mobile,
**When** I inspect the tap target,
**Then** it is at minimum 44×44px.

**Given** the app renders on iOS Safari,
**When** the terminal or file tree is displayed,
**Then** `overscroll-behavior: none` prevents pull-to-refresh within those panels and terminal height uses `100dvh`.

**Given** the app renders on Android Chrome with the virtual keyboard open,
**When** the terminal is focused,
**Then** terminal height adjusts using `window.visualViewport` to remain visible above the keyboard.

**Given** any page is viewed on mobile,
**When** content renders,
**Then** no horizontal scrolling is required to see any content.

### Story 7.2: Settings — Account & Appearance

As an admin,
I want to change my password and switch between dark and light themes,
So that I can maintain my account security and tailor the visual experience.

**Acceptance Criteria:**

**Given** I navigate to Settings > Account,
**When** the panel renders,
**Then** I see a change-password form: Current Password, New Password, Confirm New Password, and "Update Password" button.

**Given** I submit with correct current password and valid new password (≥12 chars, matching confirm),
**When** the update completes,
**Then** a toast shows "Password updated" and the form clears.

**Given** I submit with an incorrect current password,
**When** the update fails,
**Then** an inline error "Current password is incorrect." is shown and no change is made.

**Given** I navigate to Settings > Appearance,
**When** the panel renders,
**Then** I see a radio group: Dark (default), Light, System — with the current selection pre-selected.

**Given** I select a different theme,
**When** the selection changes,
**Then** the theme switches immediately (no save button) and persists after refresh (stored in `/app/data`).

**Given** I select "System",
**When** the OS preference changes,
**Then** the theme switches automatically to match.

### Story 7.3: Update Detection

As an admin,
I want to see when a new version of Opus Command is available,
So that I know when to update my container using my existing Docker management tool.

**Acceptance Criteria:**

**Given** I navigate to Settings > Updates,
**When** the panel renders,
**Then** I see: current version as `vX.Y.Z` (from `package.json`, embedded at build time), a "Check for Updates" button, and static update instructions for Unraid / Docker Compose / Watchtower.

**Given** I click "Check for Updates",
**When** the request is in flight,
**Then** the button shows a spinner and is disabled.

**Given** a newer version is available,
**When** the check completes,
**Then** the panel shows "Update Available — Current: X.Y.Z → Latest: A.B.C" with a "[View on GitHub]" link (new tab).

**Given** the app is on the latest version,
**When** the check completes,
**Then** the panel shows "Up to date — vX.Y.Z".

**Given** the API request fails,
**When** the check completes,
**Then** the panel shows "Could not check for updates. Check your internet connection." and the button re-enables.

**Given** the Docker image is built via GitHub Actions on a tagged release,
**When** the app runs from that image,
**Then** the displayed version matches the git tag that triggered the build.

---

## Epic 8: Distribution & CI/CD

Application is packaged and published as a production-ready Docker image.

### Story 8.1: Dockerfiles & Docker Compose Reference

As an admin deploying Opus Command,
I want a production-ready Dockerfile and a reference Docker Compose configuration,
So that I can run the application on Unraid, Docker Compose, Portainer, or Watchtower with no custom scripts.

**Acceptance Criteria:**

**Given** the main app Dockerfile is built,
**When** the image runs,
**Then** it starts on port 3000, runs database migrations automatically, and is fully ready within 30 seconds.

**Given** the image runs with only the required volumes (`/app/data`, `/projects`) and socket (`/var/run/docker.sock`),
**When** the container starts,
**Then** all features work correctly with no other mounts or environment variables required.

**Given** `docker compose pull` followed by `docker compose up -d` is run with an updated image,
**When** the new container starts,
**Then** all user data (accounts, settings, projects, workspace metadata) is intact with no manual migration steps.

**Given** four workspace template Dockerfiles exist (General / Node.js / Python / PowerShell),
**When** each is built,
**Then** the resulting image includes the tools from PRD Appendix A and is published to GHCR as `ghcr.io/karlmit/opus-command-workspace-{template}:latest`.

**Given** the reference `docker-compose.yml` is published in the README,
**When** an Unraid, Portainer, or Watchtower user follows it,
**Then** no custom scripts or manual steps beyond standard Docker management are required.

### Story 8.2: GitHub Actions CI/CD Pipeline

As a maintainer,
I want the Docker image automatically built and published to GHCR on every push to main and every tagged release,
So that users always have access to the latest version with minimal effort.

**Acceptance Criteria:**

**Given** a commit is pushed to `main`,
**When** the GitHub Actions workflow runs,
**Then** the image is built, tagged as `ghcr.io/karlmit/opus-command:latest`, and pushed to GHCR.

**Given** a git tag matching `v*.*.*` is pushed,
**When** the workflow runs,
**Then** the image is tagged as both `:latest` and `:vX.Y.Z` and pushed to GHCR.

**Given** the build workflow runs,
**When** the image is built,
**Then** it targets both `linux/amd64` and `linux/arm64` using Docker Buildx.

**Given** the version tag is a git tag (e.g. `v1.0.0`),
**When** the image is built,
**Then** the version string is embedded in the app so Settings > Updates displays the correct current version.

**Given** the same workflow builds workspace template images,
**When** a release tag is pushed,
**Then** all four workspace template images are built and pushed to GHCR alongside the main app image.
