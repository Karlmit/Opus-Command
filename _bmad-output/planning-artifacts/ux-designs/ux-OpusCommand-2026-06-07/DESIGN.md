---
title: Opus Command — Design System
status: final
created: 2026-06-07
updated: 2026-06-07
sources:
  - ../../prds/prd-OpusCommand-2026-06-07/prd.md

tokens:
  color:
    dark:
      background: "#2B2D31"
      surface: "#313338"
      surface-elevated: "#383A40"
      surface-overlay: "#404249"
      border: "rgba(255,255,255,0.08)"
      border-strong: "rgba(255,255,255,0.14)"
      text-primary: "#F2F3F5"
      text-secondary: "rgba(242,243,245,0.60)"
      text-tertiary: "rgba(242,243,245,0.38)"
      text-dim: "rgba(242,243,245,0.22)"
      accent: "#3B82F6"
      accent-hover: "#60A5FA"
      accent-subtle: "rgba(59,130,246,0.12)"
      success: "#22C55E"
      success-subtle: "rgba(34,197,94,0.12)"
      warning: "#F59E0B"
      warning-subtle: "rgba(245,158,11,0.12)"
      error: "#EF4444"
      error-subtle: "rgba(239,68,68,0.12)"
      terminal-bg: "#1E2024"
      terminal-text: "#E8EAED"
      terminal-cursor: "#3B82F6"
      terminal-selection: "rgba(59,130,246,0.30)"
    light:
      background: "#F5F5F6"
      surface: "#FFFFFF"
      surface-elevated: "#FFFFFF"
      surface-overlay: "#F0F0F2"
      border: "rgba(0,0,0,0.08)"
      border-strong: "rgba(0,0,0,0.14)"
      text-primary: "#0D0D0E"
      text-secondary: "rgba(13,13,14,0.60)"
      text-tertiary: "rgba(13,13,14,0.38)"
      text-dim: "rgba(13,13,14,0.22)"
      accent: "#3B82F6"
      accent-hover: "#60A5FA"
      accent-subtle: "rgba(59,130,246,0.12)"
      success: "#22C55E"
      success-subtle: "rgba(34,197,94,0.12)"
      warning: "#F59E0B"
      warning-subtle: "rgba(245,158,11,0.12)"
      error: "#EF4444"
      error-subtle: "rgba(239,68,68,0.12)"
      terminal-bg: "#1E2024"
      terminal-text: "#E8EAED"
      terminal-cursor: "#3B82F6"
      terminal-selection: "rgba(59,130,246,0.30)"

  font:
    family:
      sans: "'Geist', 'Inter', ui-sans-serif, sans-serif"
      mono: "'Geist Mono', 'JetBrains Mono', ui-monospace, monospace"
    size:
      xs: "11px"
      sm: "12px"
      base: "14px"
      md: "15px"
      lg: "18px"
      xl: "22px"
      2xl: "28px"
      3xl: "36px"
    weight:
      regular: 400
      medium: 500
      semibold: 600
    leading:
      tight: 1.2
      normal: 1.5
    tracking:
      tight: "-0.02em"
      normal: "0em"
      wide: "0.04em"
      wider: "0.08em"

  radius:
    sm: "4px"
    md: "8px"
    lg: "12px"
    xl: "16px"
    full: "9999px"

  spacing:
    xs: "4px"
    sm: "8px"
    md: "12px"
    lg: "16px"
    xl: "24px"
    2xl: "32px"
    3xl: "48px"

  component:
    button:
      height: "32px"
      padding: "0 12px"
      radius: "md"
      font-size: "sm"
      font-weight: "medium"
    input:
      height: "32px"
      padding: "0 10px"
      radius: "md"
    badge-ai:
      height: "18px"
      padding: "0 6px"
      radius: "full"
      font-size: "xs"
      font-weight: "semibold"
    badge-status:
      height: "18px"
      padding: "0 6px"
      radius: "full"
      font-size: "xs"
      font-weight: "semibold"
    panel:
      radius: "lg"
      border: "1px solid border"
    tab:
      height: "36px"
      padding: "0 12px"
      font-size: "sm"
