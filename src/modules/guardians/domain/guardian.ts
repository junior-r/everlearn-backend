import { DomainException } from '../../../shared/domain/domain.exception.js';
import type { AttendanceCounts } from '../../attendance/domain/attendance-standing.js';

export const GuardianRelationship = {
  MOTHER: 'MOTHER',
  FATHER: 'FATHER',
  LEGAL_GUARDIAN: 'LEGAL_GUARDIAN',
  GRANDPARENT: 'GRANDPARENT',
  SIBLING: 'SIBLING',
  OTHER: 'OTHER',
} as const;
export type GuardianRelationship = (typeof GuardianRelationship)[keyof typeof GuardianRelationship];

/** How many attendance records of a ward a Guardian is shown. */
export const RECENT_ATTENDANCE_LIMIT = 10;
/** How far ahead a ward's upcoming evaluations are listed, in days. */
export const UPCOMING_DAYS = 30;

export interface PersonName {
  membershipId: string;
  firstName: string;
  lastName: string;
}

/** A Guardian tied to a Student of the same institution, as the office records it. */
export interface GuardianLink {
  id: string;
  student: PersonName;
  guardian: PersonName;
  relationship: GuardianRelationship;
}

/** A Student a Guardian answers for, with the groups they are actively enrolled in. */
export interface Ward extends PersonName {
  relationship: GuardianRelationship;
  groups: Array<{ id: string; name: string }>;
}

export interface AttendanceEntry {
  date: Date;
  subjectName: string;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';
}

export interface WardAttendance {
  counts: AttendanceCounts;
  /** The latest records, newest first. */
  recent: AttendanceEntry[];
}

export class WardNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'WARD_NOT_FOUND', 'Student not found');
  }
}

export class GuardianLinkNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'GUARDIAN_LINK_NOT_FOUND', 'That link does not exist');
  }
}

export class InvalidGuardianLinkException extends DomainException {
  constructor() {
    super(
      'VALIDATION',
      'INVALID_GUARDIAN_LINK',
      'A link joins a Guardian and a Student who both belong to this institution',
    );
  }
}
