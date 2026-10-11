/** A Student counts as at risk below this share of the classes attended. */
export const ATTENDANCE_RISK_BELOW = 0.7;

/** How often one Student was marked each way in the classes of a Teacher's courses. */
export interface StudentAttendance {
  firstName: string;
  lastName: string;
  present: number;
  late: number;
  absent: number;
  excused: number;
}

export interface AttendanceAtRisk {
  name: string;
  attendedClasses: number;
  /** Classes that count: excused absences do not, for or against. */
  countedClasses: number;
  attendancePercent: number;
}

const percent = (share: number) => Math.round(share * 10000) / 100;

/**
 * The Students who attended less than 70% of the classes that count for them,
 * lowest first. Arriving late is attending; a Student with no class counted
 * yet is not at risk, there is simply nothing to say.
 */
export function attendanceRisk(students: ReadonlyArray<StudentAttendance>): {
  atRisk: AttendanceAtRisk[];
  studentsWithoutRecords: number;
} {
  const atRisk: AttendanceAtRisk[] = [];
  let studentsWithoutRecords = 0;
  for (const student of students) {
    const attended = student.present + student.late;
    const counted = attended + student.absent;
    if (counted === 0) {
      studentsWithoutRecords += 1;
    } else if (attended / counted < ATTENDANCE_RISK_BELOW) {
      atRisk.push({
        name: `${student.firstName} ${student.lastName}`,
        attendedClasses: attended,
        countedClasses: counted,
        attendancePercent: percent(attended / counted),
      });
    }
  }
  atRisk.sort((a, b) => a.attendancePercent - b.attendancePercent || a.name.localeCompare(b.name));
  return { atRisk, studentsWithoutRecords };
}

/** The mean of the averages of the Students who have one; null while nobody is graded. */
export function classAverage(averages: ReadonlyArray<number | null>): number | null {
  const graded = averages.filter((average): average is number => average !== null);
  return graded.length > 0
    ? Math.round((graded.reduce((sum, average) => sum + average, 0) / graded.length) * 100) / 100
    : null;
}
