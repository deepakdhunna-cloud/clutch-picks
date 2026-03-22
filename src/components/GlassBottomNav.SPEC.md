# Glassmorphism Bottom Navigation — Design Spec

## UI Description

A floating pill-shaped bottom tab bar with a frosted glass effect. The bar sits above the bottom safe area with horizontal margins, creating a contained “island” that floats over screen content. Icons and labels use high-contrast white tones against the dark-tinted glass for readability in dark-themed UIs.

---

## Style Values

| Token | Value | Notes |
|-------|-------|-------|
| **Blur** | `intensity: 70`, `tint: "dark"` | expo-blur BlurView |
| **Overlay** | `rgba(0, 0, 0, 0.25)` | Semi-transparent dark tint |
| **Inner highlight** | 1px `rgba(255, 255, 255, 0.08)` | Top edge for depth |
| **Shadow (iOS)** | `0 4 24 rgba(0,0,0,0.35)` | Soft outer shadow |
| **Shadow (Android)** | `elevation: 12` | Material elevation |
| **Radius** | `24` (2xl) or `9999` (pill) | Rounded corners |
| **Active icon** | `#FFFFFF` | Full opacity |
| **Inactive icon** | `rgba(255, 255, 255, 0.5)` | 50% opacity |
| **Active label** | `#FFFFFF` | 600 weight |
| **Inactive label** | `rgba(255, 255, 255, 0.5)` | 600 weight |

---

## Layout Specs

- **Position**: Fixed bottom, centered
- **Horizontal padding**: 20px each side
- **Bottom padding**: `max(safeAreaBottom, 12)`
- **Min height**: 64px
- **Max width**: 400px (on wide screens)
- **Icon spacing**: `space-evenly` between items
- **Tap target**: min 44×44px per tab (iOS HIG)
- **Vertical padding**: 8px top/bottom inside bar

---

## Micro-interactions

| Action | Effect |
|--------|--------|
| **Press in** | Scale down to 0.95 (spring, damping 15, stiffness 400) |
| **Press out** | Scale to 1 (inactive) or 1.05 (active) |
| **Tab change** | Glow fades in/out over 200ms |
| **Tap** | Light haptic (`Haptics.ImpactFeedbackStyle.Light`) |

---

## Accessibility

- **Contrast**: Active `#FFFFFF` on dark glass meets WCAG AA
- **Labels**: 11px semi-bold, `numberOfLines={1}` for truncation
- **Roles**: `accessibilityRole="button"`, `accessibilityState={{ selected }}`
- **Tap size**: 44×44px minimum

---

## Performance Notes

1. **Blur**: Uses native `UIVisualEffectView` on iOS for hardware-accelerated blur.
2. **Reanimated**: Animations run on the UI thread; no JS-driven layout animations.
3. **Android**: BlurView falls back to semi-transparent overlay; avoid high-intensity blur on Android.
4. **Rendering**: BlurView should render *after* dynamic content (e.g. FlatList) so it reflects correct content.
5. **Memos**: Tab buttons and icons are not wrapped in `memo` to keep routing logic simple; the bar is lightweight.
