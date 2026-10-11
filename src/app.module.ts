import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AppConfigModule } from './config/app-config.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { AcademicsModule } from './modules/academics/academics.module.js';
import { ClassroomModule } from './modules/classroom/classroom.module.js';
import { EvaluationsModule } from './modules/evaluations/evaluations.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { InstitutionsModule } from './modules/institutions/institutions.module.js';
import { OnboardingModule } from './modules/onboarding/onboarding.module.js';
import { SchedulingModule } from './modules/scheduling/scheduling.module.js';
import { PrismaModule } from './shared/infrastructure/prisma/prisma.module.js';
import { RedisModule } from './shared/infrastructure/redis/redis.module.js';
import { HealthController } from './shared/presentation/controllers/health.controller.js';
import { DomainExceptionFilter } from './shared/presentation/filters/domain-exception.filter.js';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    RedisModule,
    IdentityModule,
    InstitutionsModule,
    AcademicsModule,
    SchedulingModule,
    ClassroomModule,
    EvaluationsModule,
    AiModule,
    OnboardingModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: DomainExceptionFilter },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
  ],
})
export class AppModule {}
