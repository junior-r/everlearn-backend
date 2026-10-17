import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import {
  ClassNotHeldYetException,
  ClassroomRole,
  ClassSessionClosedException,
  ClassSessionNotFoundException,
  CourseNotFoundException,
  DEFAULT_SESSION_MINUTES,
  isOpen,
  MAX_LISTED_SESSIONS,
  NotClassParticipantException,
  NotCourseTeacherException,
  roomNameFor,
  type ClassroomCourse,
  type CourseSessions,
  type SessionAccess,
  type TeachableCourse,
} from '../../domain/classroom.js';
import type { AvailableLabs } from '../../../../shared/domain/labs/available-labs.js';
import type { ClassroomRepository, VideoTokenIssuer } from '../../domain/ports/classroom.ports.js';

const MS_PER_MINUTE = 60_000;

/** The memberships through which someone can give or attend classes in one institution. */
function classroomMemberships(memberships: MembershipClaim[], institutionId: string) {
  return memberships.flatMap((membership) =>
    membership.institutionId === institutionId &&
    (membership.role === ClassroomRole.TEACHER || membership.role === ClassroomRole.STUDENT)
      ? [{ id: membership.id, role: membership.role }]
      : [],
  );
}

export class ListMyCoursesUseCase {
  constructor(private readonly classroom: ClassroomRepository) {}

  /** The subjects the member teaches and attends in the institution, with the class in progress of each. */
  async execute(institutionId: string, memberships: MembershipClaim[]): Promise<ClassroomCourse[]> {
    const lists = await Promise.all(
      classroomMemberships(memberships, institutionId).map((membership) =>
        this.classroom.listCourses(institutionId, membership.id, membership.role),
      ),
    );
    return lists.flat();
  }
}

export interface StartClassSessionInput {
  institutionId: string;
  memberships: MembershipClaim[];
  groupId: string;
  subjectId: string;
}

/** The course of a group's subject, for the Teacher assigned to it and nobody else. */
async function courseTaughtBy(classroom: ClassroomRepository, input: StartClassSessionInput): Promise<TeachableCourse> {
  const course = await classroom.findCourse(input.institutionId, input.groupId, input.subjectId);
  if (!course) {
    throw new CourseNotFoundException();
  }
  const teaches = classroomMemberships(input.memberships, input.institutionId).some(
    (membership) => membership.role === ClassroomRole.TEACHER && membership.id === course.teacherMembershipId,
  );
  if (!teaches) {
    throw new NotCourseTeacherException();
  }
  return course;
}

export class StartClassSessionUseCase {
  constructor(private readonly classroom: ClassroomRepository) {}

  /**
   * Opens a class for a subject of a group; only its assigned Teacher may.
   * Starting again while a class is open resolves to that same session.
   */
  async execute(input: StartClassSessionInput, now = new Date()): Promise<{ sessionId: string }> {
    const course = await courseTaughtBy(this.classroom, input);
    const open = await this.classroom.findOpenSessionId(course.courseId);
    if (open) {
      return { sessionId: open };
    }
    const endsAt = new Date(now.getTime() + DEFAULT_SESSION_MINUTES * MS_PER_MINUTE);
    return { sessionId: await this.classroom.createSession(course.courseId, now, endsAt) };
  }
}

export class ListCourseSessionsUseCase {
  constructor(private readonly classroom: ClassroomRepository) {}

  /** The latest classes of a course, for its Teacher to take or correct their attendance. */
  async execute(input: StartClassSessionInput): Promise<CourseSessions> {
    const course = await courseTaughtBy(this.classroom, input);
    return {
      subjectName: course.subjectName,
      groupName: course.groupName,
      sessions: await this.classroom.listSessions(course.courseId, MAX_LISTED_SESSIONS),
    };
  }
}

export class RecordHeldClassUseCase {
  constructor(private readonly classroom: ClassroomRepository) {}

  /**
   * Records a class its Teacher gave without video, so its attendance can be
   * taken by hand. It is stored as already over: nobody can enter it.
   */
  async execute(input: StartClassSessionInput, startsAt: Date, now = new Date()): Promise<{ sessionId: string }> {
    const course = await courseTaughtBy(this.classroom, input);
    if (startsAt.getTime() > now.getTime()) {
      throw new ClassNotHeldYetException();
    }
    const endsAt = new Date(startsAt.getTime() + DEFAULT_SESSION_MINUTES * MS_PER_MINUTE);
    return { sessionId: await this.classroom.createHeldSession(course.courseId, startsAt, endsAt) };
  }
}

export interface ClassroomAccess {
  token: string;
  roomName: string;
  /** The participant's Membership id, as the video server knows them. */
  identity: string;
  role: ClassroomRole;
  subjectName: string;
  groupName: string;
}

export class IssueClassroomTokenUseCase {
  constructor(
    private readonly classroom: ClassroomRepository,
    private readonly tokens: VideoTokenIssuer,
    private readonly labs: AvailableLabs,
  ) {}

  /** Lets the assigned Teacher and the group's enrolled Students, and nobody else, into an open class. */
  async execute(
    institutionId: string,
    memberships: MembershipClaim[],
    sessionId: string,
  ): Promise<ClassroomAccess> {
    const session = await this.classroom.findSession(institutionId, sessionId);
    if (!session) {
      throw new ClassSessionNotFoundException();
    }
    const participant = await this.participantIn(
      session,
      classroomMemberships(memberships, institutionId),
    );
    if (!participant) {
      throw new NotClassParticipantException();
    }
    if (!isOpen(session.status)) {
      throw new ClassSessionClosedException();
    }
    const roomName = roomNameFor(session.sessionId);
    const canModerate = participant.role === ClassroomRole.TEACHER;
    const token = await this.tokens.issue({
      roomName,
      identity: participant.id,
      displayName: await this.classroom.displayName(participant.id),
      canModerate,
      // Only the Teacher shares labs with the class, and only those the institution may use
      shareableLabs: canModerate ? await this.labs.keysFor(institutionId) : [],
    });
    return {
      token,
      roomName,
      identity: participant.id,
      role: participant.role,
      subjectName: session.subjectName,
      groupName: session.groupName,
    };
  }

  private async participantIn(
    session: SessionAccess,
    memberships: Array<{ id: string; role: ClassroomRole }>,
  ) {
    const teacher = memberships.find(
      (membership) =>
        membership.role === ClassroomRole.TEACHER && membership.id === session.teacherMembershipId,
    );
    if (teacher) {
      return teacher;
    }
    for (const membership of memberships) {
      if (
        membership.role === ClassroomRole.STUDENT &&
        (await this.classroom.isEnrolled(session.groupId, membership.id))
      ) {
        return membership;
      }
    }
    return null;
  }
}
