import type { AttendanceAtRisk, AttendanceCounts } from '../../attendance/domain/attendance-standing.js';

/** What a Platform Admin sees of the whole platform. */
export interface PlatformDashboard {
  activeInstitutions: number;
  inactiveInstitutions: number;
  totalUsers: number;
  /** ID documents waiting for a decision, in every institution. */
  pendingReviews: number;
  usersByStatus: { active: number; pendingOnboarding: number; suspended: number };
  /** The active institutions with most active members, largest first. */
  largestInstitutions: Array<{ id: string; name: string; members: number }>;
}

/** The figures of one institution, before the attendance rate is worked out. */
export interface InstitutionCounts {
  activeStudents: number;
  teachers: number;
  /** Groups of an academic period that is running today. */
  activeGroups: number;
  pendingReviews: number;
  attendance: AttendanceCounts;
}

export interface InstitutionDashboard extends InstitutionCounts {
  /** Percent of the counted classes that were attended; null while there are no records. */
  attendanceRate: number | null;
}

/** How many Students' averages fall in a band of the 0 to 100 scale; `to` is inclusive. */
export interface GradeBand {
  from: number;
  to: number;
  students: number;
}

export interface StudentAtRisk extends AttendanceAtRisk {
  group: string;
}

export interface TeacherDashboard {
  /** Courses assigned to the Teacher in an academic period that is running today. */
  activeCourses: number;
  /** Evaluations of those courses still to be published. */
  draftEvaluations: number;
  studentsAtRisk: StudentAtRisk[];
  gradeDistribution: GradeBand[];
  /** Averages counted in the distribution: one per Student and course with a grade. */
  gradedAverages: number;
}

const BAND_STARTS = [0, 60, 70, 80, 90];

/** Sorts averages (percentages) into bands: below 60, the sixties, seventies, eighties, and 90 to 100. */
export function gradeDistribution(averages: ReadonlyArray<number | null>): GradeBand[] {
  const bands = BAND_STARTS.map((from, index) => ({
    from,
    to: index + 1 < BAND_STARTS.length ? BAND_STARTS[index + 1] - 1 : 100,
    students: 0,
  }));
  for (const average of averages) {
    if (average !== null) {
      // The last band whose start the average reaches; 100 belongs to the top one
      const band = bands.findLast(({ from }) => average >= from) ?? bands[0];
      band.students += 1;
    }
  }
  return bands;
}

/** The UTC date `now` falls on, as academic periods store their first and last day. */
export function today(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