---

# Opus Command — Design System

## Brand & Style

**Product:** Opus Command is a self-hosted Docker web app and AI project cockpit. It is a command center — not a dashboard, not a chat client. Every visual decision reinforces that framing: dense, precise, purposeful.

**Voice:** Precise. Technical. Calm. The UI never draws attention to itself. There is no decoration. Every element earns its place by conveying state, structure, or action. Playfulness is absent by design. The product communicates the way a well-engineered terminal does — through clarity, not charm.

**Design direction:** Dense Command Center. Tight information density. Hairline dividers. Monospace only in terminal zones. Accent blue is reserved exclusively as a live AI state signal — not a brand decoration, not a hover highlight on arbitrary elements. Visual hierarchy is achieved entirely through opacity layering: text reads at 1.0 → 0.60 → 0.38 → 0.22, surface stacks from background up through surface, surface-elevated, and surface-overlay.

**The mark:** A central white circle surrounded by orbital arcs, with satellite nodes connected by lines. One node is blue — the AI agent signal. The mark is the product's metaphor made literal: a command center with one active agent in orbit. The mark is never used as decoration. It appears at application load and in the wordmark lockup.

**Wordmark:** "OPUS" and "COMMAND" set in Inter (baked into the SVG), uppercase, tracking `wider` (0.08em). The wordmark is always rendered from the SVG asset — never typeset in HTML. The logo font is Inter; the app UI font is Geist. These are distinct and must not be swapped.

**Theme system:** Obsidian-style installable themes. The two base themes are `dark` (default) and `light`. Themes may override accent color and surface tones. The terminal background (`#1E2024`) is invariant — terminals are always dark regardless of active theme.

---

## Colors

### Dark mode (default)

| Token | Value | Usage |
|---|---|---|
| `background` | `#2B2D31` | App chrome background; Discord-like warm dark, not OLED black |
| `surface` | `#313338` | Primary content panels, sidebars |
| `surface-elevated` | `#383A40` | Cards, inputs, raised elements |
| `surface-overlay` | `#404249` | Dropdowns, tooltips, popovers |
| `border` | `rgba(255,255,255,0.08)` | Default hairline dividers and panel borders |
| `border-strong` | `rgba(255,255,255,0.14)` | Emphasized borders, active panel edges |
| `text-primary` | `#F2F3F5` | Body text, headings, labels — full opacity |
| `text-secondary` | `rgba(242,243,245,0.60)` | Supporting text, descriptions, inactive labels |
| `text-tertiary` | `rgba(242,243,245,0.38)` | Placeholder text, metadata, disabled state |
| `text-dim` | `rgba(242,243,245,0.22)` | Decorative marks, inactive tab text, ghost elements |
| `accent` | `#3B82F6` | AI signal only — live agent state, terminal cursor, AI badge |
| `accent-hover` | `#60A5FA` | Hover state on accent-colored interactive elements |
| `accent-subtle` | `rgba(59,130,246,0.12)` | AI badge background, focus ring fill |
| `success` | `#22C55E` | Completed, connected, passing states |
| `success-subtle` | `rgba(34,197,94,0.12)` | Success badge background |
| `warning` | `#F59E0B` | Degraded, queued, needs-attention states |
| `warning-subtle` | `rgba(245,158,11,0.12)` | Warning badge background |
| `error` | `#EF4444` | Failed, disconnected, destructive action states |
| `error-subtle` | `rgba(239,68,68,0.12)` | Error badge background |
| `terminal-bg` | `#1E2024` | Terminal surface — always this value, never overridden by theme |
| `terminal-text` | `#E8EAED` | Terminal output text |
| `terminal-cursor` | `#3B82F6` | Terminal block cursor — uses accent to signal agent presence |
| `terminal-selection` | `rgba(59,130,246,0.30)` | Terminal text selection highlight |

### Light mode

Surface tokens shift to white and near-white. In light mode, `surface-elevated` is the same hex as `surface` (`#FFFFFF`) and is differentiated from `surface` solely by shadow, not color — do not attempt to create visual separation by changing the background color. All semantic colors (accent, success, warning, error) are identical to dark mode. All terminal colors are identical to dark mode — terminals are always dark.

