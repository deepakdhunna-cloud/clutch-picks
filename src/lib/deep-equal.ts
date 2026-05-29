// Deep structural equality for JSON-like data (plain objects, arrays, and
// primitives — no functions, Dates, Maps, or Sets).
//
// Why this exists: the live data layer re-creates fresh game objects on every
// poll tick even when nothing actually changed. A shallow React.memo sees a new
// reference and re-renders the (expensive) card subtree on a timer. Comparing by
// CONTENT lets an unchanged card skip the re-render entirely, while any real
// change still updates it because deepEqual returns false. This only gates
// rendering — it never touches the cached data itself.
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;

  if (aIsArray) {
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    if (arrA.length !== arrB.length) return false;
    for (let i = 0; i < arrA.length; i++) {
      if (!deepEqual(arrA[i], arrB[i])) return false;
    }
    return true;
  }

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!deepEqual(objA[key], objB[key])) return false;
  }
  return true;
}
