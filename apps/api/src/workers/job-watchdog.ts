/** An idle queue is allowed to wait indefinitely. A stuck execution requires a
 * process restart: abandoning a Promise does not cancel its provider requests. */
export async function withJobWatchdog<T>(
  operation: (started: () => void) => Promise<T>,
  timeoutMs: number,
  onTimeout: () => void
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await operation(() => {
      if (timer) return;
      timer = setTimeout(onTimeout, timeoutMs);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
