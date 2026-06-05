/**
 * Mock Prisma client for standalone backtest execution.
 * All queries return empty results; no real DB connection is made.
 */

const noopQuery = () => ({
  findMany: () => Promise.resolve([]),
  findFirst: () => Promise.resolve(null),
  findUnique: () => Promise.resolve(null),
  create: () => Promise.resolve({}),
  update: () => Promise.resolve({}),
  upsert: () => Promise.resolve({}),
  delete: () => Promise.resolve({}),
  count: () => Promise.resolve(0),
});

const handler: ProxyHandler<any> = {
  get(_target, prop) {
    if (prop === "$disconnect") return () => Promise.resolve();
    if (prop === "$connect") return () => Promise.resolve();
    if (prop === "$transaction") return (fn: any) => Promise.resolve(fn ? fn(_target) : []);
    if (typeof prop === "string" && !prop.startsWith("$")) {
      return noopQuery();
    }
    return undefined;
  },
};

export const prisma = new Proxy({}, handler);
