/**
 * Sequential write queue for SQLite.
 *
 * SQLite allows only one concurrent writer. All DB writes that happen during
 * prediction generation are routed through this queue so they execute one at a
 * time. Callers enqueue a write and continue immediately — the queue drains in
 * the background. Failures are logged but never propagate to callers.
 */

type WriteTask = () => Promise<void>;

const queue: WriteTask[] = [];
let draining = false;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const task = queue.shift()!;
    try {
      await task();
    } catch (err) {
      console.error("[writeQueue] DB write failed:", err);
    }
  }
  draining = false;
}

/**
 * Enqueue a DB write. Returns immediately — the write happens asynchronously.
 * Order is preserved: tasks execute in the order they were enqueued.
 */
export function enqueueWrite(task: WriteTask): void {
  queue.push(task);
  // Kick off draining without awaiting — intentional fire-and-forget
  drain().catch((err) => console.error("[writeQueue] drain error:", err));
}
