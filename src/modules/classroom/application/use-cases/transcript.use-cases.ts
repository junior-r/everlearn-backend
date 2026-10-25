import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import {
  ClassSessionNotFoundException,
  CourseNotFoundException,
  MAX_LISTED_SESSIONS,
  type ClassTranscript,
  type CourseTranscripts,
} from '../../domain/classroom.js';
import type { ClassroomRepository, TranscriptArchive } from '../../domain/ports/classroom.ports.js';
import { classroomMemberships, participantOf, type StartClassSessionInput } from './classroom.use-cases.js';

export class ListCourseTranscriptsUseCase {
  constructor(
    private readonly classroom: ClassroomRepository,
    private readonly archive: TranscriptArchive,
  ) {}

  /** The classes of a course that have a transcript, for its Teacher and the Students of its group; anyone else finds no course. */
  async execute(input: StartClassSessionInput): Promise<CourseTranscripts> {
    const course = await this.classroom.findCourse(input.institutionId, input.groupId, input.subjectId);
    const memberships = classroomMemberships(input.memberships, input.institutionId);
    if (!course || !(await participantOf(this.classroom, { ...course, groupId: input.groupId }, memberships))) {
      throw new CourseNotFoundException();
    }
    return {
      subjectName: course.subjectName,
      groupName: course.groupName,
      sessions: await this.archive.transcribedSessions(course.courseId, MAX_LISTED_SESSIONS),
    };
  }
}

export class GetClassTranscriptUseCase {
  constructor(
    private readonly classroom: ClassroomRepository,
    private readonly archive: TranscriptArchive,
  ) {}

  /** What was said in a class, for its Teacher and the Students of its group; anyone else finds no class. */
  async execute(institutionId: string, memberships: MembershipClaim[], sessionId: string): Promise<ClassTranscript> {
    const session = await this.classroom.findSession(institutionId, sessionId);
    if (!session || !(await participantOf(this.classroom, session, classroomMemberships(memberships, institutionId)))) {
      throw new ClassSessionNotFoundException();
    }
    return {
      sessionId: session.sessionId,
      subjectName: session.subjectName,
      groupName: session.groupName,
      startsAt: session.startsAt,
      lines: await this.archive.lines(session.sessionId),
    };
  }
}
