import { Easing } from 'react-native-reanimated';
import type { WithSpringConfig, WithTimingConfig } from 'react-native-reanimated';

/**
 * Motion tokens — one source of truth for animation timing and physics.
 *
 * Durations and easing curves were previously hand-typed at each call site
 * (150 / 200 / 300 / 400ms with assorted `Easing.*`). Centralizing them keeps
 * motion coherent across the app: things that should feel the same, feel the
 * same. All values are UI-thread friendly (consumed by Reanimated worklets).
 *
 * Scale:
 *   instant — sub-perceptual state flips
 *   fast    — press feedback, taps, small affordances
 *   medium  — most transitions (selection, fade, slide)
 *   slow    — deliberate, larger moves (sheets, emphasis)
 *
 * Use SPRING for anything that should feel physical (press scale, snapping).
 * Use TIMING + EASE for opacity/color/positional tweens.
 */

export const DURATION = {
  instant: 90,
  fast: 150,
  medium: 240,
  slow: 360,
} as const;

/** Standard easing curves. Avoid linear — it reads mechanical. */
export const EASE = {
  /** Decelerate into rest — good for entrances and press-in. */
  out: Easing.out(Easing.cubic),
  /** Accelerate then decelerate — good for moves between two states. */
  inOut: Easing.inOut(Easing.cubic),
  /** Accelerate away — good for exits. */
  in: Easing.in(Easing.cubic),
} as const;

/** Spring presets tuned for a calm, premium, non-bouncy feel. */
export const SPRING = {
  /** Crisp press response — settles quickly with no visible bounce. */
  press: {
    damping: 26,
    stiffness: 320,
    mass: 0.7,
    overshootClamping: true,
  } satisfies WithSpringConfig,
  /** General-purpose physical move with a hint of life. */
  gentle: {
    damping: 22,
    stiffness: 200,
    mass: 0.9,
  } satisfies WithSpringConfig,
} as const;

/** Convenience timing configs for the common durations. */
export const TIMING = {
  fast: { duration: DURATION.fast, easing: EASE.out } satisfies WithTimingConfig,
  medium: { duration: DURATION.medium, easing: EASE.inOut } satisfies WithTimingConfig,
  slow: { duration: DURATION.slow, easing: EASE.inOut } satisfies WithTimingConfig,
} as const;

/** Standard pressed-scale target for tappable surfaces. */
export const PRESS_SCALE = 0.97;
/** A slightly deeper press for large cards where 0.97 is imperceptible. */
export const PRESS_SCALE_CARD = 0.965;
