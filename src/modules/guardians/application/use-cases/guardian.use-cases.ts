import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { attendanceRate } from '../../../attendance/domain/attendance-standing.js';
import {
  GuardianLinkNotFoundException,
  InvalidGuardianLinkException,
  RECENT_ATTENDANCE_LIMIT,
  UPCOMING_DAYS,
  WardNotFoundException,
  type GuardianLink,
  type GuardianRelationship,
  type Ward,
  type WardAttendance,
} from '../../domain/guardian.js';
import type {
  CourseStanding,
  GuardianRepository,
  ScheduledClass,
  UpcomingEvaluation,
  WardAcademics,
} from '../../domain/ports/guardian.ports.js';

const MS_PER_DAY = 86_400_000;

export class ListGuardianLinksUseCase {
  constructor(private readonly guardians: GuardianRepository) {}

  /** Every Guardian-Student link of the institution, for the office that keeps them. */
  execute(institutionId: string): Promise<GuardianLink[]> {
    return this.guardians.listLinks(institutionId);
  }
}

export interface LinkGuardianInput {
  institutionId: string;
  studentMembershipId: string;
  guardianMembershipId: string;
  relationship: GuardianRelationship;
}

export class LinkGuardianUseCase {
  constructor(private readonly guardians: GuardianRepository) {}

  /** Ties a Guardian to a Student of the same institution. Linking the same two again only updates the relationship. */
  async execute(input: LinkGuardianInput): Promise<GuardianLink> {
    const link = await this.guardians.link(
      input.institutionId,
      input.studentMembershipId,
      input.guardianMembershipId,
      input.relationship,
    );
    if (!link) {
      throw new InvalidGuardianLinkException();
    }
    return link;
  }
}

export class UnlinkGuardianUseCase {
  constructor(private readonly guardians: GuardianRepository) {}

  async execute(institutionId: string, linkId: string): Promise<void> {
    if (!(await this.guardians.unlink(institutionId, linkId))) {
      throw new GuardianLinkNotFoundException();
    }
  }
}

/** Who is asking, and in which institution. */
export interface GuardianActor {
  institutionId: string;
  memberships: MembershipClaim[];
}

const guardianIdsOf = (actor: GuardianActor) =>
  actor.memberships
    .filter(({ institutionId, role }) => institutionId === actor.institutionId && role === Role.GUARDIAN)
    .map(({ id }) => id);

export class ListMyWardsUseCase {
  constructor(private readonly guardians: GuardianRepository) {}

  /** The Students linked to the Guardian in the institution they are acting in. */
  execute(actor: GuardianActor): Promise<Ward[]> {
    return this.guardians.wardsOf(actor.institutionId, guardianIdsOf(actor));
  }
}

export interface WardOverview {
  ward: Ward;
  schedule: ScheduledClass[];
  courses: CourseStanding[];
  upcoming: UpcomingEvaluation[];
  attendance: WardAttendance & { rate: number | null };
}

export class GetWardOverviewUseCase {
  constructor(
    private readonly guardians: GuardianRepository,
    private readonly academics: WardAcademics,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * A linked Student as their Guardian may see them: weekly schedule, averages,
   * what is due in the coming days, and attendance. A Student who is not linked
   * to the Guardian looks exactly like one who does not exist.
   */
  async execute(actor: GuardianActor, studentMembershipId: string): Promise<WardOverview> {
    const wards = await this.guardians.wardsOf(actor.institutionId, guardianIdsOf(actor));
    const ward = wards.find((candidate) => candidate.membershipId === studentMembershipId);
    if (!ward) {
      throw new WardNotFoundException();
    }
    const from = this.now();
    const [schedule, courses, upcoming, attendance] = await Promise.all([
      this.academics.scheduleOf(
        actor.institutionId,
        ward.groups.map((group) => group.id),
      ),
      this.academics.coursesOf(actor.institutionId, ward.membershipId),
      this.academics.upcomingOf(
        actor.institutionId,
        ward.membershipId,
        from,
        new Date(from.getTime() + UPCOMING_DAYS * MS_PER_DAY),
      ),
      this.guardians.attendanceOf(ward.membershipId, RECENT_ATTENDANCE_LIMIT),
    ]);
    return {
      ward,
      schedule,
      courses,
      upcoming,
      // The same rule as everywhere else: late is attended, excused is left out
      attendance: { ...attendance, rate: attendanceRate(attendance.counts) },
    };
  }
}
