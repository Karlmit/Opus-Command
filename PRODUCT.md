# Product

## Register

product

## Users

Solo developers and small-team power users who **direct AI agents** rather than
hand-write every line. They run Claude Code, Codex, and OpenCode inside isolated,
reproducible workspaces and manage everything — files, terminals, connectors, git
safety — from one control plane instead of a traditional IDE.

Their context:

- **Primary surface is desktop**, in long, focused sessions. This is a tool they
  live in for hours, often with a terminal in front of them the whole time.
- **Mobile/tablet is for viewing and light steering**, not real work — checking
  whether an agent is waiting, glancing at output, reconnecting to a session.
  Touch ergonomics are a nice-to-have, not the governing constraint.
- They are technically fluent. They expect keyboard-first operation, density when
  they ask for it, and tools that respect their attention.

The job to be done: **keep many AI-driven projects moving without losing state or
context** — spin up isolated workspaces, watch which agents need input, and stay
in flow across devices.

## Product Purpose

Opus Command is an **AI Development Control Plane**. It gives every project its own
isolated, reproducible workspace (Docker by default, optional Unraid LXC backend)
and manages them from a single interface on any device. It is the control plane,
not the development machine — infrastructure *around* Claude Code and Codex, not a
replacement for them.

It is built around three ideas:

- **No tmux** — PTY sessions live on the server (in a `terminal-agent` inside the
  workspace) and survive browser refreshes and app restarts. Reconnect from
  anywhere without losing anything.
- **AI agent awareness** — the app watches PTY output and badges you when an agent
  is waiting for input, so you don't poll terminals manually.
- **Git safety** — snapshot before every AI session, review the diff, revert files
  or everything, and commit, all without leaving the app.

Success looks like: a developer running several agent-driven projects in parallel,
never losing a session, always knowing which workspace needs them next, and
trusting the tool enough that it disappears into the work.

## Brand Personality

**Sleek, modern, and quietly playful.** Polished and friendly like the best
self-hosted SaaS, but with the confidence of a power tool. Three words:
**polished, confident, alive.**

- The baseline is calm and dense: a dark-first control plane that's comfortable to
  stare at for hours. Restraint is the default so the terminal and the work stay
  the center of attention.
- Personality lives in **micro-interactions and moments**, not in chrome. Tasteful
  motion, satisfying state transitions, small touches of delight on the actions
  users repeat — never decoration that gets in the way of the task.
- Voice is direct and technical without being cold. It assumes competence, skips
  hand-holding, and never talks down to the user.

It should feel like a tool a developer *chose*, not one an org imposed.

## Anti-references

- **Cloud-IDE / cPanel clutter.** No kitchen-sink density: stacks of nested panels,
  tabs inside tabs, overwhelming chrome competing for attention. Opus Command is a
  control plane, not a second IDE. Surface what's needed for the current task.
- **Heavy enterprise / IBM-style admin.** No dense gray corporate dashboards,
  cluttered toolbars, or dated admin-panel aesthetics. Familiar, yes; lifeless and
  bureaucratic, never.
- (Implicit, from the personality above) avoid the generic gradient-AI-SaaS look —
  purple gradients, glassmorphism, hero-metric cards. "Modern SaaS" here means
  craft and polish, not the 2024 startup template.

## Design Principles

1. **The tool disappears into the task.** The terminal and the active work are the
   subject; the UI is the frame. When in doubt, get out of the way.
2. **Calm by default, alive in the moments.** Dense and restrained for the long
   session; personality and delight concentrated in the interactions users repeat,
   never smeared across every surface.
3. **Keyboard-first, long-session comfort.** Designed to be operated without the
   mouse and stared at for hours. Readability and reach beat decoration.
4. **Earned familiarity over novelty.** Standard affordances for standard tasks
   (nav, forms, modals, tables). Surprise is a liability in a tool people trust
   with their work; spend it only where it pays.
5. **Desktop is the workbench, mobile is the window.** Optimize the full workflow
   for desktop; make mobile excellent for viewing and steering without pretending
   it's where the work happens.

## Accessibility & Inclusion

- **Target WCAG 2.1 AA** for contrast and readability across all themes (the
  default dark, the light theme, and the Catppuccin set). Body text ≥4.5:1, large
  text ≥3:1 — verify on tinted surfaces, which is where dense dark UIs slip.
- **Keyboard-first.** Every core workflow is fully operable from the keyboard, with
  clear, visible focus states (the existing `:focus-visible` accent ring is the
  baseline).
- **Motion is allowed to be fun, but never required and never in the way.** Honor
  `prefers-reduced-motion: reduce` everywhere — every animation needs a calm
  alternative (crossfade or instant). Motion should convey state and reward
  repeated actions, not gate content or demand attention.
- **Long-session comfort is an accessibility goal**, not just an aesthetic one:
  comfortable contrast, no harsh flashing, readable mono and sans at working sizes.
- Mobile/touch ergonomics are a nice-to-have for the viewing/steering use case, not
  a strict requirement for the full workflow.
