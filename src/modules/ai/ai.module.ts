import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { RATE_LIMITER, type RateLimiter } from '../../shared/domain/rate-limit/rate-limiter.js';
import { GetMyProgressUseCase } from '../evaluations/application/use-cases/evaluation.use-cases.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import {
  AcademicHistoryTool,
  EvaluationContextTool,
  TeacherHoursTool,
} from './application/tools/assistant-tools.js';
import { ChatWithAssistantUseCase } from './application/use-cases/chat-with-assistant.use-case.js';
import {
  ACADEMIC_RECORDS,
  LLM_PROVIDER,
  TEACHING_RECORDS,
  type AcademicRecords,
  type LLMProvider,
  type TeachingRecords,
} from './domain/ports/assistant.ports.js';
import { EvaluationsAcademicRecords } from './infrastructure/evaluations-academic-records.js';
import { MockLLMProvider } from './infrastructure/mock-llm.provider.js';
import { PrismaTeachingRecords } from './infrastructure/prisma-teaching-records.js';
import { AiController } from './presentation/ai.controller.js';

/**
 * Composition root of the AI assistant. A real model plugs in here: add an
 * adapter of `LLMProvider` and choose it from `config.ai.provider`.
 */
@Module({
  imports: [EvaluationsModule],
  controllers: [AiController],
  providers: [
    {
      provide: LLM_PROVIDER,
      useFactory: (config: AppConfig): LLMProvider => {
        switch (config.ai.provider) {
          case 'mock':
            return new MockLLMProvider();
        }
      },
      inject: [APP_CONFIG],
    },
    { provide: TEACHING_RECORDS, useClass: PrismaTeachingRecords },
    {
      provide: ACADEMIC_RECORDS,
      useFactory: (progress: GetMyProgressUseCase) => new EvaluationsAcademicRecords(progress),
      inject: [GetMyProgressUseCase],
    },
    {
      provide: ChatWithAssistantUseCase,
      useFactory: (
        llm: LLMProvider,
        teaching: TeachingRecords,
        records: AcademicRecords,
        limiter: RateLimiter,
        config: AppConfig,
      ) =>
        new ChatWithAssistantUseCase(
          llm,
          [new TeacherHoursTool(teaching), new AcademicHistoryTool(records), new EvaluationContextTool(records)],
          teaching,
          records,
          limiter,
          { maxQuestions: config.ai.chatMaxQuestions, windowSeconds: config.ai.chatWindowSeconds },
        ),
      inject: [LLM_PROVIDER, TEACHING_RECORDS, ACADEMIC_RECORDS, RATE_LIMITER, APP_CONFIG],
    },
  ],
})
export class AiModule {}
