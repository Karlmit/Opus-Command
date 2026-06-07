---
title: PRD Quality Review — Opus Command v1
reviewer: Senior PM (AI)
date: 2026-06-07
verdict: CONCERN
---

# PRD Quality Review: Opus Command v1

## Gate Verdict

**CONCERN** — The PRD is well-structured and mostly precise, but three gaps are significant enough that an AI developer (Claude Code) will have to guess at critical implementation details, risking rework or insecure defaults.

---

## Findings

### 1. [CRITICAL] FR-AI-2: "Waiting-for-input state" is undefined

**Location:** FR-AI-2, FR-AI-7

FR-AI-7 says detection uses pattern matching against PTY output, stored in a configurable format. FR-AI-2 says the system detects when an agent enters a "waiting-for-input state." Neither requirement defines:
- What specific patterns trigger the waiting state for each supported agent (Claude Code, Codex CLI, OpenCode).
- What patterns signal the agent has *resumed* (i.e., how is the badge cleared)?
- Whether a false positive (pattern matched but agent not actually waiting) is an acceptable failure mode, or if debounce / confirmation logic is required.

Without a starter pattern set or a clear description of the detection signal, the developer must research each agent's output format independently, and any pattern set they choose will be untested and potentially wrong. This is the core differentiating feature of the product and cannot be left underspecified.

**Fix:** Add an appendix with at least one documented pattern per supported agent for both "enter waiting" and "resume/exit waiting" states. Specify that the pattern config includes both trigger and clear patterns.

---

### 2. [CRITICAL] FR-PROJ-2: Workspace container provisioning is underspecified

**Location:** FR-PROJ-2, FR-WORK-1, FR-WORK-5, FR-WORK-7, Appendix A

FR-PROJ-2 states the system "provisions a workspace container from the chosen template." Appendix A lists four templates with tool inventories, but the PRD never specifies:
- **Who builds these images?** Are the workspace template images pre-built and published to GHCR alongside the main app image, or does the app build them locally at project creation time?
- **Where do workspace images come from?** FR-DIST-1 only covers the main `opus-command` image. There is no mention of `opus-command-workspace-*` images.
- **FR-WORK-1 "Rebuild"** says "pull latest template image" — implying pre-built images exist — but no image name convention, registry location, or versioning strategy is defined.
- Claude Code and Codex CLI are listed as installed in every template. Both require API keys / authentication. How are these credentials injected into the container at runtime? (FR-WORK-5 mentions API keys live in the home volume, but the initial provisioning flow is silent on this.)

An AI developer cannot implement FR-PROJ-2 without knowing whether to write a Dockerfile per template, a build step, or a pull-and-run flow.

**Fix:** Add a section or appendix defining the workspace image strategy: image naming convention, build/publish pipeline ownership (main CI or separate), and the credential injection approach for AI agent CLIs.

---

### 3. [HIGH] FR-MOB: Mobile number out of sequence; FR-MOB-6 (editor) requirement is ambiguous

**Location:** FR-MOB-6, FR-MOB-7

Minor: The requirement IDs jump FR-MOB-5 → FR-MOB-7 → FR-MOB-6, which will create confusion in implementation tracking.

More importantly, FR-MOB-6 states: "The editor is accessible on mobile for viewing and minor edits; full editing experience is not required but must not be broken." This is ambiguous for an AI developer:
- "Must not be broken" — broken relative to what? The desktop editor? A read-only viewer?
- "Minor edits" — is there a line count or operation type that distinguishes minor from full?
- Does this mean the developer should *not* add a mobile-specific editor code path, or that they *should* degrade gracefully?

Without a clearer statement, the developer may either skip mobile editor testing entirely or over-engineer a mobile editor variant.

**Fix:** Rewrite as: "The editor renders and accepts text input on mobile. Features that require keyboard shortcuts (e.g., Ctrl+S) must have touch-accessible alternatives. Split-view and format operations are optional on mobile." Fix the ID numbering.

---

### 4. [HIGH] No acceptance criteria for AI notification delivery across devices

**Location:** FR-AI-3, FR-AI-4, FR-MOB-3

FR-AI-3 specifies a 5-second detection latency. FR-AI-4 specifies badge placement. FR-MOB-3 says notifications are "visible and functional on mobile." But there is no requirement covering:
- Whether the badge must appear on a *different device* from the one where the terminal session is open. (This is the primary motivating use case: agent waiting on PC, user notices on phone.)
- Whether the notification persists if the mobile browser is in the background or the screen is locked.
- Web Push / browser notification vs. in-app badge only — the PRD only specifies in-app badges. A user with their phone screen off will not see a badge.

For the stated goal ("on a phone, this is impractical [to poll]"), in-app badges alone are insufficient if the phone browser is not open. The PRD should either specify browser push notifications or explicitly call out that the notification only works while the app is open in the browser.

**Fix:** Add a requirement clarifying the notification delivery channel (in-app only vs. Web Push), and add an acceptance criterion: "Notification is visible on Device B within 5 seconds of the waiting state being detected, while the terminal session is open only on Device A."

---

### 5. [MEDIUM] FR-GIT-8: Snapshot restore is missing

**Location:** FR-GIT-8

FR-GIT-8 defines snapshot *creation* and states snapshots are "listed in a Snapshots panel." The section on scope calls out that snapshots provide "a safe restore point." But there is no requirement for snapshot *restoration* — no `git checkout <tag>` or `git reset --hard <tag>` operation.

A user can create a snapshot but cannot restore from it through the UI in V1, which makes the feature incomplete relative to its stated purpose ("covers all git-tracked files at that moment").

**Fix:** Either add FR-GIT-11 for snapshot restore (checkout or hard-reset to a snapshot tag, with confirmation), or explicitly state in FR-GIT-8 that restore is deferred to V2 and the user must use the terminal for it.

---

## Summary Table

| # | Finding | Dimension | Severity |
|---|---------|-----------|----------|
| 1 | AI waiting-state detection patterns undefined; no clear/resume signal specified | Testability / Ambiguity | Critical |
| 2 | Workspace image build/publish strategy undefined; credential injection not covered | Completeness | Critical |
| 3 | FR-MOB-6 editor mobile requirement ambiguous; ID numbering broken | Ambiguity | High |
| 4 | No acceptance criterion for cross-device notification delivery; push channel unspecified | Missing AC / Completeness | High |
| 5 | Snapshot restore operation absent; feature purpose (safe restore point) is undeliverable | Missing AC / Completeness | Medium |
