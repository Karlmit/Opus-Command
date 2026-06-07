---
title: Opus Command — Experience Spec
status: final
created: 2026-06-07
updated: 2026-06-07
sources:
  - ../../prds/prd-OpusCommand-2026-06-07/prd.md
  - DESIGN.md
---

# Opus Command — Experience Spec

This file defines the complete UI/UX behavior for Opus Command. It is authoritative for implementation. All decisions are final unless the PRD or DESIGN.md explicitly supersedes a detail.

Design token references use `{token.path}` syntax. Implement these as CSS custom properties or Tailwind config values that resolve to the named semantic value.

---

## 1. Foundation

### 1.1 Product Character

Opus Command is a **control surface**, not an IDE. Every interface decision biases toward information density, legibility under cognitive load, and fast access to the one thing the user needs right now — the terminal or the AI waiting badge.

The cockpit metaphor is literal: panels stay in place, status is always visible, nothing moves unexpectedly.

### 1.2 Design Tokens

All tokens are defined in DESIGN.md. Cross-referenced here using `{category.name}` syntax. Implementors must resolve each reference to its DESIGN.md value.

#### Colors

| Token | Role |
|-------|------|
| `{colors.background}` | Page background — deepest surface |
| `{colors.surface}` | Panel / card background |
| `{colors.surface-elevated}` | Active items, hover states, modals |
| `{colors.border}` | Hairline dividers between panels and sections |
| `{colors.accent}` | AI state signals — blue; **reserved exclusively for AI-related UI**; also used for focus rings and primary interactive CTAs |
| `{colors.text-primary}` | Default body text, active tab labels |
| `{colors.text-secondary}` | Supporting labels, metadata |
| `{colors.text-tertiary}` | Placeholder, inactive tabs, disabled state |
| `{colors.success}` | Running workspace status, clean git state |
| `{colors.warning}` | Starting workspace (pulse), modified file dot |
| `{colors.error}` | Error workspace status, conflicted file, destructive button |
| `{colors.danger}` | Destructive action buttons (delete, revert all) |

#### Typography

| Token | Role |
|-------|------|
| `{typography.sans}` | System UI sans-serif — all UI chrome, labels, body text |
| `{typography.mono}` | Monospace — terminal output, code editor, copy-path display, diff view, git hashes |
| `{typography.size.xs}` | 11px — status badges, file tree metadata |
| `{typography.size.sm}` | 13px — body, sidebar labels, tab labels |
| `{typography.size.base}` | 14px — default content size |
| `{typography.size.lg}` | 16px — section headings |
| `{typography.size.xl}` | 20px — project name, screen titles |
| `{typography.tracking.wide}` | Wide letter-spacing — section headings in uppercase (OPUS / COMMAND pattern) |
| `{typography.weight.normal}` | 400 |
| `{typography.weight.medium}` | 500 |
| `{typography.weight.semibold}` | 600 |

#### Spacing

| Token | Value |
|-------|-------|
| `{spacing.1}` | 4px |
| `{spacing.2}` | 8px |
| `{spacing.3}` | 12px |
| `{spacing.4}` | 16px |
| `{spacing.6}` | 24px |
| `{spacing.8}` | 32px |

#### Shape

| Token | Value |
|-------|-------|
| `{rounded.sm}` | 3px |
| `{rounded.md}` | 6px |
| `{rounded.lg}` | 10px |
| `{rounded.full}` | 9999px |

#### Motion

| Token | Value |
|-------|-------|
| `{motion.hover}` | 120ms ease |
| `{motion.press}` | 80ms |
| `{motion.pulse-duration}` | 2s ease-in-out |

---

## 2. Information Architecture

### 2.1 Screen Map

```
Login / First Run
└── Projects List
    └── Project Workspace (desktop cockpit)
        ├── Left Sidebar (nav + project switcher)
        ├── File Tree Panel
        ├── Main Area (editor tabs + terminal tabs)
        ├── Git / AI Panel (right panel or drawer)
        └── Status Bar (bottom strip)
    └── Project Status Card (mobile primary view)
        ├── Terminal View (full-screen)
        ├── File Browser (full-screen)
        └── Git Summary
Settings (account, appearance, updates, sound)
```

### 2.2 Desktop Screens

#### Login / First Run
- Auth gate. First startup with no existing `/app/data` triggers the first-run setup path — single form: username, password, confirm password.
- Subsequent visits show the standard login form.

#### Projects List
- Grid or list of project cards.
- Each card: project name, workspace status pill, active AI session badge (if any waiting), active terminal count.
- "New Project" button opens a creation modal.

#### Project Workspace — Cockpit Layout
Three-column layout:

| Column | Default Width | Collapsible |
|--------|--------------|-------------|
| Left Sidebar | 48px (icon rail) / 200px (expanded) | Yes — toggles between icon rail and expanded |
| File Tree Panel | 240px | Yes — collapses to zero; drag handle on right edge |
| Main Area | flex-grow | — |

The main area contains tabbed content: editor tabs and terminal tabs share the same tab bar. Git and AI status live in a right drawer or sidebar, accessible via sidebar nav icon.

**Status Bar** — fixed bottom strip, full width, height 24px:
- Left: workspace status pill + git branch + changed file count
- Right: AI session count (accent badge if any waiting) + terminal session count

