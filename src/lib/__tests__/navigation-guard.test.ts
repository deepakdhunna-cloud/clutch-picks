import {
  guardedRouterBack,
  guardedRouterPush,
  guardedRouterReplace,
  guardedResetTo,
} from '../navigation-guard';
import { releaseAllInteractionLocksForTests } from '../interaction-guard';

describe('navigation guard', () => {
  beforeEach(() => {
    releaseAllInteractionLocksForTests();
  });

  it('blocks duplicate pushes to the same target', () => {
    const pushes: unknown[] = [];
    const router = { push: (href: unknown) => pushes.push(href) };

    expect(guardedRouterPush(router, '/paywall', { now: 1000 })).toBe(true);
    expect(guardedRouterPush(router, '/paywall', { now: 1100 })).toBe(false);
    expect(pushes).toEqual(['/paywall']);
  });

  it('allows a replace after the lock window expires', () => {
    const replacements: unknown[] = [];
    const router = { replace: (href: unknown) => replacements.push(href) };

    expect(guardedRouterReplace(router, '/welcome', { windowMs: 500, now: 1000 })).toBe(true);
    expect(guardedRouterReplace(router, '/welcome', { windowMs: 500, now: 1400 })).toBe(false);
    expect(guardedRouterReplace(router, '/welcome', { windowMs: 500, now: 1501 })).toBe(true);
    expect(replacements).toEqual(['/welcome', '/welcome']);
  });

  it('uses a fallback when back cannot pop a route', () => {
    const actions: string[] = [];
    const router = {
      canGoBack: () => false,
      back: () => actions.push('back'),
      replace: (href: unknown) => actions.push(`replace:${String(href)}`),
    };

    expect(guardedRouterBack(router, { fallback: '/(tabs)', now: 1000 })).toBe(true);
    expect(actions).toEqual(['replace:/(tabs)']);
  });

  it('dispatches a true root-stack RESET to the destination when the nav ref is ready', () => {
    const dispatched: any[] = [];
    const routerActions: string[] = [];
    const router = {
      replace: (href: unknown) => routerActions.push(`replace:${String(href)}`),
      dismissAll: () => routerActions.push('dismissAll'),
    };
    const navigationRef = {
      isReady: () => true,
      dispatch: (action: unknown) => dispatched.push(action),
    };

    expect(guardedResetTo(router, '/(tabs)', { navigationRef, now: 2000 })).toBe(true);
    // The reset must target the '(tabs)' root route as the only entry, so an iOS
    // edge back-swipe on Home cannot pop back to Welcome / onboarding.
    expect(dispatched).toEqual([
      { type: 'RESET', payload: { index: 0, routes: [{ name: '(tabs)' }] } },
    ]);
    // When the ref handles the reset we must NOT also run the replace fallback.
    expect(routerActions).toEqual([]);
  });

  it('maps welcome and onboarding hrefs to their root route names', () => {
    const reset = (href: string, now: number) => {
      const dispatched: any[] = [];
      const navigationRef = { isReady: () => true, dispatch: (a: unknown) => dispatched.push(a) };
      guardedResetTo({ replace: () => {}, dismissAll: () => {} }, href, { navigationRef, now });
      return dispatched[0]?.payload?.routes?.[0]?.name;
    };

    expect(reset('/welcome', 3000)).toBe('welcome');
    expect(reset('/onboarding', 3100)).toBe('onboarding');
  });

  it('falls back to dismissAll + replace when the nav ref is not ready', () => {
    const actions: string[] = [];
    const router = {
      replace: (href: unknown) => actions.push(`replace:${String(href)}`),
      dismissAll: () => actions.push('dismissAll'),
    };
    const navigationRef = { isReady: () => false, dispatch: () => actions.push('dispatch') };

    expect(guardedResetTo(router, '/(tabs)', { navigationRef, now: 4000 })).toBe(true);
    expect(actions).toEqual(['dismissAll', 'replace:/(tabs)']);
  });
});
