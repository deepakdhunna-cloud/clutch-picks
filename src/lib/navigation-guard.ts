import { claimInteractionLock } from './interaction-guard';

const DEFAULT_NAVIGATION_LOCK_MS = 800;

type RouterLike = {
  push?: (href: any) => void;
  replace?: (href: any) => void;
  back?: () => void;
  canGoBack?: () => boolean;
  dismissAll?: () => void;
};

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
  options: GuardOptions = {},
): boolean {
  if (!claimNavigation(`router:reset:${hrefKey(href)}`, options)) return false;
  // Pop everything sitting beneath the current screen first, then replace the
  // current screen with the destination so nothing is left in the back stack.
  try {
    router.dismissAll?.();
  } catch {
    // dismissAll throws if there is nothing to dismiss — safe to ignore.
  }
  router.replace?.(href);
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
