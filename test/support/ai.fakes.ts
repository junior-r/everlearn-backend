import type {
  AcademicRecords,
  CourseGrades,
  CourseStanding,
  GroupAttendance,
  LLMEvent,
  LLMProvider,
  LLMRequest,
  StudentCourseRecord,
  SubjectSummary,
  TeacherCourse,
  TeachingRecords,
} from '../../src/modules/ai/domain/ports/assistant.ports.js';
import type { TaughtCourse, TimeRange } from '../../src/modules/ai/domain/teacher-hours.js';

interface StoredSubject extends SubjectSummary {
  institutionId: string;
  courses: TaughtCourse[];
}

interface StoredAttendance extends GroupAttendance {
  institutionId: string;
  groupId: string;
  /** The Teachers with a course in the group. */
  teacherMembershipIds: string[];
}

export class InMemoryTeachingRecords implements TeachingRecords {
  readonly subjects: StoredSubject[] = [];
  readonly teacherCourses: Array<TeacherCourse & { institutionId: string }> = [];
  readonly attendance: StoredAttendance[] = [];
  /** The months asked for, to check what a tool passed on. */
  readonly askedMonths: TimeRange[] = [];

  coursesTaughtBy(institutionId: string, teacherMembershipIds: string[]): Promise<TeacherCourse[]> {
    return Promise.resolve(
      this.teacherCourses
        .filter(
          (course) =>
            course.institutionId === institutionId && teacherMembershipIds.includes(course.teacherMembershipId),
        )
        .map(({ institutionId: _institutionId, ...course }) => course),
    );
  }

  attendanceIn(
    institutionId: string,
    groupId: string,
    teacherMembershipIds: string[],
  ): Promise<GroupAttendance | null> {
    const stored = this.attendance.find(
      (group) =>
        group.groupId === groupId &&
        group.institutionId === institutionId &&
        group.teacherMembershipIds.some((id) => teacherMembershipIds.includes(id)),
    );
    return Promise.resolve(
      stored ? { groupName: stored.groupName, classesHeld: stored.classesHeld, students: stored.students } : null,
    );
  }

  listSubjects(institutionId: string): Promise<SubjectSummary[]> {
    return Promise.resolve(
      this.subjects
        .filter((subject) => subject.institutionId === institutionId)
        .map(({ id, code, name }) => ({ id, code, name })),
    );
  }

  findTeaching(institutionId: string, subjectId: string, month: TimeRange) {
    this.askedMonths.push(month);
    const subject = this.subjects.find(
      (candidate) => candidate.id === subjectId && candidate.institutionId === institutionId,
    );
    return Promise.resolve(
      subject
        ? { subject: { id: subject.id, code: subject.code, name: subject.name }, courses: subject.courses }
        : null,
    );
  }
}

export class InMemoryAcademicRecords implements AcademicRecords {
  /** Courses by the Student membership that attends them. */
  readonly courses = new Map<string, StudentCourseRecord[]>();
  readonly asked: Array<{ institutionId: string; studentMembershipIds: string[] }> = [];

  coursesOf(institutionId: string, studentMembershipIds: string[]): Promise<StudentCourseRecord[]> {
    this.asked.push({ institutionId, studentMembershipIds });
    return Promise.resolve(studentMembershipIds.flatMap((id) => this.courses.get(id) ?? []));
  }
}

export class InMemoryCourseGrades implements CourseGrades {
  /** Standings by `groupId:subjectId`. */
  readonly standings = new Map<string, CourseStanding>();
  readonly asked: Array<{ teacherMembershipId: string; groupId: string; subjectId: string }> = [];

  standingOf(
    _institutionId: string,
    teacherMembershipId: string,
    course: { groupId: string; subjectId: string },
  ): Promise<CourseStanding> {
    this.asked.push({ teacherMembershipId, ...course });
    const standing = this.standings.get(`${course.groupId}:${course.subjectId}`);
    return standing ? Promise.resolve(standing) : Promise.reject(new Error('No such course'));
  }
}

/** A model that says exactly what the test scripted, one turn per call, and records what it was sent. */
export class ScriptedLLMProvider implements LLMProvider {
  readonly requests: LLMRequest[] = [];
  failWith: Error | null = null;

  constructor(private readonly turns: LLMEvent[][]) {}

  async *stream(request: LLMRequest): AsyncGenerator<LLMEvent> {
    // A copy: the use case keeps adding to the conversation it sent
    this.requests.push({ ...request, messages: [...request.messages] });
    await Promise.resolve();
    if (this.failWith) {
      throw this.failWith;
    }
    yield* this.turns[this.requests.length - 1] ?? [];
  }
}
