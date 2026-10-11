import { Controller, Get, Inject } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  PlatformAdminOnly,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  GetAcademicOverviewUseCase,
  GetInstitutionDashboardUseCase,
  GetPlatformDashboardUseCase,
  GetTeacherDashboardUseCase,
} from '../application/use-cases/dashboard.use-cases.js';
import type {
  AcademicOverview,
  InstitutionDashboard,
  PlatformDashboard,
  TeacherDashboard,
} from '../domain/dashboards.js';

/** Read-only figures for each role's dashboard. */
@Controller('analytics')
export class AnalyticsController {
  constructor(
    @Inject(GetPlatformDashboardUseCase) private readonly platformDashboard: GetPlatformDashboardUseCase,
    @Inject(GetInstitutionDashboardUseCase) private readonly institutionDashboard: GetInstitutionDashboardUseCase,
    @Inject(GetTeacherDashboardUseCase) private readonly teacherDashboard: GetTeacherDashboardUseCase,
    @Inject(GetAcademicOverviewUseCase) private readonly academicOverview: GetAcademicOverviewUseCase,
  ) {}

  @Get('platform')
  @PlatformAdminOnly()
  platform(): Promise<PlatformDashboard> {
    return this.platformDashboard.execute();
  }

  // A Principal oversees the teaching, so they read the same figures as the Institution Admin
  @Get('academic')
  @Roles(Role.ADMIN, Role.COORDINATOR)
  academic(@CurrentInstitutionId() institutionId: string): Promise<AcademicOverview> {
    return this.academicOverview.execute(institutionId);
  }

  @Get('institution')
  @Roles(Role.ADMIN, Role.COORDINATOR)
  institution(@CurrentInstitutionId() institutionId: string): Promise<InstitutionDashboard> {
    return this.institutionDashboard.execute(institutionId);
  }

  @Get('teacher')
  @Roles(Role.TEACHER)
  teacher(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TeacherDashboard> {
    return this.teacherDashboard.execute({ institutionId, memberships: user.memberships });
  }
}