| Token | Value |
|---|---|
| `background` | `#F5F5F6` |
| `surface` | `#FFFFFF` |
| `surface-elevated` | `#FFFFFF` |
| `surface-overlay` | `#F0F0F2` |
| `border` | `rgba(0,0,0,0.08)` |
| `border-strong` | `rgba(0,0,0,0.14)` |
| `text-primary` | `#0D0D0E` |
| `text-secondary` | `rgba(13,13,14,0.60)` |
| `text-tertiary` | `rgba(13,13,14,0.38)` |
| `text-dim` | `rgba(13,13,14,0.22)` |

### Accent color semantics

Accent blue (`#3B82F6`) is a **signal color, not a brand color**. It appears only where an AI agent is actively present or waiting: the terminal cursor, the AI waiting badge, focus rings on AI-related inputs, and the single blue node in the product mark. Applying accent to decorative elements, hover states on non-AI controls, or arbitrary interactive elements is an error.

---

## Typography

**Font stacks:**

- `sans`: `'Geist', 'Inter', ui-sans-serif, sans-serif` — used for all application UI: navigation, labels, headings, body text, status displays.
- `mono`: `'Geist Mono', 'JetBrains Mono', ui-monospace, monospace` — used exclusively in terminal output areas and code blocks. Never in navigation, labels, badges, status text, or any structural UI element.

**Type scale:**

| Token | Size | Typical use |
|---|---|---|
| `xs` | 11px | Badges, chips, timestamps, micro-labels |
| `sm` | 12px | UI labels, tab text, button text, secondary metadata |
| `base` | 14px | Body text, descriptions, panel content |
| `md` | 15px | Emphasized body, primary navigation items |
| `lg` | 18px | Section headings |
| `xl` | 22px | Page-level headings |
| `2xl` | 28px | Display headings |
| `3xl` | 36px | Hero / splash use only |

**Weights:**

| Token | Value | Use |
|---|---|---|
| `regular` | 400 | Body text, descriptions |
| `medium` | 500 | Buttons, active labels, navigation |
| `semibold` | 600 | Headings, badge text, strong labels |

**Line height:**

- `tight` (1.2): Headings, single-line UI labels, badges
- `normal` (1.5): Multi-line body text, descriptions, terminal output

**Tracking:**

- `tight` (-0.02em): Headings — pulls characters together at display sizes
- `normal` (0em): Body text — no adjustment
- `wide` (0.04em): UI labels, navigation items — adds air for readability at small sizes
- `wider` (0.08em): Uppercase marks only — used in the "OPUS COMMAND" wordmark SVG; not used in application HTML

---

## Layout & Spacing

**Base unit:** 4px. All spacing values are multiples of 4.

| Token | Value | Use |
|---|---|---|
| `xs` | 4px | Icon padding, tight inline gaps |
| `sm` | 8px | Component internal padding, gap between badge and text |
| `md` | 12px | Standard component padding, gap between sibling elements |
| `lg` | 16px | Panel internal padding, section gaps |
| `xl` | 24px | Between major sections, primary content margins |
| `2xl` | 32px | Page-level section separators |
| `3xl` | 48px | Hero spacing, large structural gaps |

**App shell:** Three-column: narrow icon rail (left) + resizable sidebar + main content area. A bottom panel (terminal zone) expands from the main content area. All panes are separated by hairline borders using `border` token. No gutters between panes — divisions are structural, not decorative.

**Information density:** Dense by default. Line heights, padding, and margins are tuned to maximize content per viewport. This is a command center, not a reading app. Components use the minimum padding needed for click-target legibility (32px tall controls). Do not inflate spacing to add "breathing room" — use hierarchy instead.

---

## Elevation & Depth

Opus Command uses two elevation mechanisms, applied per theme:

**Dark mode — background color shift:**
Depth is expressed by stepping up the surface token stack. Lower = darker = further back.

| Level | Token | Value |
|---|---|---|
| 0 (chrome) | `background` | `#2B2D31` |
| 1 (panel) | `surface` | `#313338` |
| 2 (card/input) | `surface-elevated` | `#383A40` |
| 3 (overlay) | `surface-overlay` | `#404249` |

