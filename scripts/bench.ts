/** Shared timing helpers for the two benchmark scripts. */

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function report(label: string, timings: number[], failures: number) {
  const ms = (n: number) => `${n.toFixed(0)} ms`;
  console.log(`\n${label}`);
  console.log(`  runs      ${timings.length}${failures ? ` (${failures} failed)` : ''}`);
  if (timings.length === 0) return;
  const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
  console.log(`  median    ${ms(percentile(timings, 50))}`);
  console.log(`  mean      ${ms(mean)}`);
  console.log(`  p95       ${ms(percentile(timings, 95))}`);
  console.log(`  min/max   ${ms(Math.min(...timings))} / ${ms(Math.max(...timings))}`);
}

export async function timed<T>(fn: () => Promise<T>): Promise<[number, T]> {
  const start = performance.now();
  const value = await fn();
  return [performance.now() - start, value];
}
