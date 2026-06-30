import * as Haptics from 'expo-haptics';

/**
 * Semantic haptics — one source of truth for feedback intent.
 *
 * Why this exists: haptics were fired ad hoc across ~16 files with three
 * different call shapes (`impactAsync`, `selectionAsync`, `notificationAsync`)
 * and inconsistent strength (e.g. a pick *selection* using `Medium`, which
 * Apple's HIG reserves for confirmations). Mapping intent → feedback in one
 * place keeps the whole app consistent and makes haptics mean something.
 *
 * Restraint is the rule: fire on *significant* moments (selection changes,
 * confirmations, outcomes), never on every render or scroll. Every call is
 * fire-and-forget and never throws — haptics are an enhancement, not a
 * dependency, and they no-op gracefully where unsupported (e.g. web).
 *
 * Intent → feedback map:
 *   tap        — a light, incidental press (buttons, rows, chips, nav)
 *   selection  — moving between discrete options (segmented controls, filters,
 *                selecting/deselecting a pick); uses the dedicated selection
 *                feedback that is tuned for exactly this on iOS
 *   confirm    — a deliberate, weightier commit (primary CTA, submit, purchase)
 *   success    — a positive outcome completed (pick saved, purchase restored)
 *   warning    — a cautionary outcome (validation, recoverable issue)
 *   error      — a failed outcome (request failed, invalid input)
 */

function run(fn: () => Promise<void>): void {
  // Fire-and-forget; never let a haptics failure surface to the UI.
  try {
    void fn().catch(() => {});
  } catch {
    // no-op (e.g. unsupported platform)
  }
}

export const haptics = {
  /** Light, incidental press feedback (buttons, rows, chips, nav items). */
  tap(): void {
    run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  },

  /** Moving between discrete options / toggling a selection. */
  selection(): void {
    run(() => Haptics.selectionAsync());
  },

  /** A deliberate commit — primary CTA, submit, purchase, sign-in. */
  confirm(): void {
    run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
  },

  /** A positive outcome completed. */
  success(): void {
    run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },

  /** A cautionary, recoverable outcome. */
  warning(): void {
    run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  },

  /** A failed outcome. */
  error(): void {
    run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
  },

  /**
   * A single, deliberate, weighty "thunk" reserved for one-off brand moments
   * (e.g. the splash logo landing). Intentionally heavier than `confirm`.
   */
  impact(): void {
    run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
  },
};

export type HapticIntent = keyof typeof haptics;
