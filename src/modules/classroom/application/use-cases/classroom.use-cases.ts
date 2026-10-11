import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import {
  ClassroomRole,
  ClassSessionClosedException,
  ClassSessionNotFoundException,
  CourseNotFoundException,
  DEFAULT_SESSION_MINUTES,
  isOpen,
  NotClassParticipantException,
  NotCourseTeacherException,
  roomNameFor,
  type ClassroomCourse,
  type SessionAccess,
} from '../../domain/classroom.js';
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

export class StartClassSessionUseCase {
  constructor(private readonly classroom: ClassroomRepository) {}

  /**
   * Opens a class for a subject of a group; only its assigned Teacher may.
   * Starting again while a class is open resolves to that same session.
   */
  async execute(input: StartClassSessionInput, now = new Date()): Promise<{ sessionId: string }> {
    const course = await this.classroom.findCourse(input.institutionId, input.groupId, input.subjectId);
    if (!course) {
      throw new CourseNotFoundException();
    }
    const teaches = classroomMemberships(input.memberships, input.institutionId).some(
      (membership) =>
        membership.role === ClassroomRole.TEACHER && membership.id === course.teacherMembershipId,
    );
    if (!teaches) {
      throw new NotCourseTeacherException();
    }
    const open = await this.classroom.findOpenSessionId(course.courseId);
    if (open) {
      return { sessionId: open };
    }
    const endsAt = new Date(now.getTime() + DEFAULT_SESSION_MINUTES * MS_PER_MINUTE);
    return { sessionId: await this.classroom.createSession(course.courseId, now, endsAt) };
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
    const token = await this.tokens.issue({
      roomName,
      identity: participant.id,
      displayName: await this.classroom.displayName(participant.id),
      canModerate: participant.role === ClassroomRole.TEACHER,
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
