/** A Student counts as at risk below this share of the classes attended. */
export const ATTENDANCE_RISK_BELOW = 0.7;

/** How often attendance was marked each way. */
export interface AttendanceCounts {
  present: number;
  late: number;
  absent: number;
  excused: number;
}

/** The marks of one Student. */
export interface StudentAttendance extends AttendanceCounts {
  firstName: string;
  lastName: string;
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
 * The share of the classes that count which were attended, as a percentage.
 * Arriving late is attending; excused absences are left out. Null while
 * nothing counts yet.
 */
export function attendanceRate(counts: AttendanceCounts): number | null {
  const attended = counts.present + counts.late;
  const counted = attended + counts.absent;
  return counted > 0 ? percent(attended / counted) : null;
}

/**
 * The Students who attended less than 70% of the classes that count for them,
 * lowest first. A Student with no class counted yet is not at risk, there is
 * simply nothing to say.
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
