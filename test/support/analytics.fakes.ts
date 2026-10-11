import type { InstitutionCounts, PlatformDashboard } from '../../src/modules/analytics/domain/dashboards.js';
import type {
  AssignedCourse,
  CourseAverages,
  DashboardCache,
  DashboardQueries,
  GroupAttendance,
} from '../../src/modules/analytics/domain/ports/analytics.ports.js';

const NO_COUNTS: InstitutionCounts = {
  activeStudents: 0,
  teachers: 0,
  activeGroups: 0,
  pendingReviews: 0,
  attendance: { present: 0, late: 0, absent: 0, excused: 0 },
};

interface TeacherFigures {
  institutionId: string;
  teacherMembershipId: string;
  courses: Array<Omit<AssignedCourse, 'teacherMembershipId'>>;
  draftEvaluations: number;
  attendance: GroupAttendance[];
}

/** Dashboard figures a test sets by hand, and a record of what was asked for. */
export class InMemoryDashboardQueries implements DashboardQueries {
  platformFigures: PlatformDashboard = {
    activeInstitutions: 0,
    inactiveInstitutions: 0,
    totalUsers: 0,
    pendingReviews: 0,
    usersByStatus: { active: 0, pendingOnboarding: 0, suspended: 0 },
    largestInstitutions: [],
  };
  readonly institutions = new Map<string, InstitutionCounts>();
  readonly teachers: TeacherFigures[] = [];
  /** How many times each figure was counted, to see the cache at work. */
  readonly counted = { platform: 0, institution: 0 };
  readonly askedDays: Date[] = [];

  private of(institutionId: string, teacherMembershipIds: string[]): TeacherFigures[] {
    return this.teachers.filter(
      (figures) =>
        figures.institutionId === institutionId && teacherMembershipIds.includes(figures.teacherMembershipId),
    );
  }

  platform(): Promise<PlatformDashboard> {
    this.counted.platform += 1;
    return Promise.resolve(this.platformFigures);
  }

  institution(institutionId: string, day: Date): Promise<InstitutionCounts> {
    this.counted.institution += 1;
    this.askedDays.push(day);
    return Promise.resolve(this.institutions.get(institutionId) ?? NO_COUNTS);
  }

  coursesOf(institutionId: string, teacherMembershipIds: string[], day: Date): Promise<AssignedCourse[]> {
    this.askedDays.push(day);
    return Promise.resolve(
      this.of(institutionId, teacherMembershipIds).flatMap(({ courses, teacherMembershipId }) =>
        courses.map((course) => ({ ...course, teacherMembershipId })),
      ),
    );
  }

  draftEvaluations(institutionId: string, teacherMembershipIds: string[]): Promise<number> {
    return Promise.resolve(
      this.of(institutionId, teacherMembershipIds).reduce((total, figures) => total + figures.draftEvaluations, 0),
    );
  }

  attendanceOf(institutionId: string, teacherMembershipIds: string[]): Promise<GroupAttendance[]> {
    return Promise.resolve(this.of(institutionId, teacherMembershipIds).flatMap((figures) => figures.attendance));
  }
}

export class InMemoryCourseAverages implements CourseAverages {
  /** Averages by `groupId:subjectId`. */
  readonly averages = new Map<string, Array<number | null>>();
  readonly asked: AssignedCourse[] = [];

  averagesOf(_institutionId: string, course: AssignedCourse): Promise<Array<number | null>> {
    this.asked.push(course);
    return Promise.resolve(this.averages.get(`${course.groupId}:${course.subjectId}`) ?? []);
  }
}

/** Keeps values until the test clears them; the clock plays no part. */
export class InMemoryDashboardCache implements DashboardCache {
  readonly stored = new Map<string, unknown>();
  readonly ttls = new Map<string, number>();

  async remember<T>(key: string, ttlSeconds: number, load: () => Promise<T>): Promise<T> {
    if (ttlSeconds > 0 && this.stored.has(key)) {
      return this.stored.get(key) as T;
    }
    const value = await load();
    if (ttlSeconds > 0) {
      this.stored.set(key, value);
      this.ttls.set(key, ttlSeconds);
    }
    return value;
  }
}