#### Settings
- Four sections: Account, Appearance, Updates, Sound Notifications.
- Single-column scrollable within the main area.

### 2.3 Mobile Screens

#### Projects List
- Simplified vertical list of cards — same data as desktop, touch-friendly sizing.

#### Project Status Card
- Primary project view on mobile. Contains: workspace status pill, AI session count badge, git branch + changed file count, terminal count, "Open Terminal" primary button (full width).

#### Terminal View
- Full-screen, xterm.js instance. Session switcher accessible via bottom sheet or swipe.

#### File Browser
- Full-screen mode, accessible from bottom nav.

#### Settings
- Same sections as desktop, single-column.

### 2.4 Navigation

**Desktop** — Left sidebar with two states:

| State | Width | Contents |
|-------|-------|----------|
| Icon rail | 48px | Icon-only nav items + project switcher icon at top |
| Expanded | 200px | Icon + label; project name displayed at top |

Sidebar nav items (top to bottom): Files, Terminal, Git, Settings. Active item uses `{colors.accent}` left border.

Top bar (inside main area header): project name + workspace status pill.

**Mobile** — Bottom nav bar, 4 items: Dashboard | Terminal | Files | Git.
Each item: icon + label. Active item uses `{colors.accent}` color for icon and label.

---

## 3. Voice and Tone

### 3.1 Principles

- **Precise.** Status messages use exact values. Never vague: "3 files changed", "Running on port 3000", "Terminal 1". Not "some files changed" or "running".
- **Calm.** No exclamation marks in system-generated messages. Errors explain what happened and what to do next.
- **Technical.** Assumes the user understands git, Docker, and terminal workflows. No handholding copy.

### 3.2 Capitalization

- Section headings: **UPPERCASE with wide tracking** (`{typography.tracking.wide}`) — matching the OPUS / COMMAND logo pattern.
- Navigation labels: Title Case.
- Body content, status messages, file names: sentence case.
- Microcopy follows natural English sentence case unless it is a heading or label.

### 3.3 Approved Microcopy

| Context | Approved Text |
|---------|--------------|
| AI badge | "Waiting" |
| Workspace: running | "Running" |
| Workspace: starting | "Starting" |
| Workspace: stopped | "Stopped" |
| Workspace: error | "Error" |
| Snapshot action | "Create Snapshot" |
| Snapshot success toast | "Snapshot created — snapshot/2026-06-07-14-30-00" |
| Project delete confirmation | "Delete project? The project folder will not be deleted." |
| Revert all confirmation | "Revert all changes? This cannot be undone." |
| Revert file confirmation (inline) | "Revert changes to `filename`?" |
| Terminal reconnecting overlay | "Reconnecting…" |
| Unsaved editor changes | "Unsaved changes" (dot indicator on tab) |
| Auto-reconnect success | (silent — overlay disappears; no toast) |
| Update available | "Update Available — Current: X.Y.Z → Latest: A.B.C" |
| No update available | "Up to date — X.Y.Z" |
| Login rate limit | "Too many failed attempts. Try again in 15 minutes." |
| Empty terminal list | "No terminal sessions. Open a new terminal to start." |
| Empty snapshots list | "No snapshots. Create one before starting an AI session." |
| Empty git changes | "Working tree clean" |

### 3.4 Error Messages

Errors follow: **what happened** + **what to do**.

Examples:
- "Could not connect to workspace container. Check that Docker is running."
- "File save failed. Check that the file path is still valid."
- "Git operation failed: [raw error message from git]."

---

## 4. Component Patterns

### 4.1 Terminal Tab

**Anatomy:**
```
[session-icon] [session-name] [ai-badge?] [unread-dot?] [×]
```

- **session-name**: editable on double-click. Input appears inline; Enter confirms; Escape cancels. Default names: "Terminal 1", "Terminal 2", etc.
- **ai-badge**: `{colors.accent}` background, white text, label "Waiting". Visible only when agent waiting-state detected. Has pulse animation (`{motion.pulse-duration}` ease-in-out opacity 1→0.6→1). Clicking the badge navigates to this terminal and focuses it.
- **unread-dot**: small dot (`{colors.accent}`, 6px diameter) when tab has unread output and is not active. Disappears when tab is made active.
- **Close (×)**: visible on hover only. Clicking kills the terminal session (with inline confirm: click once to arm — button changes to "Kill?", click again to confirm).
- **Active tab**: `{colors.text-primary}`, 2px bottom border `{colors.accent}`, background `{colors.surface-elevated}`.
- **Inactive tab**: `{colors.text-tertiary}`, no border.
- **AI-detected (session is active AI, not waiting)**: subtle left border or tinted background using `{colors.accent}` at 15% opacity. Does not pulse.
- **Tab bar scroll**: horizontal scroll when tabs overflow. No wrap.

**ARIA:**
```html
role="tablist" on the tab bar container
role="tab" aria-selected="true/false" on each tab
role="tabpanel" on the terminal panel
aria-live="polite" on the ai-badge element
```

### 4.2 File Tree

**Anatomy:**
```
[expand-chevron?] [file-icon] [filename] [modified-dot?]
```

