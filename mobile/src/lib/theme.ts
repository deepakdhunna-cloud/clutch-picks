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
