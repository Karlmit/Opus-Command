# Reconciliation: OpusCommand_ProjectSpec.md vs PRD

**Date:** 2026-06-07
**Source:** OpusCommand_ProjectSpec.md
**PRD:** prd.md (same directory)

---

## Summary

**Total gaps found: 7**

Six are missing requirements; one is a scoping/intent gap. None are purely architectural. All items below represent things the source document says the product *must do* or *must be* that are either absent or significantly weakened in the PRD.

---

## Gaps

### GAP-1 — Browser Push Notifications for AI Agent Alerts (MISSING)

**Source reference:** "AI Session Awareness > Notification methods: Browser notification"

**Status in PRD:** FR-AI-4 lists "badge on the project" and "badge on the relevant terminal session tab." FR-AI-5 covers optional audio. Browser push notifications (OS-level, receivable when the tab is in the background or on a phone with the browser closed) are **not mentioned anywhere** in the PRD.

**Why it matters:** The source document explicitly calls out browser notifications as a required notification method — distinct from in-app badges and audio. This is critical for the mobile use case (user on a phone, browser minimised, needs to know the agent is waiting).

---

### GAP-2 — File Editor "Split View" and "Diff View" as Nice-to-Haves (MISSING)

**Source reference:** "Editor > Nice to Have: Split View, Diff View, Ask AI About File, Explain File, Summarize File"

**Status in PRD:** The PRD omits all five "Nice to Have" editor features entirely. Even if deferred, the source document treats them as tracked desiderata, not out-of-scope. The PRD's out-of-scope section does not mention them.

**Why it matters:** These are product intent signals the PRD should acknowledge — either as V1 stretch goals, V2 backlog items, or explicit out-of-scope callouts. Their absence means they are invisible to anyone working from the PRD alone.

---

### GAP-3 — "Recreate" Workspace Lifecycle Action (MISSING)

**Source reference:** "Workspace Lifecycle: Start, Stop, Restart, Rebuild, **Recreate**, View Logs, View Health Status, Reset Environment"

**Status in PRD:** FR-WORK-1 lists: Start, Stop, Restart, Rebuild, Reset Environment. **"Recreate"** is absent. In Docker terminology, Rebuild (pull new image + recreate) and Recreate (recreate from same image without pulling) are distinct operations.

**Why it matters:** The source explicitly lists Recreate as a required lifecycle action separate from Rebuild. The PRD collapses or drops it without explanation.

---

### GAP-4 — "Persistent Config Volume" (in addition to Persistent Home Volume) (MISSING)

**Source reference:** "Workspace Lifecycle: Use: Persistent Home Volume, **Persistent Config Volume**, Workspace Metadata"

**Status in PRD:** FR-WORK-2 / FR-PROJ-2 / FR-WORK-5 only reference a persistent home volume (`~`). The source document specifically calls out a separate "Persistent Config Volume" as a mechanism for surviving container restarts. This may imply a second named volume or a distinct mount point for config-only data.

**Why it matters:** If this reflects a real design intent (separate volume for AI configs vs home data), it is a functional requirement for the workspace provisioning flow and Reset Environment behaviour.

---

### GAP-5 — Project List View Missing Fields vs Project Dashboard (WEAKENED)

**Source reference:** "Project Dashboard: Project Name, Workspace Status, Active AI Sessions, Active Terminal Sessions, Git Status, Changed Files, Recent Activity, Notifications"

**Status in PRD:** FR-PROJ-3 (project list view) only requires name, workspace status, active AI session count, active terminal session count. FR-PROJ-4 (project dashboard) covers most of the above. However, the source does not distinguish "list view" from "dashboard" — it calls everything the "Project Dashboard" and includes **Git Status** and **Changed Files** as dashboard-level items. FR-PROJ-3 omits git status and changed files from the list view, which may under-specify what is needed.

**Why it matters:** The source implies git status (clean/dirty + changed file count) should be visible without opening the full project — a meaningful UX distinction not reflected in the PRD's list view FR.

---

### GAP-6 — "Copy/Paste Support" Across All Platforms (WEAKENED)

**Source reference:** "Terminal System: Copy/Paste support" (listed as a top-level required feature)

