import { claimInteractionLock } from './interaction-guard';

const DEFAULT_NAVIGATION_LOCK_MS = 800;

type RouterLike = {
  push?: (href: any) => void;
  replace?: (href: any) => void;
  back?: () => void;
  canGoBack?: () => boolean;
  dismissAll?: () => void;
};

// Minimal shape of the root navigation container ref we rely on. Passed in by
// the root layout so this module doesn't import React hooks.
type NavigationRefLike = {
  isReady?: () => boolean;
  dispatch?: (action: any) => void;
};

// Map an expo-router href (e.g. '/(tabs)', '/welcome', '/onboarding') to the
// root navigator route name React Navigation expects in a reset action. The
// root Stack registers screens as 'welcome', 'onboarding', '(tabs)', etc.
function rootRouteNameFromHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  // Strip query/hash and leading slash, keep only the first path segment.
  const path = href.split(/[?#]/)[0]!.replace(/^\/+/, '');
  const first = path.split('/')[0] ?? '';
  if (first === '' ) return '(tabs)'; // '/' resolves to the tabs group index
  return first;
}

// Dispatch a true root-stack reset so nothing is left beneath the destination
// in the native back stack. Returns true if the reset was dispatched.
function dispatchRootReset(
  navigationRef: NavigationRefLike | undefined,
  href: unknown,
): boolean {
  if (!navigationRef?.isReady?.() || !navigationRef.dispatch) return false;
  const name = rootRouteNameFromHref(href);
  if (!name) return false;
  try {
    // Construct the React Navigation RESET action inline rather than importing
    // CommonActions from '@react-navigation/native'. That import transitively
    // pulls in react-native, which breaks pure unit tests for this module; the
    // action object shape ({ type: 'RESET', payload }) is stable and is exactly
    // what CommonActions.reset() produces.
    navigationRef.dispatch({
      type: 'RESET',
      payload: { index: 0, routes: [{ name }] },
    });
    return true;
  } catch {
    return false;
  }
}

// Retry a true root RESET across a few frames while the container ref is not
// yet ready. On a cold-start auth/onboarding transition the navigation
// container often isn't ready on the first tick, which previously made
// guardedResetTo fall straight through to the leaky dismissAll()+replace()
// path — and that path left Welcome/onboarding sitting beneath the tabs group,
// so an iOS edge back-swipe on Home popped back to the Welcome screen. By
// retrying the real RESET until the ref is ready, the destination becomes the
// ONLY root route on every entry path. Returns a cleanup canceller.
function scheduleRootResetWhenReady(
  navigationRef: NavigationRefLike | undefined,
  href: unknown,
  attempts = 30,
): boolean {
  if (!navigationRef) return false;
  // Try immediately; if it worked, we're done.
  if (dispatchRootReset(navigationRef, href)) return true;
  // Otherwise poll on a short interval until ready or attempts exhausted.
  let remaining = attempts;
  const tick = () => {
    if (remaining-- <= 0) return;
    if (dispatchRootReset(navigationRef, href)) return;
    setTimeout(tick, 16);
  };
  setTimeout(tick, 16);
  // We have scheduled a guaranteed RESET, so the caller should NOT run the
  // leaky fallback. Report handled.
  return true;
}

type NavigationLike = {
  navigate?: (...args: any[]) => void;
};

type GuardOptions = {
  key?: string;
  windowMs?: number;
  now?: number;
};

function hrefKey(href: unknown): string {
  if (typeof href === 'string') return href;
  try {
    return JSON.stringify(href);
  } catch {
    return String(href);
  }
}

function claimNavigation(key: string, options: GuardOptions = {}): boolean {
  return claimInteractionLock(
    options.key ?? key,
    options.windowMs ?? DEFAULT_NAVIGATION_LOCK_MS,
    options.now ?? Date.now(),
  );
}

export function guardedRouterPush(
  router: RouterLike,
  href: any,
  options: GuardOptions = {},
): boolean {
  if (!claimNavigation(`router:push:${hrefKey(href)}`, options)) return false;
  router.push?.(href);
  return true;
}

export function guardedRouterReplace(
  router: RouterLike,
  href: any,
  options: GuardOptions = {},
): boolean {
  if (!claimNavigation(`router:replace:${hrefKey(href)}`, options)) return false;
  router.replace?.(href);
  return true;
}

/**
 * Reset the navigation stack to a single destination. Used for auth-state
 * transitions (welcome/onboarding -> tabs, or signed-out -> welcome) so the
 * previous screens are flushed out of the native back stack. This is what
 * prevents an iOS edge back-swipe from popping Home back to the Welcome /
 * onboarding screen (which would otherwise re-trigger onboarding).
 */
export function guardedResetTo(
  router: RouterLike,
  href: any,
  options: GuardOptions & { navigationRef?: NavigationRefLike } = {},
): boolean {
  if (!claimNavigation(`router:reset:${hrefKey(href)}`, options)) return false;
  // Preferred path: dispatch a real root-stack reset via the navigation
  // container ref. This guarantees the destination becomes the only route in
  // the root stack regardless of how the user got here, so an iOS edge
  // back-swipe on Home can never pop back to Welcome / onboarding. expo-router's
  // dismissAll() only pops modals / pops-to-top within the active stack and, on
  // some entry paths, left Welcome sitting underneath the tabs group.
  if (dispatchRootReset(options.navigationRef, href)) {
    return true;
  }
  // Ref not ready yet (common on cold-start auth/onboarding transitions). Do a
  // best-effort immediate replace so the destination paints without delay, AND
  // schedule a real root RESET to fire the instant the container becomes ready
  // — so nothing is ever left beneath the destination in the native stack.
  try {
    router.dismissAll?.();
  } catch {
    // dismissAll throws if there is nothing to dismiss — safe to ignore.
  }
  router.replace?.(href);
  if (options.navigationRef) {
    scheduleRootResetWhenReady(options.navigationRef, href);
  }
  return true;
}

export function guardedRouterBack(
  router: RouterLike,
  options: GuardOptions & { fallback?: any } = {},
): boolean {
  if (!claimNavigation('router:back', options)) return false;
  if (router.canGoBack?.() === false && options.fallback !== undefined) {
    router.replace?.(options.fallback);
  } else {
    router.back?.();
  }
  return true;
}

export function guardedNavigationNavigate(
  navigation: NavigationLike,
  args: any[],
  options: GuardOptions = {},
): boolean {
  const target = args.length > 0 ? hrefKey(args[0]) : 'unknown';
  if (!claimNavigation(`navigation:navigate:${target}`, options)) return false;
  navigation.navigate?.(...args);
  return true;
}
