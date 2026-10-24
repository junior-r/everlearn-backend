import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  IssueClassroomTokenUseCase,
  ListCourseSessionsUseCase,
  ListMyCoursesUseCase,
  RecordHeldClassUseCase,
  StartClassSessionUseCase,
  type ClassroomAccess,
} from '../application/use-cases/classroom.use-cases.js';
import {
  GetSessionAttendanceUseCase,
  RecordAttendanceByHandUseCase,
} from '../application/use-cases/attendance.use-cases.js';
import {
  GetClassTranscriptUseCase,
  ListCourseTranscriptsUseCase,
} from '../application/use-cases/transcript.use-cases.js';
import type {
  AttendanceSheet,
  ClassroomCourse,
  ClassTranscript,
  CourseSessions,
  CourseTranscripts,
} from '../domain/classroom.js';
import { RecordAttendanceDto, RecordHeldClassDto } from './classroom.dtos.js';

/** Live classes of the institution in the `x-institution-id` header, for the members who give or attend them. */
@Controller()
export class ClassroomController {
  constructor(
    @Inject(ListMyCoursesUseCase) private readonly listCourses: ListMyCoursesUseCase,
    @Inject(StartClassSessionUseCase) private readonly startSession: StartClassSessionUseCase,
    @Inject(IssueClassroomTokenUseCase) private readonly issueToken: IssueClassroomTokenUseCase,
    @Inject(ListCourseSessionsUseCase) private readonly listSessions: ListCourseSessionsUseCase,
    @Inject(RecordHeldClassUseCase) private readonly recordHeldClass: RecordHeldClassUseCase,
    @Inject(GetSessionAttendanceUseCase) private readonly sessionAttendance: GetSessionAttendanceUseCase,
    @Inject(RecordAttendanceByHandUseCase) private readonly recordAttendance: RecordAttendanceByHandUseCase,
    @Inject(ListCourseTranscriptsUseCase) private readonly listTranscripts: ListCourseTranscriptsUseCase,
    @Inject(GetClassTranscriptUseCase) private readonly classTranscript: GetClassTranscriptUseCase,
  ) {}

  @Get('classroom/courses')
  @Roles(Role.TEACHER, Role.STUDENT)
  courses(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClassroomCourse[]> {
    return this.listCourses.execute(institutionId, user.memberships);
  }

  @Post('groups/:groupId/courses/:subjectId/sessions')
  @Roles(Role.TEACHER)
  start(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ): Promise<{ sessionId: string }> {
    return this.startSession.execute({
      institutionId,
      memberships: user.memberships,
      groupId,
      subjectId,
    });
  }

  /** The classes a course has had, for the Teacher who takes their attendance. */
  @Get('groups/:groupId/courses/:subjectId/sessions')
  @Roles(Role.TEACHER)
  sessions(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ): Promise<CourseSessions> {
    return this.listSessions.execute({ institutionId, memberships: user.memberships, groupId, subjectId });
  }

  /** A class given without video, recorded so its attendance can be taken by hand. */
  @Post('groups/:groupId/courses/:subjectId/sessions/held')
  @Roles(Role.TEACHER)
  held(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Body() dto: RecordHeldClassDto,
  ): Promise<{ sessionId: string }> {
    return this.recordHeldClass.execute(
      { institutionId, memberships: user.memberships, groupId, subjectId },
      dto.startsAt,
    );
  }

  @Post('class-sessions/:sessionId/token')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.TEACHER, Role.STUDENT)
  token(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<ClassroomAccess> {
    return this.issueToken.execute(institutionId, user.memberships, sessionId);
  }

  @Get('class-sessions/:sessionId/attendance')
  @Roles(Role.TEACHER)
  attendance(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<AttendanceSheet['students']> {
    return this.sessionAttendance.execute({ institutionId, memberships: user.memberships }, sessionId);
  }

  /** Attendance taken by hand by the Teacher of the class; it stands over the automatic one. */
  @Put('class-sessions/:sessionId/attendance')
  @Roles(Role.TEACHER)
  takeAttendance(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: RecordAttendanceDto,
  ): Promise<AttendanceSheet['students']> {
    return this.recordAttendance.execute(
      { institutionId, memberships: user.memberships },
      sessionId,
      dto.marks.map(({ enrollmentId, status, note }) => ({ enrollmentId, status, note: note ?? null })),
    );
  }

  /** The classes of a course that have a transcript, for its Teacher and the Students of its group. */
  @Get('groups/:groupId/courses/:subjectId/transcripts')
  @Roles(Role.TEACHER, Role.STUDENT)
  transcripts(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ): Promise<CourseTranscripts> {
    return this.listTranscripts.execute({ institutionId, memberships: user.memberships, groupId, subjectId });
  }

  @Get('class-sessions/:sessionId/transcript')
  @Roles(Role.TEACHER, Role.STUDENT)
  transcript(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<ClassTranscript> {
    return this.classTranscript.execute(institutionId, user.memberships, sessionId);
  }
}
