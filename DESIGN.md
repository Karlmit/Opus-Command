---
name: Opus Command
description: An AI Development Control Plane — a dark-first, terminal-centric cockpit for directing AI agents.
colors:
  background: "#2B2D31"
  surface: "#313338"
  surface-elevated: "#383A40"
  surface-overlay: "#404249"
  border: "#FFFFFF14"
  border-strong: "#FFFFFF24"
  text-primary: "#F2F3F5"
  text-secondary: "#F2F3F599"
  text-tertiary: "#F2F3F561"
  text-dim: "#F2F3F538"
  accent: "#3B82F6"
  accent-hover: "#60A5FA"
  accent-subtle: "#3B82F61F"
  success: "#22C55E"
  warning: "#F59E0B"
  error: "#EF4444"
  terminal-bg: "#1E2024"
  terminal-text: "#E8EAED"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
  mono:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  2xl: "20px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "32px"
  3xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "#FFFFFF"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  button-danger:
    backgroundColor: "{colors.error}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.surface-elevated}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
  badge-status:
    backgroundColor: "{colors.success}"
    textColor: "{colors.success}"
    rounded: "{rounded.full}"
    padding: "0 6px"
    height: "18px"
---

# Design System: Opus Command

## 1. Overview

**Creative North Star: "The Calm Cockpit"**

Opus Command is dark-grade instrumentation you sit at for hours. At rest it is
quiet, dense, and almost monochrome — a near-black control surface where the
terminal and the active work are the only things asking for attention. Then a
workspace needs you, an agent goes idle waiting for input, a session reconnects —
and the surface lights up *precisely* at that one point. Nothing else moves. The
craft of this system is the gap between calm and signal: the calmer the resting
state, the louder a single accent dot reads when it appears.

This is product UI in service of a power user, not a brand to be admired. It earns
trust through familiarity: a Discord/Linear-class app shell (resizable project
sidebar, content main, persistent status bar), standard form controls, a
restrained type scale, and dense information where density is asked for. Personality
is not painted across surfaces — it is concentrated in the indicators and the
micro-interactions on the actions a user repeats all day. The accent belongs to the
*active theme*, not to one fixed brand color: the default dark theme signals in blue,
the Catppuccin themes in mauve. What stays constant is the rule, not the hue —
the accent always means "look here," "this is selected," or "something is happening."

This system explicitly rejects the cloud-IDE / cPanel kitchen sink (stacks of nested
panels, tabs inside tabs, chrome competing with the work) and the lifeless gray of
heavy enterprise admin dashboards. It is also not generic gradient-AI SaaS: no
purple gradients, no glassmorphism-by-default, no hero-metric template. Modern here
means craft and restraint, not a 2024 startup landing page.

**Key Characteristics:**
- Dark-first, low-chroma resting state, warmed by a soft ambient accent glow.
- **Soft & modern:** generously rounded panes, frosted-glass chrome floating over the ambient base, lifted work surfaces — see §4 for the three-layer system.
- One accent, theme-scoped, spent only on action / selection / focus / live state.
- Dense but legible: an 11–28px type scale, a 4px spacing grid, comfortable for long sessions.
- Multi-theme by architecture: every color is a token; six themes ship (default dark/light + four Catppuccin). The glass and ambient layers are theme-driven too.
- Motion is allowed to be fun, but always optional and never in the way; `prefers-reduced-motion` is honored.

## 2. Colors

A near-monochrome dark canvas with a single high-chroma accent and a tight set of
semantic status colors. Every value is a CSS custom property so themes swap wholesale.

### Primary
- **Signal Blue** (`#3B82F6`, hover `#60A5FA`): the *default theme's* accent. Reserved for primary action buttons, the current selection, focus rings, the AI-active badge, and live state. Not a decorative fill. In the Catppuccin themes this role is carried by **mauve** (`#cba6f7` / `#8839ef` / etc.) — same job, different hue. Subtle wash `accent-subtle` (`#3B82F61F`) backs focus glows and selected rows.

### Neutral
- **Cockpit Black** (`background` `#2B2D31`): the app body and the project sidebar. The resting field; the quietest surface.
- **Panel Slate** (`surface` `#313338`): cards, hovered list items, raised panels — one step up from the body.
- **Raised Slate** (`surface-elevated` `#383A40`) / **Overlay Slate** (`surface-overlay` `#404249`): inputs, menus, popovers — depth by tone, not shadow.
- **Hairline** (`border` `rgba(255,255,255,0.08)`, strong `0.14`): borders and dividers are translucent white, never a hard line.
- **Ink ramp** — Primary `#F2F3F5` (≈14:1 on the body), Secondary 60%, Tertiary 38%, Dim 22%. Primary and Secondary carry body and label copy; Tertiary is for de-emphasized meta; **Dim is decorative only — never body text.**
- **Terminal Black** (`terminal-bg` `#1E2024`, text `#E8EAED`): the xterm surface sits one shade darker than the app, framing the work as the deepest layer.

