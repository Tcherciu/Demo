import { classifyResult, courseStats } from '../records.ts';

describe('records', () => {
  const attempts = [
    { userId: 'a', elapsedS: 1500, finishedAt: 3 },
    { userId: 'b', elapsedS: 1400, finishedAt: 2 },
    { userId: 'a', elapsedS: 1450, finishedAt: 1 },
    { userId: 'c', elapsedS: 1400, finishedAt: 5 },
  ];

  it('computes average, course record and personal best', () => {
    const s = courseStats(attempts, 'a');
    expect(s.completions).toBe(4);
    expect(s.averageS).toBe(1437.5);
    expect(s.courseRecord).toMatchObject({ userId: 'b', elapsedS: 1400 }); // tie → earliest
    expect(s.personalBest).toMatchObject({ userId: 'a', elapsedS: 1450 });
  });

  it('classifies a new result', () => {
    const s = courseStats(attempts, 'a');
    expect(classifyResult(1399, s)).toBe('course_record');
    expect(classifyResult(1420, s)).toBe('personal_best');
    expect(classifyResult(1460, s)).toBe('none');
    expect(classifyResult(9999, courseStats([], 'a'))).toBe('course_record');
  });
});
