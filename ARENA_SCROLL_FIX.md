# My Arena Scroll Bug — Diagnosis & Fix

## The Problem

The "My Arena" live page scroll feels stuck, unresponsive, or fights the user's finger.

## Root Cause

There are **three interacting issues** that combine to make scrolling feel broken:

### Issue 1: Overly Aggressive Pager Lock (Primary Cause)

The `horizontalGestureGuard` disables the PagerView's horizontal scrolling on **any touch** to a horizontal child — not just when the user is actually dragging horizontally.

```typescript
// Line 3032-3036 — lockArenaPager fires on onTouchStart
const lockArenaPager = useCallback(() => {
  if (pagerUnlockTimer.current) clearTimeout(pagerUnlockTimer.current);
  setArenaPagerEnabled(false);
  pagerRef.current?.setScrollEnabled(false);
}, []);
```

This means:
- User touches the live card carousel area → pager locks
- User starts scrolling **vertically** → pager is still locked (correct)
- User lifts finger → `unlockArenaPager` fires with a **150ms delay**
- During that 150ms, the pager is still locked
- If the user immediately tries to swipe horizontally to change arena pages, it doesn't respond

But worse: **every horizontal ScrollView/FlatList on the page fires this guard on `onTouchStart`**:
- SportPills (line 298)
- YourGames followed cards (line 767)
- Live card carousel (line 2544)
- Prep top-3 cards (line 2669)

So touching ANYWHERE near these components locks the pager, and the 150ms unlock delay creates a window where vertical scrolling also feels "stuck" because React Native's gesture system gets confused about which responder owns the touch.

### Issue 2: `nestedScrollEnabled` Without Proper Gesture Boundaries

All horizontal FlatLists use `nestedScrollEnabled={true}` but don't have explicit gesture boundaries (like `simultaneousHandlers` or `waitFor`). On Android, this causes the parent `Animated.ScrollView` (ArenaScrollView) and the horizontal FlatList to compete for the same touch, resulting in:
- Diagonal scroll attempts getting stuck
- Vertical scroll not starting until the finger moves purely vertically
- Horizontal lists "capturing" touches that should have been vertical scrolls

### Issue 3: `useHideOnScroll` Reacting to Short Drags

The `ScrollContext` hook has a 50px threshold for hiding and 30px for showing the tab bar. But because the `ArenaScrollView` receives scroll events from **all** nested content (including when the user is trying to scroll horizontally), it can:
- Incorrectly detect "scrolling down" when the user is swiping a card carousel
- Hide the tab bar unexpectedly
- Create a 300ms cooldown that makes the next vertical scroll feel delayed

## The Fix

### Fix 1: Only lock pager on actual horizontal drag, not on touch start

Replace `onTouchStart` with `onScrollBeginDrag` as the lock trigger. This way the pager only locks when the user actually starts dragging a horizontal list, not just touching it:

```typescript
// BEFORE (locks on any touch)
onTouchStart={horizontalGestureGuard?.onHorizontalGestureStart}
onTouchEnd={horizontalGestureGuard?.onHorizontalGestureEnd}

// AFTER (locks only on actual horizontal drag)
// Remove onTouchStart and onTouchEnd entirely
// Keep only:
onScrollBeginDrag={horizontalGestureGuard?.onHorizontalGestureStart}
onScrollEndDrag={horizontalGestureGuard?.onHorizontalGestureEnd}
onMomentumScrollEnd={horizontalGestureGuard?.onHorizontalGestureEnd}
```

### Fix 2: Remove the 150ms unlock delay

The delay was added to prevent "flicker" but it's causing the stuck feeling. Replace with immediate unlock:

```typescript
const unlockArenaPager = useCallback(() => {
  if (pagerUnlockTimer.current) clearTimeout(pagerUnlockTimer.current);
  // Immediate unlock — no delay
  setArenaPagerEnabled(true);
  pagerRef.current?.setScrollEnabled(true);
}, []);
```

### Fix 3: Add `simultaneousHandlers` or use `waitFor` for nested scroll coordination

For the `ArenaScrollView` parent, add a ref and pass it as a `simultaneousHandlers` to child horizontal lists so they don't fight:

```typescript
// In ArenaScrollView, add a ref
const verticalScrollRef = useAnimatedRef();

// Pass to Animated.ScrollView
<Animated.ScrollView ref={verticalScrollRef} ...>

// In horizontal FlatLists, add simultaneousHandlers
<Animated.FlatList
  simultaneousHandlers={verticalScrollRef}
  ...
/>
```

### Fix 4: Guard `useHideOnScroll` against horizontal scroll events

Add a minimum vertical velocity check so horizontal swipes don't trigger the tab bar hide:

```typescript
// In ScrollContext.tsx, add a guard:
if (Math.abs(diff) < 3) return; // Ignore tiny movements (likely horizontal scroll noise)
```
