import {
  guardedRouterBack,
  guardedRouterPush,
  guardedRouterReplace,
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
});