No box shadows in dark mode. Depth is purely colorimetric.

**Light mode — shadow:**
`surface` and `surface-elevated` share the same hex (`#FFFFFF`). Elevation is expressed by box shadow alone:

- Level 1 (panels): `0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)`
- Level 2 (cards, modals): `0 4px 12px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)`
- Level 3 (overlays/dropdowns): `0 8px 24px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08)`

**Borders:** Panels always have a `1px solid` border using the `border` token regardless of theme. Borders define structure; shadows define elevation. They are not interchangeable.

---

## Shapes

Opus Command uses soft corners throughout. There are no sharp (0px) corners in the UI. There are no fully rounded containers (pill-shaped panels). The shape language is consistently rounded-but-controlled.

| Token | Value | Applied to |
|---|---|---|
| `sm` | 4px | Badges, chips, small inline tags |
| `md` | 8px | Buttons, inputs, tabs, dropdowns |
| `lg` | 12px | Panels, cards, content containers |
| `xl` | 16px | Modals, dialogs, drawers |
| `full` | 9999px | Avatars, pill badges (AI signal badge, status pill) |

Shape tokens are not used interchangeably. A button is always `md`. A panel is always `lg`. A modal is always `xl`. A badge is `full` for status/AI indicators and `sm` for inline code or category chips. Do not apply `lg` to buttons to make them look "friendlier" — the density contract requires consistency.

---

## Components

### Button

| Property | Value |
|---|---|
| Height | 32px |
| Padding | 0 12px |
| Border radius | `md` (8px) |
| Font size | `sm` (12px) |
| Font weight | `medium` (500) |
| Line height | `tight` (1.2) |

**Variants:**

- **Primary:** Background `accent`, text white. Hover: background `accent-hover`. Used for the single most important action in a view. One per visible context.
- **Ghost:** Background transparent, text `text-secondary`, no border at rest. On hover: border `1px solid border-strong`, text `text-primary`. Used for secondary and tertiary actions.
- **Danger:** Background `error`, text white. Hover: `error` at 90% opacity. Used for destructive actions (delete, disconnect, kill process). Always requires confirmation.

All buttons use the same height and radius. Icon-only buttons are 32×32px, same radius.

### Input

| Property | Value |
|---|---|
| Height | 32px |
| Padding | 0 10px |
| Border radius | `md` (8px) |
| Font size | `base` (14px) |
| Font weight | `regular` (400) |
| Background | `surface-elevated` |
| Border | `1px solid border` |
| Focus border | `1px solid accent` |
| Focus ring | `0 0 0 3px accent-subtle` |

Placeholder text uses `text-tertiary`. Disabled inputs use `text-dim` text and `surface` background (not elevated). Error state: border `error`, no ring.

### Badge — AI Signal

The AI waiting/active badge is the primary use of `accent` in the UI.

| Property | Value |
|---|---|
| Height | 18px |
| Padding | 0 6px |
| Border radius | `full` (9999px) |
| Font size | `xs` (11px) |
| Font weight | `semibold` (600) |
| Color | `accent` |
| Background | `accent-subtle` |

This badge appears on terminal tabs to signal that an AI agent session is active or waiting for input. It is the only persistent use of `accent` in the interface outside the terminal cursor. It must not be repurposed for non-AI statuses.

### Badge — Status

Same shape as the AI signal badge. Color is determined by status state:

| State | Text color | Background |
|---|---|---|
| Success | `success` | `success-subtle` |
| Warning | `warning` | `warning-subtle` |
| Error | `error` | `error-subtle` |
| Inactive / offline | `text-dim` | `surface-elevated` |

### Panel

| Property | Value |
|---|---|
| Border radius | `lg` (12px) |
| Border | `1px solid border` |
| Background | `surface` |
| Internal padding | `lg` (16px) |

Panels contain related content or controls. They do not have headers with decorative backgrounds — a panel header is plain text at `base`/`medium` with a hairline bottom border. Panels are not clickable by default; they are containers, not cards.

### Tab

