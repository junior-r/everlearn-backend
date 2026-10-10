import { randomUUID } from 'node:crypto';
import {
  GroupInUseException,
  GroupNameTakenException,
  PeriodNameTakenException,
  StudentAlreadyEnrolledException,
  type AcademicPeriod,
  type Group,
  type GroupSummary,
  type InstitutionMember,
  type PersonRef,
} from '../../src/modules/academics/domain/entities/group.entities.js';
import type {
  GroupData,
  GroupRepository,
  MemberDirectory,
  PeriodData,
  PeriodRepository,
} from '../../src/modules/academics/domain/ports/group.repositories.js';
import type { Role } from '../../src/shared/domain/auth/role.js';
import type { InMemoryPensumRepository } from './admin.fakes.js';

export class InMemoryPeriodRepository implements PeriodRepository {
  readonly rows: AcademicPeriod[] = [];

  list(institutionId: string): Promise<AcademicPeriod[]> {
    return Promise.resolve(this.rows.filter((row) => row.institutionId === institutionId));
  }

  findById(institutionId: string, id: string): Promise<AcademicPeriod | null> {
    const row = this.rows.find(
      (candidate) => candidate.id === id && candidate.institutionId === institutionId,
    );
    return Promise.resolve(row ?? null);
  }

  create(institutionId: string, period: PeriodData): Promise<AcademicPeriod> {
    if (this.rows.some((row) => row.institutionId === institutionId && row.name === period.name)) {
      return Promise.reject(new PeriodNameTakenException());
    }
    const row = { id: randomUUID(), institutionId, ...period };
    this.rows.push(row);
    return Promise.resolve(row);
  }
}

export interface DirectoryEntry extends InstitutionMember {
  institutionId: string;
  firstName: string;
  lastName: string;
  email: string;
}

/** Active members by membership id. Tests add entries directly or point `lookup` at another fake. */
export class InMemoryMemberDirectory implements MemberDirectory {
  readonly entries = new Map<string, DirectoryEntry>();
  lookup: (institutionId: string, membershipId: string) => DirectoryEntry | null = (
    institutionId,
    membershipId,
  ) => {
    const entry = this.entries.get(membershipId);
    return entry?.institutionId === institutionId ? entry : null;
  };

  add(institutionId: string, role: Role, firstName = 'Ada', lastName = 'Lovelace'): DirectoryEntry {
    const entry: DirectoryEntry = {
      membershipId: randomUUID(),
      institutionId,
      role,
      firstName,
      lastName,
      email: `${firstName.toLowerCase()}@example.com`,
    };
    this.entries.set(entry.membershipId, entry);
    return entry;
  }

  findActiveMember(institutionId: string, membershipId: string): Promise<InstitutionMember | null> {
    const entry = this.lookup(institutionId, membershipId);
    return Promise.resolve(entry ? { membershipId: entry.membershipId, role: entry.role } : null);
  }

  /** Finds a member by membership id alone; replaceable together with `lookup`. */
  resolve: (membershipId: string) => DirectoryEntry | null = (membershipId) =>
    this.entries.get(membershipId) ?? null;

  /** Name details for a membership, as the database join would return them. */
  describe(membershipId: string): PersonRef & { email: string } {
    const entry = this.resolve(membershipId);
    return {
      membershipId,
      firstName: entry?.firstName ?? '',
      lastName: entry?.lastName ?? '',
      email: entry?.email ?? '',
    };
  }
}

interface StoredGroup extends GroupData {
  id: string;
  institutionId: string;
  teachers: Map<string, string>;
  studentIds: string[];
}

export class InMemoryGroupRepository implements GroupRepository {
  readonly rows: StoredGroup[] = [];
  /** Group ids that already have grades or attendance, which the database would refuse to delete. */
  readonly withRecords = new Set<string>();

  constructor(
    private readonly pensums: InMemoryPensumRepository,
    private readonly periods: InMemoryPeriodRepository,
    private readonly directory: InMemoryMemberDirectory,
  ) {}

  private find(institutionId: string, id: string) {
    return this.rows.find((row) => row.id === id && row.institutionId === institutionId);
  }