**Status in PRD:** FR-TERM-7 says "Standard copy (select to copy or explicit copy button) and paste support across all platforms including mobile." This is covered in substance, but the source document's phrasing "Copy/Paste support" is listed as a standalone required item at the same level as persistent sessions — suggesting it warrants specific test coverage. The PRD's treatment is adequate but mobile paste is notoriously hard and the FR does not specify the expected mechanism for mobile paste (e.g., long-press, dedicated button).

**Severity:** Low — covered in spirit, but implementation detail for mobile paste is underspecified and likely to be dropped during dev.

---

### GAP-7 — "Session Switching" as an Explicit Mobile Requirement (MISSING)

**Source reference:** "Mobile Experience: Required: Session switching"

**Status in PRD:** FR-MOB-5 says "Navigation between major sections (projects, files, terminals, git) is accessible from a persistent mobile-friendly nav element." This covers section navigation, but the source's "Session switching" specifically refers to switching between **terminal sessions** on mobile — not just navigating between app sections. This is a distinct interaction not captured in FR-MOB.

**Why it matters:** Switching between named terminal sessions from a phone (especially when an AI agent is active in one of them) is a core mobile workflow. The PRD does not include a mobile-specific requirement for terminal session switching UX.

---

## Items Confirmed Covered

The following source document items were verified as present and adequately captured in the PRD:

- First-run admin setup (FR-AUTH-1)
- All security requirements: bcrypt, sessions, cookies, CSRF, rate limiting, no public signup, password change (FR-AUTH-3 through FR-AUTH-8)
- Project creation flow and auto-provisioning (FR-PROJ-1, FR-PROJ-2)
- File manager operations including folder tree, create/rename/delete/copy/move/upload/download/search/content search/copy path (FR-FILE-1 through FR-FILE-4)
- File type support (FR-FILE-5)
- Path traversal prevention (FR-FILE-6, FR-AUTH-10, NFR-4)
- Editor: syntax highlighting, markdown preview, JSON/YAML formatting, save, auto-save, unsaved changes warning, image viewer (FR-EDIT-1 through FR-EDIT-8)
- Terminal: multiple named persistent sessions, server-side ownership, reconnect, scrollback, mobile UI, hide/show, resize (FR-TERM-1 through FR-TERM-12)
- AI agent detection, waiting-for-input state, 5-second notification, badges, audio toggle, pattern config (FR-AI-1 through FR-AI-8)
- Git: status, branch, changed files, diff, revert file, revert all, commit, create branch, snapshot (FR-GIT-1 through FR-GIT-10)
- Workspace lifecycle: start/stop/restart/rebuild/reset, logs, health, home volume persistence (FR-WORK-1 through FR-WORK-7)
- Mobile: responsive layout, file browsing/viewing, terminal access, notifications (FR-MOB-1 through FR-MOB-6)
- Update detection panel (FR-UPD-1 through FR-UPD-5)
- Distribution: GHCR image, GitHub Actions CI, port 3000, Docker Compose reference, data volume, schema migrations (FR-DIST-1 through FR-DIST-7)
- All workspace templates: General, Node.js, Python, PowerShell (Appendix A)
- Future features correctly placed in out-of-scope (Section 4)
- Opus Connector noted as follow-on (Section 10)

---

## Recommended PRD Actions

| Gap | Action |
|-----|--------|
| GAP-1 | Add FR-AI-9: "Browser push notification when agent enters waiting-for-input state; configurable on/off; functions when the browser tab is backgrounded." |
| GAP-2 | Add a backlog/stretch row in the editor section for Split View, Diff View, Ask AI About File, Explain File, Summarize File — or add to out-of-scope list. |
| GAP-3 | Add "Recreate" to FR-WORK-1 lifecycle actions with a note clarifying it differs from Rebuild (no image pull, same image version). |
| GAP-4 | Clarify whether Persistent Config Volume is a separate Docker volume or an alias for the home volume. If separate, add to FR-PROJ-2 provisioning flow and FR-WORK-1 Reset Environment description. |
| GAP-5 | Add git status (clean/dirty, changed file count) to FR-PROJ-3 project list view fields. |
| GAP-6 | Extend FR-TERM-7 to specify the expected mobile paste mechanism (e.g., explicit paste button in terminal toolbar). |
| GAP-7 | Add FR-MOB-7: "On mobile, the user can switch between named terminal sessions with a single tap from a persistent terminal session selector." |
