import { Role } from '../../../shared/domain/auth/role.js';

/**
 * Whom a member may start a conversation with, inside their institution. The
 * relations (`ownStudents`, `ownTeachers`, `groupMates`) are looked up by the
 * repository; everything else is decided here, from roles alone.
 */
export interface Reach {
  /** No limit: every active member of the institution. */
  anyone: boolean;
  /** Members holding one of these roles, whoever they are. */
  roles: Role[];
  /** Students actively enrolled in a group the member teaches. */
  ownStudents: boolean;
  /** Teachers of a group the member is actively enrolled in. */
  ownTeachers: boolean;
  /** Students actively enrolled in a group the member is enrolled in too. */
  groupMates: boolean;
}

/** The people who run the institution: reachable by adults, and able to reach everyone. */
const OFFICE: Role[] = [Role.ADMIN, Role.COORDINATOR, Role.STAFF];

/**
 * The messaging rule, which exists to protect Students:
 * - Institution Admins, Principals and Staff may write to anyone.
 * - A Teacher may write to their own Students, to other Teachers and to the office.
 * - A Student may write only to their own Teachers and to Students of their groups.
 * - A Guardian may write only to the office.
 * Someone holding several roles gets what any of them allows.
 */
export function reachOf(roles: readonly Role[]): Reach {
  if (roles.some((role) => OFFICE.includes(role))) {
    return { anyone: true, roles: [], ownStudents: false, ownTeachers: false, groupMates: false };
  }
  const isTeacher = roles.includes(Role.TEACHER);
  const isStudent = roles.includes(Role.STUDENT);
  const open = new Set<Role>();
  if (isTeacher) {
    open.add(Role.TEACHER);
  }
  if (isTeacher || roles.includes(Role.GUARDIAN)) {
    OFFICE.forEach((role) => open.add(role));
  }
  return {
    anyone: false,
    roles: [...open],
    ownStudents: isTeacher,
    ownTeachers: isStudent,
    groupMates: isStudent,
  };
}