- **Indentation**: `{spacing.4}` (16px) per depth level. Root is at 0px.
- **Modified dot**: 6px circle, `{colors.warning}`, appears to the right of the filename for files with git status M (modified) or ? (untracked shown as dim).
- **File status colors**:
  - Modified (M): `{colors.warning}` dot
  - Untracked (?): `{colors.text-tertiary}` filename
  - Conflicted (C): `{colors.error}` filename
  - Staged: no tree indicator (shown in git panel only)
- **Active file**: row background `{colors.surface-elevated}`.
- **Hover**: row background `{colors.surface-elevated}`, transition `{motion.hover}`.
- **Context menu** (right-click): New File, New Folder, Rename, Delete, Copy Path. Appears at cursor position. Closes on click outside or Escape.
- **File tree refresh**: updates within 2 seconds when AI agent changes files (FR-FILE-7), via server-sent event or polling.
- **File search**: search input at top of file tree panel. Results filter tree in real time as user types (FR-FILE-3).

### 4.3 Git Panel

**Sections (in order):**
1. **Changes** — count badge showing total changed files. Subsections: Unstaged, Staged.
2. **Snapshots** — list of git tags with `snapshot/` prefix.

**Branch bar** — at the top of the git panel:
```
[branch-icon] [branch-name]  [N changes]
```
Branch name is `{typography.mono}`, `{typography.size.sm}`.

**File row (changes):**
```
[status-icon] [filename]  [revert-button on hover]
```
- **status-icon**: single character badge — M (modified), A (added), D (deleted), R (renamed), ? (untracked). Badge background: `{colors.surface-elevated}`, text `{colors.text-secondary}`.
- **filename**: `{typography.mono}`, `{typography.size.sm}`.
- **revert-button**: appears on row hover. Icon button (↩). For a single file: inline confirm — arm on first click, confirm on second click. Label changes: "Revert" → "Confirm?" (danger color). Does not open a modal.
- Clicking the filename opens the diff view.

**Diff view**: opens inline within the git panel (expanding the panel or pushing content down) or in the main area editor tab. Uses `{typography.mono}`. Added lines: `{colors.success}` background at 20% opacity. Removed lines: `{colors.error}` background at 20% opacity.

**Stage/unstage**: checkbox on each file row. Staging area shows staged files. Commit area appears below staged list when ≥1 file is staged: commit message textarea + "Commit" button.

**Snapshot row:**
```
[tag-name] [timestamp] [optional-label]  [Restore on hover]
```
- tag-name: `{typography.mono}`, `{typography.size.xs}`.
- timestamp: human-readable, e.g. "Today at 14:22" or "2026-06-07 14:22".
- "Restore" button on hover opens a confirmation modal (destructive action — see Section 6).

**Git panel auto-refresh**: max 3-second lag when working tree changes (FR-GIT-10).

### 4.4 Project Card (Projects List — Desktop)

```
[Project Name]                    [Status Pill]
[terminal-icon] N terminals  [ai-icon] N waiting / active
```

- Status pill: color-coded (success/warning/error/dim) with text "Running" / "Starting" / "Stopped" / "Error". "Starting" pill pulses (`{motion.pulse-duration}`).
- AI badge: `{colors.accent}` background, "N waiting" — only shown if ≥1 session waiting. Clicking the card opens the project and navigates to the waiting terminal.
- Card background: `{colors.surface}`, border `{colors.border}` 1px, `{rounded.lg}`.
- Hover: background `{colors.surface-elevated}`, transition `{motion.hover}`.

### 4.5 Project Status Card (Mobile)

Full-width card, vertically stacked:

```
[Project Name]
[Workspace Status Pill]
─────────────────────────────
[branch-icon] main · 7 changed
[terminal-icon] 2 terminals
[ai-icon] 1 waiting  ← accent badge, pulse animation
─────────────────────────────
[    Open Terminal    ]   ← primary button, full width
```

- "Open Terminal" button: `{colors.accent}` background, white text, `{rounded.md}`, full width, height 48px (satisfies 44px minimum touch target).
- If AI badge "1 waiting" is shown, tapping it navigates to the waiting terminal.
- Workspace status pill: "Starting" state includes pulse animation.

### 4.6 Workspace Status Pill

```
[colored-dot] [status-text]
```

- Dot diameter: 8px, color matches status.
- Text: `{typography.size.sm}`, `{typography.weight.medium}`.
- "Starting": dot pulses opacity 1→0.4→1 at `{motion.pulse-duration}` ease-in-out. Implemented in CSS only, no JS interval.
- Pill shape: `{rounded.full}`, padding `{spacing.1}` vertical `{spacing.2}` horizontal, background `{colors.surface-elevated}`.

### 4.7 AI Waiting Badge

Used in: project card, terminal tab, mobile status card.

- Background: `{colors.accent}`.
- Text: white, `{typography.size.xs}`, `{typography.weight.semibold}`.
- Shape: `{rounded.full}`, padding 2px `{spacing.2}`.
- Pulse: CSS `@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }`, animation 2s ease-in-out infinite.
- `aria-live="polite"` on the badge container so screen readers announce appearance.
- Clicking navigates to the relevant terminal session (FR-AI-6).

### 4.8 Toast Notifications

