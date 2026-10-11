import { Logger, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { RATE_LIMITER, type RateLimiter } from '../../shared/domain/rate-limit/rate-limiter.js';
import {
  GetGradebookUseCase,
  GetMyProgressUseCase,
} from '../evaluations/application/use-cases/evaluation.use-cases.js';
import { EvaluationsModule } from '../evaluations/evaluations.module.js';
import {
  AcademicHistoryTool,
  CourseAveragesTool,
  EvaluationContextTool,
  GroupAttendanceRiskTool,
  TeacherHoursTool,
} from './application/tools/assistant-tools.js';
import { ChatWithAssistantUseCase } from './application/use-cases/chat-with-assistant.use-case.js';
import {
  ACADEMIC_RECORDS,
  COURSE_GRADES,
  LLM_PROVIDER,
  TEACHING_RECORDS,
  type AcademicRecords,
  type CourseGrades,
  type LLMProvider,
  type TeachingRecords,
} from './domain/ports/assistant.ports.js';
import { EvaluationsAcademicRecords } from './infrastructure/evaluations-academic-records.js';
import { EvaluationsCourseGrades } from './infrastructure/evaluations-course-grades.js';
import { MockLLMProvider } from './infrastructure/mock-llm.provider.js';
import { openAIChat, OpenAILLMProvider } from './infrastructure/openai-llm.provider.js';
import { PrismaTeachingRecords } from './infrastructure/prisma-teaching-records.js';
import { AiController } from './presentation/ai.controller.js';

/**
 * Composition root of the AI assistant. The model is OpenAI when `USE_REAL_AI`
 * is on and a key is set, and the built-in mock otherwise.
 */
@Module({
  imports: [EvaluationsModule],
  controllers: [AiController],
  providers: [
    {
      provide: LLM_PROVIDER,
      useFactory: (config: AppConfig): LLMProvider => {
        const { openai, realAiWithoutKey } = config.ai;
        if (openai) {
          return new OpenAILLMProvider(openAIChat(openai.apiKey), openai.model);
        }
        if (realAiWithoutKey) {
          new Logger(AiModule.name).warn('USE_REAL_AI is on but OPENAI_API_KEY is missing: the assistant runs on the mock');
        }
        return new MockLLMProvider();
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
      provide: COURSE_GRADES,
      useFactory: (gradebook: GetGradebookUseCase) => new EvaluationsCourseGrades(gradebook),
      inject: [GetGradebookUseCase],
    },
    {
      provide: ChatWithAssistantUseCase,
      useFactory: (
        llm: LLMProvider,
        teaching: TeachingRecords,
        records: AcademicRecords,
        grades: CourseGrades,
        limiter: RateLimiter,
        config: AppConfig,
      ) =>
        new ChatWithAssistantUseCase(
          llm,
          [
            new TeacherHoursTool(teaching),
            new CourseAveragesTool(teaching, grades),
            new GroupAttendanceRiskTool(teaching),
            new AcademicHistoryTool(records),
            new EvaluationContextTool(records),
          ],
          teaching,
          records,
          limiter,
          { maxQuestions: config.ai.chatMaxQuestions, windowSeconds: config.ai.chatWindowSeconds },
        ),
      inject: [LLM_PROVIDER, TEACHING_RECORDS, ACADEMIC_RECORDS, COURSE_GRADES, RATE_LIMITER, APP_CONFIG],
    },
  ],
})
export class AiModule {}
