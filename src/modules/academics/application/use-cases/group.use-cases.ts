import { Role } from '../../../../shared/domain/auth/role.js';
import {
  assertValidPeriodDates,
  GroupFullException,
  GroupNotFoundException,
  isFull,
  PeriodNotFoundException,
  StudentNotFoundException,
  SubjectNotInGroupException,
  TeacherNotFoundException,
  type AcademicPeriod,
  type Group,
  type GroupSummary,
} from '../../domain/entities/group.entities.js';
import { PensumNotFoundException } from '../../domain/exceptions/academic.exceptions.js';
import type { PensumRepository } from '../../domain/ports/academic.repositories.js';
import type {
  GroupRepository,
  MemberDirectory,
  PeriodData,
  PeriodRepository,
} from '../../domain/ports/group.repositories.js';

export class ListPeriodsUseCase {
  constructor(private readonly periods: PeriodRepository) {}

  execute(institutionId: string): Promise<AcademicPeriod[]> {
    return this.periods.list(institutionId);
  }
}

export class CreatePeriodUseCase {
  constructor(private readonly periods: PeriodRepository) {}

  async execute(institutionId: string, input: PeriodData): Promise<AcademicPeriod> {
    assertValidPeriodDates(input.startDate, input.endDate);
    return this.periods.create(institutionId, { ...input, name: input.name.trim() });
  }
}

async function requireGroup(
  groups: GroupRepository,
  institutionId: string,
  groupId: string,
): Promise<Group> {
  const group = await groups.findById(institutionId, groupId);
  if (!group) {
    throw new GroupNotFoundException();
  }
  return group;
}

export class ListGroupsUseCase {
  constructor(private readonly groups: GroupRepository) {}

  execute(institutionId: string): Promise<GroupSummary[]> {
    return this.groups.list(institutionId);
  }
}

export class GetGroupUseCase {
  constructor(private readonly groups: GroupRepository) {}

  execute(institutionId: string, groupId: string): Promise<Group> {
    return requireGroup(this.groups, institutionId, groupId);
  }
}

export interface CreateGroupInput {
  name: string;
  level: number;
  capacity?: number | null;
  pensumId: string;
  periodId: string;
}

export class CreateGroupUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly pensums: PensumRepository,
    private readonly periods: PeriodRepository,
  ) {}

  /** The pensum and period must both belong to the acting institution, so a group never spans tenants. */
  async execute(institutionId: string, input: CreateGroupInput): Promise<Group> {
    if (!(await this.pensums.findById(institutionId, input.pensumId))) {
      throw new PensumNotFoundException();
    }
    if (!(await this.periods.findById(institutionId, input.periodId))) {
      throw new PeriodNotFoundException();
    }
    return this.groups.create(institutionId, {
      name: input.name.trim(),
      level: input.level,
      capacity: input.capacity ?? null,
      pensumId: input.pensumId,
      periodId: input.periodId,
    });
  }
}

export class DeleteGroupUseCase {
  constructor(private readonly groups: GroupRepository) {}

  async execute(institutionId: string, groupId: string): Promise<void> {
    if (!(await this.groups.delete(institutionId, groupId))) {
      throw new GroupNotFoundException();
    }
  }
}

export class AssignCourseTeacherUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly members: MemberDirectory,
  ) {}

  /** Makes an active Teacher of the institution responsible for one subject of the group; null clears it. */
  async execute(
    institutionId: string,
    groupId: string,
    subjectId: string,
    teacherMembershipId: string | null,
  ): Promise<Group> {
    await requireGroup(this.groups, institutionId, groupId);
    if (teacherMembershipId !== null) {
      const member = await this.members.findActiveMember(institutionId, teacherMembershipId);
      if (member?.role !== Role.TEACHER) {
        throw new TeacherNotFoundException();
      }
    }
    if (!(await this.groups.assignTeacher(groupId, subjectId, teacherMembershipId))) {
      throw new SubjectNotInGroupException();
    }
    return requireGroup(this.groups, institutionId, groupId);
  }
}

export class EnrollStudentUseCase {
  constructor(
    private readonly groups: GroupRepository,
    private readonly members: MemberDirectory,
  ) {}

  /** Adds an active Student of the institution to the group, while it has room. */
  async execute(institutionId: string, groupId: string, studentMembershipId: string): Promise<Group> {
    const group = await requireGroup(this.groups, institutionId, groupId);
    const member = await this.members.findActiveMember(institutionId, studentMembershipId);
    if (member?.role !== Role.STUDENT) {
      throw new StudentNotFoundException();
    }
    if (isFull(group)) {
      throw new GroupFullException();
    }
    await this.groups.enroll(groupId, studentMembershipId);
    return requireGroup(this.groups, institutionId, groupId);
  }
}

export class UnenrollStudentUseCase {
  constructor(private readonly groups: GroupRepository) {}

  async execute(institutionId: string, groupId: string, studentMembershipId: string): Promise<Group> {
    await requireGroup(this.groups, institutionId, groupId);
    if (!(await this.groups.unenroll(groupId, studentMembershipId))) {
      throw new StudentNotFoundException();
    }
    return requireGroup(this.groups, institutionId, groupId);
  }
}
