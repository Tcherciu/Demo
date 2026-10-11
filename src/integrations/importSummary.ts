import { formatDuration } from '../core/units';
import type { ImportOutcome, VerifyResult } from '../data/api';

/** One short message describing what happened to an imported run. */
export function describeImport(res: VerifyResult<ImportOutcome>): { title: string; body: string } {
  if (!res.ok) return { title: "Couldn't import this run", body: res.reason };
  const lines = res.matched.map((m) => {
    const note =
      m.status === 'upgraded' ? ' — replaced your phone time with this more accurate track'
      : m.status === 'duplicate' ? ' — already counted'
      : '';
    return `• ${m.routeName}: ${formatDuration(m.elapsedS)}${note}`;
  });
  if (res.matched.length) {
    return { title: res.matched.length === 1 ? 'Course matched' : `${res.matched.length} course runs matched`, body: lines.join('\n') };
  }
  if (res.createdRouteId) return { title: 'New route saved', body: "This run didn't match an existing course, so it's now one of your routes." };
  return {
    title: 'No course matched',
    body: "This run didn't follow an existing course from its start, and it's either under 3 miles or already saved as a route.",
  };
}
