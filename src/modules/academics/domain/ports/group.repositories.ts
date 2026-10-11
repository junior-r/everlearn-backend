import type {
  AcademicPeriod,
  Group,
  GroupSummary,
  InstitutionMember,
} from '../entities/group.entities.js';

export const PERIOD_REPOSITORY = Symbol('PeriodRepository');
export const GROUP_REPOSITORY = Symbol('GroupRepository');
export const MEMBER_DIRECTORY = Symbol('MemberDirectory');

export type PeriodData = Pick<AcademicPeriod, 'name' | 'startDate' | 'endDate'>;

export interface GroupData {
  name: string;
  level: number;
  capacity: number | null;
  pensumId: string;
  periodId: string;
}

/** Like the other academic repositories, every method is scoped to one institution. */
export interface PeriodRepository {
  list(institutionId: string): Promise<AcademicPeriod[]>;
  findById(institutionId: string, id: string): Promise<AcademicPeriod | null>;
  create(institutionId: string, period: PeriodData): Promise<AcademicPeriod>;
}

export interface GroupRepository {
  list(institutionId: string): Promise<GroupSummary[]>;
  findById(institutionId: string, id: string): Promise<Group | null>;
  create(institutionId: string, group: GroupData): Promise<Group>;
  delete(institutionId: string, id: string): Promise<boolean>;
  /**
   * Sets (or with null, clears) who teaches a subject to the group, creating
   * the Course on first use. Resolves to false if the group's pensum does not
   * place that subject at the group's level.
   */
  assignTeacher(groupId: string, subjectId: string, teacherMembershipId: string | null): Promise<boolean>;
  /** Whether the group has classes scheduled for this subject. */
  courseHasSchedule(groupId: string, subjectId: string): Promise<boolean>;
  enroll(groupId: string, studentMembershipId: string): Promise<void>;
  unenroll(groupId: string, studentMembershipId: string): Promise<boolean>;
}

/** Read-only view of who belongs to an institution, owned by the identity module's tables. */
export interface MemberDirectory {
  /** Resolves to null unless the membership is active, in this institution, on an active account. */
  findActiveMember(institutionId: string, membershipId: string): Promise<InstitutionMember | null>;
}
