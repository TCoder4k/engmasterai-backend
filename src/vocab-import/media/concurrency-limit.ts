// Minimal in-house concurrency limiter — no new dependency for something
// this small (approved plan's "no other new runtime deps" constraint).
export function createLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    if (queue.length === 0 || active >= maxConcurrent) return;
    active++;
    const run = queue.shift()!;
    run();
  };

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