- Position: bottom-right, `{spacing.4}` from viewport edges.
- Stack: new toasts appear above previous ones.
- Width: fixed 320px.
- Shape: `{rounded.md}`, background `{colors.surface-elevated}`, border `{colors.border}` 1px, shadow.
- Auto-dismiss: 3 seconds for success/info toasts. Error toasts persist until explicitly dismissed (× button).
- Entrance animation: slide up from bottom + fade in, 150ms ease-out.
- Exit animation: fade out, 150ms ease-in.
- Max visible: 4. Fifth toast replaces oldest non-error toast.

### 4.9 Status Bar (Desktop)

Fixed bottom strip, 24px tall, background `{colors.surface}`, top border `{colors.border}` 1px.

Left section (in order):
1. Workspace status dot + text
2. `{colors.border}` vertical separator (1px, 12px tall)
3. Git branch name (`{typography.mono}`, `{typography.size.xs}`)
4. Changed file count (if >0: "· N changed")

Right section:
1. AI session count — if any waiting: accent badge "N waiting"; if all active but not waiting: "N active" in `{colors.text-secondary}`; if none: hidden
2. Terminal count: "N terminals"

### 4.10 Editor Tab

```
[file-icon] [filename][unsaved-dot?]  [×]
```

- **unsaved-dot**: `·` character appended after filename (not a graphic dot), `{colors.text-secondary}`.
- **Active tab**: `{colors.text-primary}`, bottom border 2px `{colors.accent}`.
- **Inactive tab**: `{colors.text-tertiary}`.
- Close (×): appears on hover. Navigating away with unsaved changes triggers confirmation: "Save changes to `filename`? [Save] [Discard] [Cancel]".
- Markdown files: toggle button in tab bar or toolbar — "Edit | Preview | Split" (FR-EDIT-3).
- Format button (JSON/YAML): visible in toolbar when file type is JSON or YAML (FR-EDIT-4).
- Save shortcut: Ctrl+S / Cmd+S (FR-EDIT-5).

### 4.11 New Project Modal

Three-step form within a modal:

1. **Project Name** — text input.
2. **Project Folder** — text input, path within `/projects`. Validated server-side for boundary.
3. **Workspace Template** — radio group: General Development | Node.js | Python | PowerShell.

Submit: "Create Project" button. Creates project record, provisions container, mounts volume (FR-PROJ-2). Loading state on submit button while provisioning. Success: modal closes, project card appears in list with "Starting" status.

---

## 5. State Patterns

### 5.1 State Table

| Surface | States | Visual Treatment |
|---------|--------|-----------------|
| Workspace container | Running | `{colors.success}` dot + "Running" |
| Workspace container | Starting | `{colors.warning}` dot (pulse) + "Starting" |
| Workspace container | Stopped | `{colors.text-tertiary}` dot + "Stopped" |
| Workspace container | Error | `{colors.error}` dot + "Error" |
| AI session | Active (not waiting) | `{colors.accent}` dot on terminal tab; subtle tint on tab background |
| AI session | Waiting for Input | `{colors.accent}` badge + pulse animation + optional sound |
| AI session | Idle / none | No indicator |
| Terminal tab | Normal | `{colors.text-tertiary}` label |
| Terminal tab | Active | `{colors.text-primary}`, 2px bottom border `{colors.accent}` |
| Terminal tab | AI-detected | `{colors.accent}` left border or 15% accent tint on background |
| Terminal tab | Unread output | 6px `{colors.accent}` dot, right side of tab |
| File in tree | Clean | `{colors.text-primary}` |
| File in tree | Modified | `{colors.warning}` dot after filename |
| File in tree | Untracked | `{colors.text-tertiary}` filename |
| File in tree | Conflicted | `{colors.error}` filename color |
| Editor tab | Saved | Normal label |
| Editor tab | Unsaved | `·` appended to filename, `{colors.text-secondary}` |
| Update available | Info | Version diff string in Settings; no urgency color; no badge on nav |
| Network reconnecting | Transient | "Reconnecting…" overlay on terminal, no user action required |

### 5.2 AI Session State Machine

```
         No Agent Running
               │
         Agent Detected (PTY pattern match)
               ▼
         Active (thinking / running)
          ─────────────────────────────
          • accent dot on tab
          • subtle tab tint
               │
         Waiting-state pattern matched
         + no new output for 1 second
               ▼
         Waiting for Input
          ─────────────────────────────
          • accent badge "Waiting"
          • pulse animation on badge
          • optional sound notification
          • aria-live announces
               │
         User types / new output appears
               ▼
         Active (resumes)
               │
         Agent session ends (process exits)
               ▼
         No Agent Running
```

### 5.3 Workspace Lifecycle Actions

Available from the workspace panel (accessible via sidebar nav → Settings or a dedicated Workspace section):

| Action | What it does | Destroys |
|--------|-------------|---------|
| Start | Starts stopped container | Nothing |
| Stop | Stops running container | Nothing |
| Restart | Stop + Start | Nothing |
| Recreate | Delete + recreate container from current image (no pull) | Container only; home volume preserved |
| Rebuild | Pull latest template image + recreate container | Container only; home volume preserved |
| Reset Environment | Wipe and recreate home volume | Home volume (`~`); project folder untouched |

