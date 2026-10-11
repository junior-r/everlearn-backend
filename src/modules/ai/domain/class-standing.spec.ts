import { classAverage } from './class-standing.js';

describe('classAverage', () => {
  it('is the mean of the Students who have an average', () => {
    expect(classAverage([80, 70, null])).toBe(75);
    expect(classAverage([77.5, 60, 61])).toBe(66.17);
  });

  it('is null while nobody is graded', () => {
    expect(classAverage([null, null])).toBeNull();
    expect(classAverage([])).toBeNull();
  });
});
