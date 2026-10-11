import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { REDIS_CLIENT } from '../../shared/infrastructure/redis/redis.tokens.js';
import { GetGradebookUseCase } from '../evaluations/application/use-cases/evaluation.use-cases.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import {
  GetAcademicOverviewUseCase,
  GetInstitutionDashboardUseCase,
  GetPlatformDashboardUseCase,
  GetTeacherDashboardUseCase,
} from './application/use-cases/dashboard.use-cases.js';
import {
  COURSE_AVERAGES,
  DASHBOARD_CACHE,
  DASHBOARD_QUERIES,
  type CourseAverages,
  type DashboardCache,
  type DashboardQueries,
} from './domain/ports/analytics.ports.js';
import { GradebookCourseAverages } from './infrastructure/gradebook-course-averages.js';
import { PrismaDashboardQueries } from './infrastructure/prisma-dashboard-queries.js';
import { RedisDashboardCache } from './infrastructure/redis-dashboard-cache.js';
import { AnalyticsController } from './presentation/analytics.controller.js';

/** Composition root of the dashboards: read-only figures per role. */
@Module({
  imports: [EvaluationsModule],
  controllers: [AnalyticsController],
  providers: [
    { provide: DASHBOARD_QUERIES, useClass: PrismaDashboardQueries },
    {
      provide: DASHBOARD_CACHE,
      useFactory: (redis: Redis) => new RedisDashboardCache(redis),
      inject: [REDIS_CLIENT],
    },
    {
      provide: COURSE_AVERAGES,
      useFactory: (gradebook: GetGradebookUseCase) => new GradebookCourseAverages(gradebook),
      inject: [GetGradebookUseCase],
    },
    {
      provide: GetPlatformDashboardUseCase,
      useFactory: (queries: DashboardQueries, cache: DashboardCache, config: AppConfig) =>
        new GetPlatformDashboardUseCase(queries, cache, config.analyticsCacheSeconds),
      inject: [DASHBOARD_QUERIES, DASHBOARD_CACHE, APP_CONFIG],
    },
    {
      provide: GetInstitutionDashboardUseCase,
      useFactory: (queries: DashboardQueries, cache: DashboardCache, config: AppConfig) =>
        new GetInstitutionDashboardUseCase(queries, cache, config.analyticsCacheSeconds),
      inject: [DASHBOARD_QUERIES, DASHBOARD_CACHE, APP_CONFIG],
    },
    {
      provide: GetAcademicOverviewUseCase,
      useFactory: (queries: DashboardQueries, cache: DashboardCache, config: AppConfig) =>
        new GetAcademicOverviewUseCase(queries, cache, config.analyticsCacheSeconds),
      inject: [DASHBOARD_QUERIES, DASHBOARD_CACHE, APP_CONFIG],
    },
    {
      provide: GetTeacherDashboardUseCase,
      useFactory: (queries: DashboardQueries, averages: CourseAverages) =>
        new GetTeacherDashboardUseCase(queries, averages),
      inject: [DASHBOARD_QUERIES, COURSE_AVERAGES],
    },
  ],
})
export class AnalyticsModule {}