Each action requires a confirmation modal (FR-WORK-2). Confirmation text explicitly states what is and is not destroyed.

---

## 6. Interaction Primitives

### 6.1 Hover

- Background surfaces: transition to `{colors.surface-elevated}`, duration `{motion.hover}` (120ms ease).
- Applied to: file tree rows, git file rows, project cards, sidebar nav items, terminal tabs.
- Do not apply hover state to already-active items.

### 6.2 Focus

- All interactive elements must show a visible focus ring when navigated via keyboard.
- Focus ring: 2px solid `{colors.accent}`, offset 2px from element boundary.
- Never suppress outline for keyboard users. `outline: none` is only acceptable when combined with a custom focus-visible replacement.
- Use `:focus-visible` pseudo-class to suppress focus ring on mouse click while preserving it for keyboard navigation.

### 6.3 Press / Active

- Buttons: scale-down to 0.97 on mousedown/touchstart. Duration `{motion.press}` (80ms). Returns to 1.0 on release.
- Do not apply scale to icon-only buttons smaller than 24px (visual distortion).

### 6.4 Panel Resize

- Drag handle: 4px wide strip between panels, invisible until hover. On hover: background `{colors.accent}` at 40% opacity.
- Cursor: `col-resize` for vertical handles, `row-resize` for horizontal handles (terminal panel height).
- File tree panel: collapsible via drag to zero width or via collapse button (chevron icon on handle). Minimum width when shown: 160px.
- Terminal panel: resizable vertically when shown below the editor. Minimum height: 120px.
- Drag state: no animation, follows cursor directly.

### 6.5 Terminal Reconnect

- On network disconnection: a semi-transparent overlay appears over the terminal area: "Reconnecting…" centered, no spinner (avoid implying progress where none is measurable).
- On successful reconnect: overlay disappears. Terminal session reattaches. No toast.
- On repeated failure (>5s): overlay changes to "Connection lost. Retrying…" and shows elapsed time.
- Session state (scrollback, PTY) is preserved server-side (FR-TERM-5). Reconnect restores terminal to its current state.

### 6.6 Confirmation Dialogs

Two patterns:

**Modal (destructive, irreversible):** Used for: delete project, restore snapshot, revert all changes, reset environment, rebuild, kill terminal session.
- Centered modal, `{rounded.lg}`, background `{colors.surface-elevated}`, backdrop `{colors.background}` at 60% opacity.
- Title: describes action. Body: explains consequence.
- Buttons: [Cancel] (secondary) + [Confirm / action name] (danger style: `{colors.danger}` background).
- Escape and click-outside cancels.

**Inline two-click (non-modal, reversible):** Used for: revert single file, close terminal tab.
- First click: button text changes to confirm phrase (e.g. "Kill?", "Revert?"), button color changes to `{colors.warning}`.
- Second click within 3 seconds: confirms action.
- If no second click within 3 seconds: resets to original state.
- Clicking elsewhere before second click cancels.

### 6.7 Drag-and-Drop (File Upload)

- Drop target: file tree panel.
- On drag-enter: panel gets a 2px `{colors.accent}` border overlay and a "Drop files to upload" label centered.
- On drop: files upload to the currently selected folder (or project root if no folder selected).
- Progress: individual file progress shown in a toast. Errors per file shown inline in a persistent error toast.

### 6.8 Context Menus

- Right-click on file tree node.
- Menu items: New File, New Folder, Rename, Delete, Copy Path.
- Appears at cursor position, positioned to avoid viewport overflow.
- Style: `{colors.surface-elevated}` background, `{colors.border}` border, `{rounded.md}`, shadow.
- Hover item: `{colors.surface}` background.
- Closes on: click outside, Escape, or item selection.

---

## 7. Accessibility Floor

### 7.1 Keyboard Navigation

- Every interactive element reachable via Tab / Shift+Tab.
- Tab order follows visual reading order (left to right, top to bottom within each region).
- Arrow keys navigate within composite components: tab bars (Left/Right), file tree (Up/Down/Right to expand/Left to collapse), context menus (Up/Down/Enter/Escape).
- Modal dialogs trap focus within the modal. Focus returns to triggering element on close.

### 7.2 Focus Visibility

- Focus ring always visible (see 6.2). Never hidden for keyboard users.
- Sufficient contrast between focus ring and background in all supported themes.

### 7.3 Color Independence

Color is never the sole signal. Every status state communicates through at least two channels:

| State | Color signal | Secondary signal |
|-------|-------------|-----------------|
| Workspace Running | `{colors.success}` | "Running" text label |
| Workspace Error | `{colors.error}` | "Error" text label + icon |
| AI Waiting | `{colors.accent}` | "Waiting" text label + pulse |
| File Modified | `{colors.warning}` | Dot icon after filename |
| File Conflicted | `{colors.error}` | "C" status badge |
| Unsaved editor | — | `·` character appended to filename |

### 7.4 ARIA

```html
<!-- Terminal tab bar -->
<div role="tablist" aria-label="Terminal sessions">
  <button role="tab" aria-selected="true" aria-controls="terminal-panel-1">Terminal 1</button>
  <!-- AI badge inside the tab: -->
  <span aria-live="polite" aria-atomic="true">Waiting</span>
</div>
<div role="tabpanel" id="terminal-panel-1">...</div>

<!-- Project status card AI badge -->
<div aria-live="polite" aria-atomic="true">1 waiting</div>

<!-- Workspace status pill -->
<span aria-label="Workspace status: Running">...</span>
```

