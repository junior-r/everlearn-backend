/** The mean of the averages of the Students who have one; null while nobody is graded. */
export function classAverage(averages: ReadonlyArray<number | null>): number | null {
  const graded = averages.filter((average): average is number => average !== null);
  return graded.length > 0
    ? Math.round((graded.reduce((sum, average) => sum + average, 0) / graded.length) * 100) / 100
    : null;
}
