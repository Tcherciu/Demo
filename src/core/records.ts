export interface AttemptResult {
  userId: string;
  displayName?: string;
  elapsedS: number;
  /** Unix epoch ms. */
  finishedAt: number;
}

export interface CourseStats {
  completions: number;
  averageS: number | null;
  courseRecord: AttemptResult | null;
  personalBest: AttemptResult | null;
}

/** Stats over valid attempts only — invalid (paused/abandoned) attempts never reach here. */
export function courseStats(attempts: readonly AttemptResult[], userId: string | null): CourseStats {
  if (attempts.length === 0) {
    return { completions: 0, averageS: null, courseRecord: null, personalBest: null };
  }
  let sum = 0;
  let record: AttemptResult | null = null;
  let pb: AttemptResult | null = null;
  for (const a of attempts) {
    sum += a.elapsedS;
    if (isFaster(a, record)) record = a;
    if (a.userId === userId && isFaster(a, pb)) pb = a;
  }
  return { completions: attempts.length, averageS: sum / attempts.length, courseRecord: record, personalBest: pb };
}

/** Faster wins; on an exact tie, whoever set it first keeps it. */
function isFaster(a: AttemptResult, current: AttemptResult | null): boolean {
  if (!current) return true;
  return a.elapsedS < current.elapsedS || (a.elapsedS === current.elapsedS && a.finishedAt < current.finishedAt);
}

export type RecordOutcome = 'course_record' | 'personal_best' | 'none';

export function classifyResult(elapsedS: number, before: CourseStats): RecordOutcome {
  if (!before.courseRecord || elapsedS < before.courseRecord.elapsedS) return 'course_record';
  if (!before.personalBest || elapsedS < before.personalBest.elapsedS) return 'personal_best';
  return 'none';
}