- `aria-live="polite"` on AI waiting badges so screen readers announce state transitions without interrupting ongoing speech.
- Confirmation modals: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to the title.
- Context menus: `role="menu"`, items `role="menuitem"`.

### 7.5 Touch Targets (Mobile)

- Minimum touch target: 44×44px for all interactive elements.
- "Open Terminal" button: full width, 48px height.
- Bottom nav items: minimum 44px height.
- Terminal tab close (×): tap target 44×44px even if visual icon is smaller (use padding / pseudo-element).
- File tree rows: minimum 40px height on mobile (slightly relaxed for density; context menu access via long-press on mobile).

### 7.6 Contrast

- `{colors.text-primary}` on `{colors.background}` must meet WCAG AA (4.5:1) in dark mode.
- `{colors.text-secondary}` on `{colors.surface}` must meet WCAG AA (4.5:1).
- `{colors.text-tertiary}` used only for non-essential labels; does not need to meet AA.
- White text on `{colors.accent}` (AI badge, primary button) must meet WCAG AA.

---

## 8. Key Flows

### Flow 1 — Starting an AI Session (Desktop)

**Persona:** Karl at his desk. Primary device.

**Precondition:** Opus Command open in browser. BLAM project exists, workspace Running, git clean.

**Steps:**

1. Karl sees the Projects List. BLAM card shows green "Running" pill, no AI badge.
2. He clicks BLAM. The Project Workspace cockpit opens.
   - File Tree visible (240px panel).
   - Terminal 1 tab is visible in the main area tab bar.
   - Git panel shows: branch `main`, "Working tree clean".
3. Karl clicks "Create Snapshot" (button in git panel header).
   - System creates annotated git tag: `snapshot/2026-06-07-14-22-00`.
   - Toast appears: "Snapshot created — snapshot/2026-06-07-14-22-00" (3s auto-dismiss).
   - Snapshot appears immediately in the Snapshots section of the git panel.
4. Karl clicks Terminal 1 tab. The xterm.js terminal is focused.
5. He types `claude` and presses Enter. Claude Code starts.
   - Within the next PTY output cycle, the server detects an active AI session.
   - Terminal 1 tab gains a subtle `{colors.accent}` left border / tint (AI-detected state; no pulse yet).
6. Karl types his instruction to Claude Code and presses Enter. Claude Code begins working.
7. Claude Code finishes its reasoning and outputs: "Do you want to proceed? ❯ Yes / No"
   - Server detects the waiting-state pattern (line ends with approval prompt, no new output for 1 second).
   - Terminal 1 tab badge appears: `{colors.accent}` background, "Waiting", pulse animation.
   - If audio is enabled in Settings: notification sound plays.
   - Status bar AI count: "1 waiting" (accent badge).
8. Karl reads the plan in the terminal. Types `y`, presses Enter.
   - New output appears in the PTY within 1 second: waiting state clears.
   - "Waiting" badge disappears. Tab returns to AI-detected (active) state.
   - Status bar: "1 active" (`{colors.text-secondary}`, no badge).
9. Claude Code completes the task. Agent session ends (process exits).
   - Terminal tab loses AI indicator. Returns to normal state.
10. Karl clicks Git in the sidebar nav. Git panel shows changed files.
11. He clicks each file to review the diff inline.
12. He stages files, types a commit message, clicks "Commit".
    - Toast: "Committed — abc1234 Add feature X" (3s auto-dismiss).
    - Git panel refreshes: "Working tree clean".

### Flow 2 — Checking In from Phone

**Persona:** Karl away from his desk. Claude Code is waiting.

**Precondition:** Claude Code running on server in Terminal 1, has entered waiting state.

**Steps:**

1. Karl opens Opus Command on his phone (iOS Safari).
2. Projects List loads. BLAM card shows: green "Running" pill + `{colors.accent}` badge "1 waiting" (pulse animation).
3. Karl taps BLAM. Project Status Card opens:
   - Workspace: "Running"
   - AI: "1 waiting" (accent badge, pulse)
   - Git: "main · 7 changed"
   - Terminals: "2 terminals"
   - "Open Terminal" button (full width, 48px height, `{colors.accent}` background).
4. Karl taps "Open Terminal". Terminal View opens full-screen.
   - xterm.js fills the viewport minus the bottom nav bar.
   - Terminal 1 is shown (the waiting session is selected by default).
5. Karl reads Claude Code's prompt. Taps the terminal to focus.
   - Mobile keyboard appears.
6. Karl types `y` and submits.
   - PTY receives input. Claude Code continues.
   - Waiting badge disappears from the terminal tab (session switcher strip at top of terminal view).
7. Karl swipes up or taps "Sessions" to open the session switcher bottom sheet.
   - Terminal 1: active (AI-detected, no longer waiting).
   - Terminal 2: idle, no indicator.
8. Karl taps the back navigation to return to the Project Status Card.
   - AI badge is gone: status card shows "2 active" or no AI indicator.
   - Karl satisfied — no badge, work continuing.

