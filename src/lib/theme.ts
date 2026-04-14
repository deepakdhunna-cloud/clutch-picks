export const theme = {
  colors: {
    primary: '#17408B', // Navy blue
    secondary: '#C9CED6', // Silver
    accent: '#C8102E', // NBA red
    background: '#0A1628', // Dark navy
    surface: '#132341', // Lighter navy
    text: {
      primary: '#FFFFFF',
      secondary: '#A1B3C9',
      muted: '#6B7C94',
    },
    success: '#22C55E',
    warning: '#F59E0B',
    error: '#EF4444',
  },
  gradients: {
    primary: ['#17408B', '#0A1628'] as const,
    accent: ['#C8102E', '#8B0A1F'] as const,
    surface: ['#1A2F4D', '#0A1628'] as const,
  },
};

// ─── Canonical brand palette ────────────────────────────────────────────
// These are the values screens actually use today. The `theme.colors.*`
// values above are unused legacy and kept only to avoid breaking any
// untraced reference. New code should import these constants directly.

export const MAROON = '#8B0A1F';
export const MAROON_DIM = 'rgba(139,10,31,0.15)';
export const MAROON_GLOW = 'rgba(139,10,31,0.25)';

export const TEAL = '#7A9DB8';
export const TEAL_DIM = 'rgba(122,157,184,0.12)';
export const TEAL_DARK = '#5A7A8A';

export const BG = '#040608';

// ─── Status colors ──────────────────────────────────────────────────────
export const WIN = '#7A9DB8';     // Wins display in teal
export const LOSS = '#EF4444';    // Error red
export const LIVE_RED = '#DC2626';
export const GREEN_UP = '#4ADE80';

// ─── Neutral / text ─────────────────────────────────────────────────────
export const WHITE = '#FFFFFF';
export const SILVER = '#C9CED6';
export const TEXT_PRIMARY = '#FFFFFF';
export const TEXT_SECONDARY = '#A1B3C9';
export const TEXT_MUTED = '#6B7C94';

// ─── Glass / panel surfaces (white overlay opacities) ───────────────────
// Multiple opacities encode depth hierarchy — don't collapse into one.
export const GLASS_FAINT = 'rgba(255,255,255,0.02)';
export const GLASS_LIGHT = 'rgba(255,255,255,0.04)';
export const GLASS_MED = 'rgba(255,255,255,0.06)';
export const GLASS_STRONG = 'rgba(255,255,255,0.08)';

// Deep panel backgrounds (dark fill, near-opaque)
export const PANEL_DARK = 'rgba(8,8,12,0.95)';
export const PANEL_DARKER = 'rgba(2,3,8,0.92)';

// ─── Border opacities ───────────────────────────────────────────────────
export const BORDER_FAINT = 'rgba(255,255,255,0.04)';
export const BORDER_LIGHT = 'rgba(255,255,255,0.06)';
export const BORDER_MED = 'rgba(255,255,255,0.08)';
export const BORDER_STRONG = 'rgba(255,255,255,0.12)';
export const BORDER_BOLD = 'rgba(255,255,255,0.14)';

// ─── Typography scale ───────────────────────────────────────────────────
export const TYPOGRAPHY = {
  xs: 10,
  sm: 12,
  base: 14,
  md: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 28,
  '4xl': 32,
  '5xl': 40,
  '6xl': 48,
  display: 56,
  hero: 72,
};

// ─── Spacing scale ──────────────────────────────────────────────────────
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
};
