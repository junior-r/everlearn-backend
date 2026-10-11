import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { NOTIFIER } from '../../shared/domain/notifications/notifier.js';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  IssueClassroomTokenUseCase,
  ListMyCoursesUseCase,
  StartClassSessionUseCase,
} from './application/use-cases/classroom.use-cases.js';
import {
  RecordChatMessageUseCase,
  RecordParticipationUseCase,
  RecordRoomLifecycleUseCase,
  RecordTranscriptSegmentUseCase,
} from './application/use-cases/session-recording.use-cases.js';
import {
  CLASSROOM_REPOSITORY,
  SESSION_RECORDER,
  VIDEO_TOKEN_ISSUER,
} from './domain/ports/classroom.ports.js';
import { LiveKitTokenIssuer } from './infrastructure/livekit-token-issuer.js';
import {
  PrismaClassroomRepository,
  PrismaSessionRecorder,
} from './infrastructure/prisma-classroom.repositories.js';
import { ClassroomController } from './presentation/classroom.controller.js';
import { InternalClassroomController } from './presentation/internal-classroom.controller.js';

/** Composition root of the virtual classroom: who may enter a class, and what the video-server reports about it. */
@Module({
  imports: [JwtModule.register({})],
  controllers: [ClassroomController, InternalClassroomController],
  providers: [
    { provide: CLASSROOM_REPOSITORY, useClass: PrismaClassroomRepository },
    { provide: SESSION_RECORDER, useClass: PrismaSessionRecorder },
    {
      provide: VIDEO_TOKEN_ISSUER,
      useFactory: (jwt: JwtService, config: AppConfig) => new LiveKitTokenIssuer(jwt, config.livekit),
      inject: [JwtService, APP_CONFIG],
    },
    useCaseProvider(ListMyCoursesUseCase, [CLASSROOM_REPOSITORY]),
    useCaseProvider(IssueClassroomTokenUseCase, [CLASSROOM_REPOSITORY, VIDEO_TOKEN_ISSUER]),
    useCaseProvider(StartClassSessionUseCase, [CLASSROOM_REPOSITORY]),
    useCaseProvider(RecordRoomLifecycleUseCase, [SESSION_RECORDER, NOTIFIER]),
    useCaseProvider(RecordParticipationUseCase, [SESSION_RECORDER]),
    useCaseProvider(RecordChatMessageUseCase, [SESSION_RECORDER]),
    useCaseProvider(RecordTranscriptSegmentUseCase, [SESSION_RECORDER]),
  ],
})
export class ClassroomModule {}