### Flow 3 — Reverting to Snapshot

**Precondition:** AI session made unwanted changes. Snapshot `snapshot/2026-06-07-14-22-00` exists.

**Steps:**

1. Karl opens the Git panel. Sees many changed files.
2. He scrolls to the Snapshots section. Finds `snapshot/2026-06-07-14-22-00`.
3. He hovers the snapshot row. "Restore" button appears on the right.
4. He clicks "Restore".
5. Confirmation modal opens:
   - Title: "Restore Snapshot"
   - Body: "Revert all changes? This cannot be undone. All uncommitted changes will be overwritten with the state at snapshot/2026-06-07-14-22-00."
   - Buttons: [Cancel] [Restore] (danger style).
6. Karl clicks "Restore".
7. `git checkout snapshot/2026-06-07-14-22-00 -- .` executes inside the workspace container.
8. Toast: "Restored to snapshot/2026-06-07-14-22-00" (3s auto-dismiss).
9. Git panel refreshes: changed files list reflects the restored state (may still show some changes if snapshot was not at HEAD).
10. File tree refreshes within 2 seconds (FR-FILE-7).

### Flow 4 — First Run Setup

**Precondition:** Fresh container start, no `/app/data` existing.

**Steps:**

1. Browser navigates to `https://opus.jabba.se`. Server detects no admin account.
2. First-run setup screen renders (no login form, no nav):
   - Heading: "OPUS COMMAND" (wide tracking, `{typography.tracking.wide}`).
   - Subheading: "Create your admin account to get started." (sentence case).
   - Form: Username, Password, Confirm Password.
   - Submit: "Create Account".
3. Validation: passwords must match, minimum length 12 characters (bcrypt cost factor ≥12).
4. On success: admin account created, session established, redirect to Projects List (empty state).
5. Empty state: "No projects yet. Create your first project to get started." + "New Project" button.

---

## 9. Responsive and Platform

### 9.1 Desktop (≥1024px)

Layout: three-column cockpit.

```
┌──────────┬──────────────────┬────────────────────────────────────┐
│ Sidebar  │ File Tree        │ Main Area (tabs + content)         │
│ 48/200px │ 240px            │ flex-grow                          │
│          │                  │                                    │
│          │                  │                                    │
│          │                  │                                    │
├──────────┴──────────────────┴────────────────────────────────────┤
│ Status Bar (24px)                                                │
└──────────────────────────────────────────────────────────────────┘
```

- File tree and main area separated by drag-resizable handle.
- Sidebar toggles between 48px icon rail and 200px expanded via toggle button at bottom of sidebar.
- Git panel: slide-in right drawer, 320px wide, triggered from sidebar nav Git icon. Overlays the main area or pushes it (user preference / screen width).
- All three columns visible simultaneously when screen width ≥1280px. At 1024–1279px, git drawer always overlays.
- Terminal panel height resizable within main area when terminal is in split mode (editor above, terminal below).

### 9.2 Tablet (600px–1023px)

Two-column layout:

```
┌───────┬──────────────────────────────────────┐
│ Icon  │ Main Area                            │
│ Rail  │                                      │
│ 48px  │                                      │
│       │                                      │
├───────┴──────────────────────────────────────┤
│ Status Bar                                   │
└──────────────────────────────────────────────┘
```

- File tree collapses to a slide-over drawer (full height, 280px wide, swipe to dismiss).
- Terminal takes full main area height.
- Git panel: full-screen overlay drawer from left or right edge.
- Tab bar for editor and terminal tabs: horizontally scrollable.

### 9.3 Mobile (<600px)

Single-column, bottom nav:

```
┌──────────────────────────────┐
│ Page Content                 │
│ (Projects List, Status Card, │
│  Terminal, File Browser)     │
│                              │
├──────────────────────────────┤
│ Dashboard | Terminal | Files | Git │
└──────────────────────────────┘
```

- No sidebar. Navigation via bottom nav bar only.
- Bottom nav: 56px tall, 4 items, icons + labels.
- Project Status Card replaces the cockpit as the primary project view.
- Terminal: xterm.js fills viewport minus bottom nav (calc(100dvh - 56px)).
- File browser: full-screen when active.
- No panel resize affordances; panels are full-width and stacked.
- Session switcher: bottom sheet drawer (swipe up or tap "Sessions" button in terminal toolbar).
- Terminal toolbar: fixed strip above keyboard when terminal is focused. Contains: session name (tap to rename), paste button, keyboard toggle, session list button.

### 9.4 Platform-Specific Considerations

**iOS Safari:**
- Use `100dvh` (dynamic viewport height) for terminal height calculations to account for the browser chrome appearing/disappearing when scrolling.
- Disable browser pull-to-refresh within terminal and file tree panels (`overscroll-behavior: none`).
- Touch events: `touchstart` and `touchend` for press effect rather than `:active` pseudo-class (more responsive on iOS).

**Android Chrome:**
- Same `100dvh` approach for viewport height.
- The virtual keyboard does not resize the viewport in modern Android Chrome (uses visual viewport API). Use `window.visualViewport` for terminal height adjustments if needed.

