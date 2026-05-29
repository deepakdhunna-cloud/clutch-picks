import React, { useRef } from 'react';
import { Platform, View, type ViewProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Shared screen scaffold that applies the top safe-area inset on the FIRST frame.
 *
 * Why this exists (New Architecture / Fabric):
 * The native `<SafeAreaView edges={['top']}>` from react-native-safe-area-context
 * computes its padding from the *native* view's measured insets. On Fabric a
 * freshly-mounted screen (tabs use `lazy: true`, so a screen mounts on first
 * focus) reports a top inset of 0 on its very first commit, then a follow-up
 * native commit sends the real inset. That two-step paint is the "content renders
 * up behind the status bar for one frame, then snaps down" jump.
 *
 * `useSafeAreaInsets()` reads from the React SafeAreaContext, which the root
 * `<SafeAreaProvider initialMetrics={initialWindowMetrics}>` seeds synchronously.
 * Applying that inset as `paddingTop` makes frame 1 correct.
 *
 * Edge case: on New Arch `initialWindowMetrics` can be `null` at JS startup, so
 * the JS top inset can also be 0 for the first frame. On iOS the real top inset
 * is always > 0 (status bar / notch / Dynamic Island), so `top === 0` is a
 * reliable "not ready yet" signal there. We:
 *   1. Keep a sticky top inset (a real `top > 0`, once seen, never reverts to 0),
 *      which kills any downward snap if insets briefly re-report 0.
 *   2. On iOS, while the inset is still unresolved (sticky top is 0), hold the
 *      children back and paint only the screen background — so the gate shows the
 *      screen's own color (never a white flash, never content under the bar).
 *      This lasts at most one frame until the provider/native inset resolves.
 *
 * On Android `top` is legitimately 0 in some configurations, so we never gate
 * there; we simply apply the resolved inset.
 *
 * Drop-in replacement for `<SafeAreaView edges={['top']}>`.
 */
export interface TopInsetViewProps extends ViewProps {
  children?: React.ReactNode;
  /** Background painted during the (sub-frame) gate so there is never a white flash. */
  backgroundColor?: string;
}

export function TopInsetView({
  children,
  style,
  backgroundColor,
  ...rest
}: TopInsetViewProps) {
  const insets = useSafeAreaInsets();

  // Sticky top inset: once a real (> 0) value is observed, never fall back to 0.
  // This prevents a downward snap if the inset momentarily re-reports 0.
  const stickyTopRef = useRef(0);
  if (insets.top > stickyTopRef.current) {
    stickyTopRef.current = insets.top;
  }
  const topInset = stickyTopRef.current;

  // Resolve the background color from the passed style (so the gate matches the
  // screen) with an explicit override winning.
  const resolvedBg =
    backgroundColor ?? flattenBackgroundColor(style) ?? '#000000';

  // On iOS a resolved top inset is always > 0. If it's still 0, the inset hasn't
  // arrived yet — hold children back for this sub-frame and show only the bg.
  const insetReady = Platform.OS !== 'ios' || topInset > 0;

  return (
    <View
      {...rest}
      style={[
        style,
        { paddingTop: topInset, backgroundColor: resolvedBg },
      ]}
    >
      {insetReady ? children : null}
    </View>
  );
}

function flattenBackgroundColor(style: ViewProps['style']): string | undefined {
  if (!style) return undefined;
  if (Array.isArray(style)) {
    // Last definition wins, matching RN style merge order.
    for (let i = style.length - 1; i >= 0; i--) {
      const bg = flattenBackgroundColor(style[i] as ViewProps['style']);
      if (bg != null) return bg;
    }
    return undefined;
  }
  const bg = (style as ViewStyle).backgroundColor;
  return typeof bg === 'string' ? bg : undefined;
}

export default TopInsetView;