  private toSummary(row: StoredGroup): GroupSummary {
    const pensum = this.pensums.rows.find((candidate) => candidate.id === row.pensumId);
    const period = this.periods.rows.find((candidate) => candidate.id === row.periodId);
    return {
      id: row.id,
      institutionId: row.institutionId,
      name: row.name,
      level: row.level,
      capacity: row.capacity,
      pensum: {
        id: row.pensumId,
        code: pensum?.code ?? '',
        name: pensum?.name ?? '',
        version: pensum?.version ?? 1,
      },
      period: { id: row.periodId, name: period?.name ?? '' },
      studentCount: row.studentIds.length,
    };
  }

  private placements(row: StoredGroup) {
    const pensum = this.pensums.rows.find((candidate) => candidate.id === row.pensumId);
    return (pensum?.subjects ?? []).filter((subject) => subject.level === row.level);
  }

  private toGroup(row: StoredGroup): Group {
    return {
      ...this.toSummary(row),
      courses: this.placements(row).map((subject) => {
        const teacherId = row.teachers.get(subject.subjectId);
        const teacher = teacherId ? this.directory.describe(teacherId) : null;
        return {
          subjectId: subject.subjectId,
          code: subject.code,
          name: subject.name,
          weeklyHours: subject.weeklyHours,
          teacher: teacher && {
            membershipId: teacher.membershipId,
            firstName: teacher.firstName,
            lastName: teacher.lastName,
          },
        };
      }),
      students: row.studentIds.map((id) => this.directory.describe(id)),
    };
  }

  list(institutionId: string): Promise<GroupSummary[]> {
    return Promise.resolve(
      this.rows.filter((row) => row.institutionId === institutionId).map((row) => this.toSummary(row)),
    );
  }

  findById(institutionId: string, id: string): Promise<Group | null> {
    const row = this.find(institutionId, id);
    return Promise.resolve(row ? this.toGroup(row) : null);
  }

  create(institutionId: string, group: GroupData): Promise<Group> {
    if (this.rows.some((row) => row.periodId === group.periodId && row.name === group.name)) {
      return Promise.reject(new GroupNameTakenException());
    }
    const row: StoredGroup = {
      id: randomUUID(),
      institutionId,
      teachers: new Map(),
      studentIds: [],
      ...group,
    };
    this.rows.push(row);
    return Promise.resolve(this.toGroup(row));
  }

  delete(institutionId: string, id: string): Promise<boolean> {
    const row = this.find(institutionId, id);
    if (!row) {
      return Promise.resolve(false);
    }
    if (row.studentIds.length > 0 || this.withRecords.has(id)) {
      return Promise.reject(new GroupInUseException());
    }
    this.rows.splice(this.rows.indexOf(row), 1);
    return Promise.resolve(true);
  }

  assignTeacher(
    groupId: string,
    subjectId: string,
    teacherMembershipId: string | null,
  ): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === groupId);
    if (!row || !this.placements(row).some((subject) => subject.subjectId === subjectId)) {
      return Promise.resolve(false);
    }
    if (teacherMembershipId) {
      row.teachers.set(subjectId, teacherMembershipId);
    } else {
      row.teachers.delete(subjectId);
    }
    return Promise.resolve(true);
  }

  enroll(groupId: string, studentMembershipId: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === groupId);
    if (row?.studentIds.includes(studentMembershipId)) {
      return Promise.reject(new StudentAlreadyEnrolledException());
    }
    row?.studentIds.push(studentMembershipId);
    return Promise.resolve();
  }

  unenroll(groupId: string, studentMembershipId: string): Promise<boolean> {
    const row = this.rows.find((candidate) => candidate.id === groupId);
    const index = row?.studentIds.indexOf(studentMembershipId) ?? -1;
    if (!row || index < 0) {
      return Promise.resolve(false);
    }
    if (this.withRecords.has(groupId)) {
      return Promise.reject(new GroupInUseException());
    }
    row.studentIds.splice(index, 1);
    return Promise.resolve(true);
  }
}