### Status (semantic, shared across components)
- **Running Green** (`#22C55E`), **Starting Amber** (`#F59E0B`), **Error Red** (`#EF4444`): used as a 60–88% text/dot color over a 12%-tint background of the same hue. Always paired with a glyph or dot, never color alone.

### Named Rules
**The Theme Signal Rule.** The accent is the active theme's accent token, not a fixed brand color. Spend it only where it means something — primary action, current selection, focus, live AI activity, loading, and small feedback motion. If the accent is decorating a surface that isn't interactive or active, it's wrong; pull it back so "lit" still reads as "happening."

**The Tonal Depth Rule.** *Inside* a surface, depth is built by stepping the slate ramp (`background → surface → surface-elevated → surface-overlay`) — a hovered row, a raised input, a nested panel read as lighter, not as floating. Structural elevation between the major layers is handled by glass and shadow instead (see §4).

**The No Color-Alone Rule.** Status is never conveyed by hue alone — every status color rides with a dot, glyph, or label so it survives color blindness and grayscale.

## 3. Typography

**Display / Body / Label Font:** Inter (with `ui-sans-serif, system-ui, sans-serif`)
**Mono Font:** JetBrains Mono (with `ui-monospace, monospace`) — also IBM Plex Mono available for terminal contexts.

**Character:** One humanist sans carries the entire UI — headings, labels, body, and data — for a calm, consistent voice; the monospace face is reserved for terminal output, code, paths, and anything the machine "says." The contrast axis is sans-vs-mono (human vs. machine), never two similar sans pairings.

### Hierarchy
- **Display** (600, 28px / `--font-size-2xl`, line-height 1.2, tracking -0.02em): page titles and the largest headings. A fixed rem-free scale — product UI, not fluid hero type. Ceiling is 36px (`3xl`); the system never shouts.
- **Headline** (600, 22px): section headers within a page.
- **Title** (600, 15px): card titles, panel headers, primary list-item labels.
- **Body** (400, 14px, line-height 1.5): the default. Prose capped at 65–75ch; dense tables and terminal lines may run longer.
- **Label** (600, 11px, tracking 0.04em, often UPPERCASE): section eyebrows like `.section-heading`, badge text, status chips.
- **Mono** (400, 14px): terminal, code, file paths, commit hashes.

### Named Rules
**The One-Family Rule.** Inter does all UI work; JetBrains Mono does all machine work. Do not introduce a third UI face or a display font — in a tool, a display font in a label is strangeness without purpose.

**The Fixed-Scale Rule.** Type sizes are fixed px steps, not `clamp()`. Users sit at consistent DPI; a heading that shrinks inside a narrow sidebar looks worse, not more responsive.

## 4. Elevation

Three deliberate layers, on every theme:

1. **Ambient base.** The app shell carries a soft, theme-accent radial glow
   (`.app-shell::before`, driven by `--ambient-strength`). It's the light source
   the glass refracts. Barely perceptible as color; essential as depth.
2. **Frosted chrome (glass).** Sidebar, tab strip, status bar, and side panels use
   the `.glass` recipe — `color-mix(... var(--color-surface) 66%, transparent)` plus
   `backdrop-filter: blur(20px) saturate(1.5)`. This is the deliberate brand
   material, used *only* on floating chrome over the ambient base. With graceful
   fallbacks: `@supports not (backdrop-filter)` and
   `prefers-reduced-transparency: reduce` both drop to a solid surface.
3. **Lifted work surfaces (soft shadow).** The terminal and the file editor are
   solid, soft-cornered panes that float on a real drop shadow
   (`0 14px 40px -18px rgba(0,0,0,.5)`) with an inner specular highlight
   (`inset 0 1px 0 rgba(255,255,255,.04)`). The shadow is what separates the work
   from the chrome.

Content *inside* surfaces still uses tonal layering (the slate ramp) for cheap,
flat depth. Shadow and glass are reserved for the structural layers above.

### Named Rules
**The Three-Layer Rule.** Ambient glow → frosted chrome → lifted work surface.
Every elevation decision maps to one of these three. Don't shadow a list row or
glassify a card; those are tonal-ramp jobs.

**The Purposeful-Glass Rule.** Glass is for floating chrome only (sidebar, tab
strip, status bar, side panels) — never content cards, never the terminal. It must
always have the ambient base behind it to refract, and must always degrade to a
solid surface when `backdrop-filter` or transparency is unavailable.

**The Hero-Shadow Rule.** Only the work surfaces (terminal, editor) carry a real
drop shadow, and they carry it on every theme — that shadow is how the work reads
as the subject. Chrome floats by blur, not by shadow.

## 5. Components

For each component, lead with the character, then the concrete spec and states.

