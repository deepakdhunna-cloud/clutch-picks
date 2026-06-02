import { claimInteractionLock } from './interaction-guard';

const DEFAULT_NAVIGATION_LOCK_MS = 800;

type RouterLike = {
  push?: (href: any) => void;
  replace?: (href: any) => void;
  back?: () => void;
  canGoBack?: () => boolean;
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
