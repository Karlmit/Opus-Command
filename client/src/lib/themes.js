/**
 * Theme registry — single source of truth for selectable color themes.
 *
 * Colors themselves live in `styles/globals.css` as `--color-*` custom
 * properties keyed off the `data-theme` attribute. This module owns the
 * theme *list* (ids, labels, light/dark mode, preview swatches) plus the
 * helpers that apply and normalize a theme, and the terminal ANSI palettes
 * (which xterm needs as concrete hex values rather than CSS variables).
 */

// swatch = [background, surface, accent, text] — preview dots only.
export const THEMES = [
  { id: 'opus-dark',  label: 'Opus Dark',  group: 'Opus', mode: 'dark',
    swatch: ['#2B2D31', '#383A40', '#3B82F6', '#F2F3F5'] },
  { id: 'opus-light', label: 'Opus Light', group: 'Opus', mode: 'light',
    swatch: ['#F5F5F6', '#FFFFFF', '#3B82F6', '#0D0D0E'] },
  { id: 'opus-purple', label: 'Opus Purple', group: 'Opus', mode: 'dark',
    swatch: ['#16121F', '#2A2240', '#8B5CF6', '#ECE8F8'] },
  { id: 'catppuccin-latte',     label: 'Latte',     group: 'Catppuccin', mode: 'light',
    swatch: ['#e6e9ef', '#ffffff', '#8839ef', '#4c4f69'] },
  { id: 'catppuccin-frappe',    label: 'Frappé',    group: 'Catppuccin', mode: 'dark',
    swatch: ['#303446', '#51576d', '#ca9ee6', '#c6d0f5'] },
  { id: 'catppuccin-macchiato', label: 'Macchiato', group: 'Catppuccin', mode: 'dark',
    swatch: ['#24273a', '#494d64', '#c6a0f6', '#cad3f5'] },
  { id: 'catppuccin-mocha',     label: 'Mocha',     group: 'Catppuccin', mode: 'dark',
    swatch: ['#1e1e2e', '#45475a', '#cba6f7', '#cdd6f4'] },
];

export const DEFAULT_THEME = 'opus-dark';

const THEME_IDS = new Set(THEMES.map(t => t.id));

// Map legacy / unknown stored values onto current ids.
const LEGACY = { dark: 'opus-dark', light: 'opus-light', system: 'opus-dark' };

export function normalizeTheme(id) {
  if (id && THEME_IDS.has(id)) return id;
  if (id && LEGACY[id]) return LEGACY[id];
  return DEFAULT_THEME;
}

export function themeMode(id) {
  const t = THEMES.find(x => x.id === normalizeTheme(id));
  return t ? t.mode : 'dark';
}

/** Apply a theme to <html> — sets both data-theme (id) and data-mode (light|dark). */
export function applyTheme(id) {
  const norm = normalizeTheme(id);
  const root = document.documentElement;
  root.setAttribute('data-theme', norm);
  root.setAttribute('data-mode', themeMode(norm));
  return norm;
}

/**
 * Catppuccin terminal ANSI palettes (16 colors) keyed by theme id.
 * Opus themes are intentionally omitted so the terminal keeps xterm's
 * built-in ANSI defaults (i.e. its current look). Mapping follows the
 * official Catppuccin terminal ports.
 */
export const TERMINAL_ANSI = {
  'catppuccin-latte': {
    black: '#bcc0cc', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d',
    blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#5c5f77',
    brightBlack: '#acb0be', brightRed: '#d20f39', brightGreen: '#40a02b', brightYellow: '#df8e1d',
    brightBlue: '#1e66f5', brightMagenta: '#ea76cb', brightCyan: '#179299', brightWhite: '#6c6f85',
  },
  'catppuccin-frappe': {
    black: '#51576d', red: '#e78284', green: '#a6d189', yellow: '#e5c890',
    blue: '#8caaee', magenta: '#f4b8e4', cyan: '#81c8be', white: '#b5bfe2',
    brightBlack: '#626880', brightRed: '#e78284', brightGreen: '#a6d189', brightYellow: '#e5c890',
    brightBlue: '#8caaee', brightMagenta: '#f4b8e4', brightCyan: '#81c8be', brightWhite: '#a5adce',
  },
  'catppuccin-macchiato': {
    black: '#494d64', red: '#ed8796', green: '#a6da95', yellow: '#eed49f',
    blue: '#8aadf4', magenta: '#f5bde6', cyan: '#8bd5ca', white: '#b8c0e0',
    brightBlack: '#5b6078', brightRed: '#ed8796', brightGreen: '#a6da95', brightYellow: '#eed49f',
    brightBlue: '#8aadf4', brightMagenta: '#f5bde6', brightCyan: '#8bd5ca', brightWhite: '#a5adcb',
  },
  'catppuccin-mocha': {
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
    blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
    brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af',
    brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8',
  },
};
