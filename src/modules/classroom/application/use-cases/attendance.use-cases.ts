import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import type { Notifier } from '../../../../shared/domain/notifications/notifier.js';
import {
  ClassroomRole,
  ClassSessionNotFoundException,
  NotCourseTeacherException,
  StudentNotInClassException,
  type AttendanceSheet,
  type ManualAttendanceMark,
} from '../../domain/classroom.js';
import type { AttendanceBook } from '../../domain/ports/classroom.ports.js';
import { absenceNotices } from '../attendance-notices.js';

/** Who is asking, and in which institution. */
export interface AttendanceActor {
  institutionId: string;
  memberships: MembershipClaim[];
}

/** The sheet of a class, for the Teacher assigned to its course and nobody else. */
async function sheetFor(book: AttendanceBook, actor: AttendanceActor, sessionId: string) {
  const sheet = await book.sheet(actor.institutionId, sessionId);
  if (!sheet) {
    throw new ClassSessionNotFoundException();
  }
  const teacher = actor.memberships.find(
    (membership) =>
      membership.institutionId === actor.institutionId &&
      membership.role === ClassroomRole.TEACHER &&
      membership.id === sheet.teacherMembershipId,
  );
  if (!teacher) {
    throw new NotCourseTeacherException();
  }
  return { sheet, teacherMembershipId: teacher.id };
}

export class GetSessionAttendanceUseCase {
  constructor(private readonly book: AttendanceBook) {}

  /** The enrolled Students of a class with the mark each has, if any. */
  async execute(actor: AttendanceActor, sessionId: string): Promise<AttendanceSheet['students']> {
    return (await sheetFor(this.book, actor, sessionId)).sheet.students;
  }
}

export class RecordAttendanceByHandUseCase {
  constructor(
    private readonly book: AttendanceBook,
    private readonly notifier: Notifier,
  ) {}

  /**
   * Stores the marks the Teacher gives the Students of their class; from then
   * on automatic attendance leaves them alone. The Guardians of a Student
   * newly marked absent or late are told, exactly as after a class closes.
   */
  async execute(
    actor: AttendanceActor,
    sessionId: string,
    marks: ManualAttendanceMark[],
  ): Promise<AttendanceSheet['students']> {
    const { sheet, teacherMembershipId } = await sheetFor(this.book, actor, sessionId);
    const enrolled = new Map(sheet.students.map((student) => [student.enrollmentId, student]));
    // The last mark for a Student wins, so a list with a repeat cannot store two answers
    const given = new Map(marks.map((mark) => [mark.enrollmentId, mark]));
    if ([...given.keys()].some((enrollmentId) => !enrolled.has(enrollmentId))) {
      throw new StudentNotInClassException();
    }
    await this.book.record(
      sessionId,
      teacherMembershipId,
      [...given.values()].map((mark) => ({ ...mark, note: mark.note?.trim() || null })),
    );
    await this.notifier.notify(
      absenceNotices(
        sessionId,
        sheet.course,
        sheet.startsAt,
        [...given.values()].flatMap(({ enrollmentId, status }) => {
          const student = enrolled.get(enrollmentId);
          // Confirming by hand a mark that already stood tells nobody again
          return student && student.status !== status ? [{ ...student, status }] : [];
        }),
      ),
    );
    return (await sheetFor(this.book, actor, sessionId)).sheet.students;
  }
}
