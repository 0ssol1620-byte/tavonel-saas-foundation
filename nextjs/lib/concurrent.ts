/**
 * Run work over a list with a ceiling on how much of it is in flight.
 *
 * The uploads this serves are browser-to-bucket PUTs. Sending them one at a time made a batch of
 * scans take as long as the sum of its parts and made the board look serial when the pipeline
 * behind it is not; sending them all at once would put dozens of transfers on a connection pool
 * that has about six slots per host, so they would queue anyway -- invisibly, and starving the
 * capability calls and the document poll that have to interleave with them.
 *
 * So there is a ceiling, and the results come back in input order regardless of finishing order,
 * because the caller reports on the batch and a reordered batch is a confusing report.
 *
 * A task that throws does not cancel the others. One scan failing is not a reason to abandon the
 * nineteen already in the bucket, and the caller needs to say which one failed.
 */

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export async function runBounded<I, O>(
  items: readonly I[],
  limit: number,
  run: (item: I, index: number) => Promise<O>,
): Promise<Settled<O>[]> {
  // NaN survives Math.max and Math.floor, and Array.from({length: NaN}) is empty -- which would
  // start no workers at all and return a list of holes. A ceiling that is not a number is one.
  const ceiling = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  const results = new Array<Settled<O>>(items.length);
  let next = 0;

  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = { ok: true, value: await run(items[index], index) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(ceiling, items.length) }, worker));
  return results;
}