### Buttons
Compact, confident, 32px tall — sized for dense toolbars and forms, not marketing CTAs.
- **Shape:** 8px radius (`--radius-md`). Press feedback: `transform: scale(0.97)` over 80ms.
- **Primary:** `accent` background, white text, 600 weight; hover → `accent-hover`. The only saturated button — one per context.
- **Ghost:** transparent with secondary text; hover reveals a `border-strong` hairline and lifts text to primary. The default for secondary actions.
- **Danger:** `error` background, white text, for destructive confirms only.
- **Disabled:** `opacity 0.5`, no press transform.

### Inputs / Fields
- **Style:** `surface-elevated` fill, 1px `border` hairline, 8px radius, 32px tall, placeholder at `text-tertiary` (verify ≥4.5:1 — tertiary is the floor for placeholder).
- **Focus:** border shifts to `accent` + a 3px `accent-subtle` glow ring (`box-shadow: 0 0 0 3px`). No outline jump.
- **Error:** border → `error`; message in `error` text at 12px below the field.

### Badges
The signal vocabulary — small, pill-shaped (`--radius-full`), 18px tall, 11px semibold.
- **AI badge** (`.badge-ai`): solid `accent` fill, white text, a slow 2s `pulse` opacity animation — the "an agent needs you" beacon.
- **Status badge** (`.badge-status`): 12%-tint background + matching status text + an 8px dot. `running` green, `starting` amber (pulsing dot), `stopped` neutral, `error` red.

### Navigation (Project Sidebar)
The signature surface. A resizable, collapsible left rail using the `.glass` recipe over the ambient base.
- **Item:** 12px radius (`--radius-lg`), hover → translucent surface wash. Active and AI states are marked by a **left pill indicator drawn with a `::before` pseudo-element** (full-radius accent bar), an inset accent ring, and a soft outer accent glow — never a `border-left` stripe. All accent/warning glows are theme-tokenized via `color-mix`.
- **AI-waiting item:** a `linear-gradient(90deg, warning-subtle, transparent 80%)` wash + amber `::before` pill — the row itself becomes the notification.
- **Collapsed state:** rail narrows to centered avatars/marks; status dots persist.
- **Mobile:** the sidebar is hidden; a dedicated bottom `MobileNav` + `MobileTerminalView` take over (viewing/steering, not full work).

### Status Bar
A persistent bottom strip across the app body — ambient context (connection, active session, counts) at `label`/`mono` scale, the cockpit's instrument readout.

## 6. Do's and Don'ts

### Do:
- **Do** spend the accent only on action, selection, focus, and live state. Keep the resting screen near-monochrome so a single lit dot reads loudly.
- **Do** map every elevation decision to one of the three layers (ambient glow → frosted chrome → lifted work surface); use the slate ramp for depth *inside* a surface.
- **Do** use the `.glass` recipe for floating chrome only (sidebar, tab strip, status bar, side panels), always over the ambient base, always with the solid-surface fallback.
- **Do** reserve real drop shadows for the work surfaces (terminal, editor) — they float on every theme so the work reads as the subject.
- **Do** keep every color a token. New surfaces must theme cleanly across all six themes (default dark/light + four Catppuccin); the ambient glow and glass tint are theme-driven too.
- **Do** pair every status color with a dot, glyph, or label.
- **Do** keep body text at `text-primary` or `text-secondary`; verify ≥4.5:1 (3:1 for ≥18px / bold) on whatever surface it sits.
- **Do** let micro-interactions be playful — pulse, glow, hover, loading shimmer — but route every one through a `prefers-reduced-motion: reduce` alternative (crossfade or instant).
- **Do** use Inter for UI and JetBrains Mono for machine output; keep the sans-vs-mono contrast.

### Don't:
- **Don't** build the cloud-IDE / cPanel kitchen sink — no nested panels, tabs-inside-tabs, or chrome competing with the terminal. Surface what the current task needs.
- **Don't** drift toward lifeless gray enterprise admin density. Familiar, yes; bureaucratic, never.
- **Don't** reach for gradient-AI SaaS tropes: no purple gradients, no big-number hero-metric template, no gradient text. (Glass *is* used here — but as deliberate chrome material per §4, never smeared on content cards.)
- **Don't** glassify content. The `.glass` recipe is for floating chrome only; cards, rows, the terminal, and the editor body are solid surfaces.
- **Don't** use a `border-left`/`border-right` colored stripe to mark active or alert states — use the `::before` pill, a background wash, an inset accent ring, or a leading dot (the sidebar already does this).
- **Don't** put body text on `text-dim` (22%) or use it for placeholders; it fails contrast. Dim is decorative only.
- **Don't** introduce a third UI font or a display face in labels.
- **Don't** let motion gate content visibility or demand attention; it conveys state and rewards repeated actions, nothing more.