**All Mobile:**
- Copy in terminal: `select to copy` behavior (long-press or drag) where possible via xterm.js. Explicit copy button in terminal toolbar as fallback.
- Paste: explicit paste button in terminal toolbar (clipboard API, requires permission prompt on first use).
- Pinch-to-zoom disabled within terminal panel (`touch-action: none`).

---

## 10. Settings Screens

### 10.1 Account

- Change password form: Current Password, New Password, Confirm New Password.
- Submit: "Update Password". Requires current password (FR-AUTH-8).
- Success: toast "Password updated".
- Error: inline form error "Current password is incorrect."

### 10.2 Appearance

- Theme picker: Dark (default), Light, System. Radio group.
- Changes apply immediately (no save button required for theme).
- No other appearance settings in V1.

### 10.3 Updates

- Current version: displayed as `v1.2.3`.
- "Check for Updates" button: triggers fetch from GitHub Releases API.
- Loading state: button shows spinner, disabled.
- Result (update available): "Update Available — Current: X.Y.Z → Latest: A.B.C" with link "[View on GitHub]" (opens new tab).
- Result (up to date): "Up to date — X.Y.Z".
- Result (error): "Could not check for updates. Check your internet connection."
- Update instructions: static text block explaining the Unraid / Docker Compose update workflow.

### 10.4 Sound Notifications

- Toggle: "AI session sound notifications" — off by default.
- When enabled: sound picker showing available built-in sounds (list TBD by implementation). Each option has a "Preview" button.
- Sound plays when an AI session enters the waiting state (FR-AI-5).
- Sound is scoped to: browser tab with the app open only (FR-AI-4).

---

## 11. Editor Behavior Detail

### 11.1 File Types

| File type | Opens in | Behavior |
|-----------|---------|---------|
| Text / code | Editor (CodeMirror) | Syntax highlighting, save, FR-EDIT-2 |
| Markdown | Editor + preview toggle | Edit / Preview / Split modes (FR-EDIT-3) |
| JSON | Editor | Format button pretty-prints (FR-EDIT-4) |
| YAML | Editor | Format button pretty-prints (FR-EDIT-4) |
| Image (PNG, JPG, GIF, SVG, WebP) | Image viewer | Centered, zoom controls, no editing (FR-EDIT-8) |
| Binary (unknown) | Error message | "This file cannot be displayed." |

### 11.2 Auto-Save

- Default: off. Configurable in Settings > (general preferences if added; otherwise in editor settings).
- When on: file saves after 2 seconds of no typing.
- Unsaved indicator clears immediately on save.
- When off: Ctrl+S / Cmd+S and explicit Save button are the only save triggers.

### 11.3 Navigation Away with Unsaved Changes

- Closing the editor tab: modal dialog — "Save changes to `filename`?" [Save] [Discard] [Cancel].
- Clicking another file in the file tree: same modal.
- Navigating to another panel (Terminal, Git, Settings): no prompt — editor tab remains open and dirty in the background. Prompt only when tab is explicitly closed.

---

## 12. Empty States

| Screen / Component | Empty State |
|-------------------|------------|
| Projects List | "No projects yet. Create your first project to get started." + "New Project" button |
| Terminal tab bar | "No terminal sessions. Open a new terminal to start." + "New Terminal" button |
| Git panel — Changes | "Working tree clean" |
| Git panel — Snapshots | "No snapshots. Create one before starting an AI session." |
| File search results | "No files match '…'" |
| Content search results | "No matches found for '…'" |
| Workspace logs | "No logs yet." |

---

## 13. Error States

| Scenario | Treatment |
|---------|----------|
| Login failed | Inline form error below password field: "Incorrect username or password." |
| Login rate limited | Inline form error: "Too many failed attempts. Try again in 15 minutes." |
| File load failed | Error message in editor pane: "Could not load file. [retry link]" |
| File save failed | Error toast (persistent): "File save failed. Check that the file path is still valid." |
| Git operation failed | Error toast (persistent): "Git operation failed: [raw git error message]." |
| Workspace container unreachable | Status bar workspace pill shows "Error". Error toast: "Could not connect to workspace container." |
| File outside project boundary | Error toast (persistent): "Access denied. The path is outside the project folder." |
| Upload failed | Error toast per file (persistent): "`filename` upload failed: [reason]." |
| Docker API error | Error toast (persistent): "Docker operation failed: [error message]." |

---

## 14. AI Agent Pattern Detection (UX Implications)

Patterns are stored in `/app/data/agent-patterns.json` (FR-AI-7). The UX implications:

- Detection is line-based: server checks last N lines of PTY scrollback.
- A 1-second silence after a trigger pattern is required before promoting to "Waiting" state (avoids false positives during rapid output).
- On detection: badge appears, sound plays (if enabled), aria-live announces.
- On clear: any new output line after user input clears the waiting state within 1 polling cycle.
- The pattern file is editable by the user (it is a JSON file in the data volume) without requiring a code change or restart.

**UX note:** The app does not confirm detection accuracy. If a false positive occurs, the badge appears and the user checks the terminal. This is acceptable: the cost of a false positive (user glances at terminal unnecessarily) is much lower than the cost of a missed notification (user misses an agent that is blocked waiting).

---

*End of EXPERIENCE.md — all decisions final.*
