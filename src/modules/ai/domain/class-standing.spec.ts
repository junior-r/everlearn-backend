import { attendanceRisk, classAverage, type StudentAttendance } from './class-standing.js';

const student = (firstName: string, marks: Partial<StudentAttendance> = {}): StudentAttendance => ({
  firstName,
  lastName: 'Prueba',
  present: 0,
  late: 0,
  absent: 0,
  excused: 0,
  ...marks,
});

describe('attendanceRisk', () => {
  it('lists the Students below 70%, lowest first', () => {
    const { atRisk } = attendanceRisk([
      student('Grace', { present: 9, absent: 1 }),
      student('Linus', { present: 6, absent: 4 }),
      student('Ada', { present: 1, absent: 3 }),
    ]);

    expect(atRisk).toEqual([
      { name: 'Ada Prueba', attendedClasses: 1, countedClasses: 4, attendancePercent: 25 },
      { name: 'Linus Prueba', attendedClasses: 6, countedClasses: 10, attendancePercent: 60 },
    ]);
  });

  it('does not flag exactly 70%, and does flag just under it', () => {
    const { atRisk } = attendanceRisk([
      student('Grace', { present: 7, absent: 3 }),
      student('Linus', { present: 69, absent: 31 }),
    ]);

    expect(atRisk.map(({ name }) => name)).toEqual(['Linus Prueba']);
  });

  it('counts arriving late as attending, and leaves excused absences out', () => {
    const { atRisk } = attendanceRisk([
      student('Grace', { late: 7, absent: 3 }),
      // 2 of 2 counted classes: the eight excused ones say nothing
      student('Linus', { present: 2, excused: 8 }),
      // 1 of 3 counted
      student('Ada', { present: 1, absent: 2, excused: 7 }),
    ]);

    expect(atRisk).toEqual([
      { name: 'Ada Prueba', attendedClasses: 1, countedClasses: 3, attendancePercent: 33.33 },
    ]);
  });

  it('reports Students with nothing counted apart, instead of calling them at risk', () => {
    expect(attendanceRisk([student('Grace'), student('Linus', { excused: 3 })])).toEqual({
      atRisk: [],
      studentsWithoutRecords: 2,
    });
  });
});

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
