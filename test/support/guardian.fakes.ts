import { randomUUID } from 'node:crypto';
import type {
  GuardianLink,
  GuardianRelationship,
  PersonName,
  Ward,
  WardAttendance,
} from '../../src/modules/guardians/domain/guardian.js';
import type {
  CourseStanding,
  GuardianRepository,
  ScheduledClass,
  UpcomingEvaluation,
  WardAcademics,
} from '../../src/modules/guardians/domain/ports/guardian.ports.js';

interface KnownMember extends PersonName {
  institutionId: string;
  role: string;
}

const NO_ATTENDANCE: WardAttendance = { counts: { present: 0, late: 0, absent: 0, excused: 0 }, recent: [] };

/** Links kept in memory. Members and their groups are told to it, or looked up through the hooks. */
export class InMemoryGuardianRepository implements GuardianRepository {
  readonly links: Array<{ id: string; institutionId: string; studentId: string; guardianId: string; relationship: GuardianRelationship }> = [];
  readonly members: KnownMember[] = [];
  /** Student membership id → the groups they are actively enrolled in. */
  readonly groups = new Map<string, Array<{ id: string; name: string }>>();
  readonly attendance = new Map<string, WardAttendance>();
  /** Stand in for the joins the Prisma adapter does on memberships and enrollments. */
  lookupMember: (membershipId: string) => KnownMember | undefined = (id) =>
    this.members.find((member) => member.membershipId === id);
  lookupGroups: (studentMembershipId: string) => Array<{ id: string; name: string }> = (id) =>
    this.groups.get(id) ?? [];

  private name(membershipId: string): PersonName {
    const member = this.lookupMember(membershipId);
    return { membershipId, firstName: member?.firstName ?? '', lastName: member?.lastName ?? '' };
  }

  private view(link: (typeof this.links)[number]): GuardianLink {
    return {
      id: link.id,
      student: this.name(link.studentId),
      guardian: this.name(link.guardianId),
      relationship: link.relationship,
    };
  }

  listLinks(institutionId: string): Promise<GuardianLink[]> {
    return Promise.resolve(
      this.links.filter((link) => link.institutionId === institutionId).map((link) => this.view(link)),
    );
  }

  link(
    institutionId: string,
    studentMembershipId: string,
    guardianMembershipId: string,
    relationship: GuardianRelationship,
  ): Promise<GuardianLink | null> {
    const holds = (membershipId: string, role: string) => {
      const member = this.lookupMember(membershipId);
      return member?.institutionId === institutionId && member.role === role;
    };
    if (!holds(studentMembershipId, 'STUDENT') || !holds(guardianMembershipId, 'GUARDIAN')) {
      return Promise.resolve(null);
    }
    let link = this.links.find(
      (candidate) => candidate.studentId === studentMembershipId && candidate.guardianId === guardianMembershipId,
    );
    if (link) {
      link.relationship = relationship;
    } else {
      link = {
        id: randomUUID(),
        institutionId,
        studentId: studentMembershipId,
        guardianId: guardianMembershipId,
        relationship,
      };
      this.links.push(link);
    }
    return Promise.resolve(this.view(link));
  }

  unlink(institutionId: string, linkId: string): Promise<boolean> {
    const index = this.links.findIndex((link) => link.id === linkId && link.institutionId === institutionId);
    if (index >= 0) {
      this.links.splice(index, 1);
    }
    return Promise.resolve(index >= 0);
  }

  wardsOf(institutionId: string, guardianMembershipIds: string[]): Promise<Ward[]> {
    return Promise.resolve(
      this.links
        .filter((link) => link.institutionId === institutionId && guardianMembershipIds.includes(link.guardianId))
        .map((link) => ({
          ...this.name(link.studentId),
          relationship: link.relationship,
          groups: this.lookupGroups(link.studentId),
        })),
    );
  }

  attendanceOf(studentMembershipId: string, recentLimit: number): Promise<WardAttendance> {
    const stored = this.attendance.get(studentMembershipId) ?? NO_ATTENDANCE;
    return Promise.resolve({ ...stored, recent: stored.recent.slice(0, recentLimit) });
  }
}

/** A ward's studies set by hand, with a record of what was asked for. */
export class InMemoryWardAcademics implements WardAcademics {
  readonly schedules = new Map<string, ScheduledClass[]>();
  readonly courses = new Map<string, CourseStanding[]>();
  readonly upcoming = new Map<string, UpcomingEvaluation[]>();
  readonly asked: Array<{ what: string; id: string; from?: Date; to?: Date }> = [];

  scheduleOf(_institutionId: string, groupIds: string[]): Promise<ScheduledClass[]> {
    groupIds.forEach((id) => this.asked.push({ what: 'schedule', id }));
    return Promise.resolve(groupIds.flatMap((id) => this.schedules.get(id) ?? []));
  }

  coursesOf(_institutionId: string, studentMembershipId: string): Promise<CourseStanding[]> {
    this.asked.push({ what: 'courses', id: studentMembershipId });
    return Promise.resolve(this.courses.get(studentMembershipId) ?? []);
  }

  upcomingOf(_institutionId: string, studentMembershipId: string, from: Date, to: Date): Promise<UpcomingEvaluation[]> {
    this.asked.push({ what: 'upcoming', id: studentMembershipId, from, to });
    return Promise.resolve(this.upcoming.get(studentMembershipId) ?? []);
  }
}
