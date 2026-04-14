import { createContext, useContext } from 'react';
import {
  useSharedValue,
  useAnimatedScrollHandler,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

type ScrollContextType = {
  tabBarVisible: SharedValue<number>;
};

const ScrollContext = createContext<ScrollContextType | null>(null);

export function ScrollProvider({ children }: { children: React.ReactNode }) {
  const tabBarVisible = useSharedValue(1);

  return (
    <ScrollContext.Provider value={{ tabBarVisible }}>
      {children}
    </ScrollContext.Provider>
  );
}

export function useTabBarVisible(): SharedValue<number> {
  const ctx = useContext(ScrollContext);
  if (!ctx) {
    throw new Error('useTabBarVisible must be used within ScrollProvider');
  }
  return ctx.tabBarVisible;
}

export function useHideOnScroll() {
  const ctx = useContext(ScrollContext);
  if (!ctx) throw new Error('useHideOnScroll must be used within ScrollProvider');

  const { tabBarVisible } = ctx;
  const lastDirection = useSharedValue(0); // 1 = scrolling down, -1 = scrolling up
  const directionAnchor = useSharedValue(0); // scroll position where direction last changed
  const previousOffset = useSharedValue(0);
  const cooldownUntil = useSharedValue(0); // timestamp — ignore events until this time

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const currentOffset = event.contentOffset.y;
      const diff = currentOffset - previousOffset.value;
      const now = Date.now();

      previousOffset.value = currentOffset;

      // Always show near top
      if (currentOffset < 20) {
        if (tabBarVisible.value !== 1) {
          tabBarVisible.value = withTiming(1, { duration: 200 });
          cooldownUntil.value = now + 300;
        }
        directionAnchor.value = currentOffset;
        lastDirection.value = 0;
        return;
      }

      // Skip if in cooldown
      if (now < cooldownUntil.value) return;

      // Detect direction change — reset anchor
      const currentDirection = diff > 2 ? 1 : diff < -2 ? -1 : lastDirection.value;
      if (currentDirection !== 0 && currentDirection !== lastDirection.value) {
        directionAnchor.value = currentOffset;
        lastDirection.value = currentDirection;
      }

      // Only act after 50px of sustained scroll in one direction
      const distanceFromAnchor = currentOffset - directionAnchor.value;

      if (distanceFromAnchor > 50 && tabBarVisible.value !== 0) {
        // Scrolled 50px down from anchor — hide bar
        tabBarVisible.value = withTiming(0, { duration: 200 });
        cooldownUntil.value = now + 300;
      } else if (distanceFromAnchor < -30 && tabBarVisible.value !== 1) {
        // Scrolled 30px up from anchor — show bar (lower threshold for showing)
        tabBarVisible.value = withTiming(1, { duration: 200 });
        cooldownUntil.value = now + 300;
      }
    },
    onEndDrag: () => {
      'worklet';
      // Reset anchor on finger lift so momentum doesn't fight the last drag direction
      directionAnchor.value = previousOffset.value;
    },
    onMomentumEnd: () => {
      'worklet';
      // When momentum fully stops, show the bar
      if (previousOffset.value < 20) {
        tabBarVisible.value = withTiming(1, { duration: 200 });
      }
    },
  });

  return scrollHandler;
}
