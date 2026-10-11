import { Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  IssueClassroomTokenUseCase,
  ListMyCoursesUseCase,
  StartClassSessionUseCase,
  type ClassroomAccess,
} from '../application/use-cases/classroom.use-cases.js';
import type { ClassroomCourse } from '../domain/classroom.js';

/** Live classes of the institution in the `x-institution-id` header, for the members who give or attend them. */
@Controller()
export class ClassroomController {
  constructor(
    @Inject(ListMyCoursesUseCase) private readonly listCourses: ListMyCoursesUseCase,
    @Inject(StartClassSessionUseCase) private readonly startSession: StartClassSessionUseCase,
    @Inject(IssueClassroomTokenUseCase) private readonly issueToken: IssueClassroomTokenUseCase,
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
}
