import type { Role } from '../../../../shared/domain/auth/role.js';
import { DomainException } from '../../../../shared/domain/domain.exception.js';

/** A school term. Dates are ISO calendar dates (YYYY-MM-DD). */
export interface AcademicPeriod {
  id: string;
  institutionId: string;
  name: string;
  startDate: string;
  endDate: string;
}

export interface GroupSummary {
  id: string;
  institutionId: string;
  name: string;
  level: number;
  capacity: number | null;
  pensum: { id: string; code: string; name: string; version: number };
  period: { id: string; name: string };
  studentCount: number;
}

export interface PersonRef {
  membershipId: string;
  firstName: string;
  lastName: string;
}

/** One subject the group takes: every subject its pensum places at the group's level. */
export interface GroupCourse {
  subjectId: string;
  code: string;
  name: string;
  weeklyHours: number;
  teacher: PersonRef | null;
}

/** A class: students following one pensum level together during one period. */
export interface Group extends GroupSummary {
  courses: GroupCourse[];
  students: Array<PersonRef & { email: string }>;
}

/** An active member of an institution, as the academics module needs to know them. */
export interface InstitutionMember {
  membershipId: string;
  role: Role;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    ISO_DATE.test(value) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** A period needs two real calendar dates, with the end after the start. */
export function assertValidPeriodDates(startDate: string, endDate: string): void {
  // ISO calendar dates sort as strings
  if (!isRealDate(startDate) || !isRealDate(endDate) || endDate <= startDate) {
    throw new InvalidPeriodDatesException();
  }
}

export function isFull(group: Group): boolean {
  return group.capacity !== null && group.students.length >= group.capacity;
}

export class InvalidPeriodDatesException extends DomainException {
  constructor() {
    super('VALIDATION', 'INVALID_PERIOD_DATES', 'The period must end after it starts');
  }
}

export class PeriodNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'PERIOD_NOT_FOUND', 'Academic period not found');
  }
}

export class PeriodNameTakenException extends DomainException {
  constructor() {
    super('CONFLICT', 'PERIOD_NAME_TAKEN', 'Another period already has this name');
  }
}

export class GroupNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'GROUP_NOT_FOUND', 'Group not found');
  }
}

export class GroupNameTakenException extends DomainException {
  constructor() {
    super('CONFLICT', 'GROUP_NAME_TAKEN', 'Another group in this period already has this name');
  }
}

export class GroupInUseException extends DomainException {
  constructor() {
    super('CONFLICT', 'GROUP_IN_USE', 'The group has students or records and cannot be changed this way');
  }
}

export class GroupFullException extends DomainException {
  constructor() {
    super('CONFLICT', 'GROUP_FULL', 'The group has reached its capacity');
  }
}

export class SubjectNotInGroupException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'SUBJECT_NOT_IN_GROUP', "The subject is not part of this group's pensum level");
  }
}

export class TeacherNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'TEACHER_NOT_FOUND', 'No active Teacher with this id in the institution');
  }
}

export class StudentNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'STUDENT_NOT_FOUND', 'No active Student with this id in the institution');
  }
}

export class StudentAlreadyEnrolledException extends DomainException {
  constructor() {
    super('CONFLICT', 'STUDENT_ALREADY_ENROLLED', 'The student is already in this group');
  }
}

export class CourseHasScheduleException extends DomainException {
  constructor() {
    super(
      'CONFLICT',
      'COURSE_HAS_SCHEDULE',
      'Remove the classes scheduled for this subject before changing its teacher',
    );
  }
}