| Property | Value |
|---|---|
| Height | 36px |
| Padding | 0 12px |
| Font size | `sm` (12px) |
| Font weight (active) | `medium` (500) |
| Font weight (inactive) | `regular` (400) |
| Text (active) | `text-primary` |
| Text (inactive) | `text-tertiary` |
| Active indicator | `2px solid accent`, bottom edge |
| Background | transparent |

Tab bars sit flush against their container's top edge, separated from content by a single hairline border using `border` token. There is no background highlight on the active tab — only the text weight change and the bottom border indicator.

**Terminal tab with AI badge:** When a terminal tab has an active AI session, the AI signal badge appears in the top-right corner of the tab, overlapping the tab's top edge. The badge does not reflow the tab label. Tab width accommodates the label; the badge is absolutely positioned.

### Terminal

The terminal is a distinct zone. All terminal design decisions are invariant — they do not change with theme.

| Property | Value |
|---|---|
| Background | `terminal-bg` (#1E2024) |
| Text | `terminal-text` (#E8EAED) |
| Font | `mono` stack |
| Font size | `base` (14px) |
| Line height | `normal` (1.5) |
| Cursor | `terminal-cursor` (#3B82F6) block cursor |
| Selection | `terminal-selection` (rgba(59,130,246,0.30)) |
| Border radius (container) | `lg` (12px) on the outer terminal panel |

The terminal surface itself (the text area) has no border radius — the radius applies to the outer container panel only, so the rounded corners are visible in the chrome while the terminal grid is pixel-exact.

---

## Do's and Don'ts

### Do

- **Do** use `accent` exclusively for live AI agent state signals: the terminal cursor, the AI waiting badge, focus rings on AI session inputs.
- **Do** express depth in dark mode by stepping through surface tokens (`background` → `surface` → `surface-elevated` → `surface-overlay`). Never add box shadows to dark-mode surfaces.
- **Do** use opacity layering (`text-primary` → `text-secondary` → `text-tertiary` → `text-dim`) as the primary hierarchy tool for text.
- **Do** use hairline borders (`1px solid border`) to define structure. Borders are structural — not decorative.
- **Do** keep monospace font confined to terminal output areas and code blocks.
- **Do** keep all terminals dark regardless of active theme.
- **Do** use `ghost` buttons for secondary actions. Reserve `primary` for one dominant action per context.
- **Do** apply the correct radius token for each component type: `sm` → badges, `md` → buttons/inputs, `lg` → panels, `xl` → modals, `full` → pill badges/avatars.
- **Do** treat the 4px base unit as law. All spacing must be a multiple of 4.
- **Do** keep information density high. Use minimum padding required for legibility. Do not add padding to "create space."

### Don't

- **Don't** use `accent` blue for decorative highlights, hover states on non-AI controls, active navigation items, or any purpose other than AI agent state signaling.
- **Don't** use monospace fonts in navigation, labels, status displays, headings, or any structural UI element outside terminal zones and code blocks.
- **Don't** add box shadows to dark-mode surfaces. Depth in dark mode is colorimetric only.
- **Don't** differentiate `surface` from `surface-elevated` in light mode by color — they are the same hex. Use shadow only.
- **Don't** use `full` radius (9999px) on containers, panels, or buttons. Pill shapes are reserved for badges and avatars.
- **Don't** use the Inter font in application HTML. Inter is the logo font, baked into the SVG mark. App UI uses Geist.
- **Don't** override `terminal-bg`. Terminal background is `#1E2024` always, regardless of theme.
- **Don't** apply the AI signal badge to non-AI statuses. Use status badges (success/warning/error/dim) for process state. The AI badge means one specific thing: an AI agent is present.
- **Don't** add decorative elements — gradients, illustrations, icons as decoration, colored section headers, background patterns. Every pixel must carry information.
- **Don't** use more than one `primary` button per visible context. If a screen needs two "primary" actions, one of them is a ghost.
- **Don't** render the wordmark in HTML/CSS using letter-spacing. The wordmark is always the SVG asset.
- **Don't** inflate spacing for aesthetics. This is a dense command center. Generous padding signals the wrong product category.
