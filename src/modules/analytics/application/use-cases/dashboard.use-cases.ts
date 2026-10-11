import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { attendanceRate, attendanceRisk } from '../../../attendance/domain/attendance-standing.js';
import {
  gradeDistribution,
  today,
  type InstitutionDashboard,
  type PlatformDashboard,
  type TeacherDashboard,
} from '../../domain/dashboards.js';
import type { CourseAverages, DashboardCache, DashboardQueries } from '../../domain/ports/analytics.ports.js';

type Clock = () => Date;

export class GetPlatformDashboardUseCase {
  constructor(
    private readonly queries: DashboardQueries,
    private readonly cache: DashboardCache,
    private readonly cacheSeconds: number,
  ) {}

  /** The platform in numbers. Counted across every institution, so the result is kept for a short while. */
  execute(): Promise<PlatformDashboard> {
    return this.cache.remember('platform', this.cacheSeconds, () => this.queries.platform());
  }
}

export class GetInstitutionDashboardUseCase {
  constructor(
    private readonly queries: DashboardQueries,
    private readonly cache: DashboardCache,
    private readonly cacheSeconds: number,
    private readonly now: Clock = () => new Date(),
  ) {}

  /** One institution in numbers, with its overall attendance rate. Kept for a short while, per institution. */
  execute(institutionId: string): Promise<InstitutionDashboard> {
    return this.cache.remember(`institution:${institutionId}`, this.cacheSeconds, async () => {
      const counts = await this.queries.institution(institutionId, today(this.now()));
      return { ...counts, attendanceRate: attendanceRate(counts.attendance) };
    });
  }
}

/** Who is asking, and in which institution. */
export interface TeacherActor {
  institutionId: string;
  memberships: MembershipClaim[];
}

export class GetTeacherDashboardUseCase {
  constructor(
    private readonly queries: DashboardQueries,
    private readonly averages: CourseAverages,
    private readonly now: Clock = () => new Date(),
  ) {}

  /**
   * A Teacher's own courses in numbers: what is left to publish, who is at risk
   * by attendance (the rule the assistant uses) and how the averages spread.
   * Everything is limited to the courses assigned to the Teacher.
   */
  async execute(actor: TeacherActor): Promise<TeacherDashboard> {
    const teacherIds = actor.memberships
      .filter(({ institutionId, role }) => institutionId === actor.institutionId && role === Role.TEACHER)
      .map(({ id }) => id);
    const day = today(this.now());
    const [courses, draftEvaluations, groups] = await Promise.all([
      this.queries.coursesOf(actor.institutionId, teacherIds, day),
      this.queries.draftEvaluations(actor.institutionId, teacherIds, day),
      this.queries.attendanceOf(actor.institutionId, teacherIds, day),
    ]);
    const averages = (
      await Promise.all(courses.map((course) => this.averages.averagesOf(actor.institutionId, course)))
    ).flat();
    return {
      activeCourses: courses.length,
      draftEvaluations,
      studentsAtRisk: groups
        .flatMap(({ groupName, students }) =>
          attendanceRisk(students).atRisk.map((student) => ({ ...student, group: groupName })),
        )
        .sort((a, b) => a.attendancePercent - b.attendancePercent || a.name.localeCompare(b.name)),
      gradeDistribution: gradeDistribution(averages),
      gradedAverages: averages.filter((average) => average !== null).length,
    };
  }
}
