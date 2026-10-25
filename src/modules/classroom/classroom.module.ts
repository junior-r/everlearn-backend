import {
  GetSessionAttendanceUseCase,
  RecordAttendanceByHandUseCase,
} from './application/use-cases/attendance.use-cases.js';
import { PrismaAttendanceBook } from './infrastructure/prisma-attendance-book.js';
import { PrismaTranscriptArchive } from './infrastructure/prisma-transcript-archive.js';
import {
  GetClassTranscriptUseCase,
  ListCourseTranscriptsUseCase,
} from './application/use-cases/transcript.use-cases.js';
import { Module } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { APP_CONFIG, type AppConfig } from '../../config/app-config.js';
import { AVAILABLE_LABS } from '../../shared/domain/labs/available-labs.js';
import { NOTIFIER } from '../../shared/domain/notifications/notifier.js';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import {
  IssueClassroomTokenUseCase,
  ListCourseSessionsUseCase,
  ListMyCoursesUseCase,
  RecordHeldClassUseCase,
  StartClassSessionUseCase,
} from './application/use-cases/classroom.use-cases.js';
import {
  RecordChatMessageUseCase,
  RecordParticipationUseCase,
  RecordRoomLifecycleUseCase,
  RecordTranscriptSegmentUseCase,
  RemoveChatMessageUseCase,
} from './application/use-cases/session-recording.use-cases.js';
import {
  ATTENDANCE_BOOK,
  CLASSROOM_REPOSITORY,
  SESSION_RECORDER,
  TRANSCRIPT_ARCHIVE,
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
    { provide: ATTENDANCE_BOOK, useClass: PrismaAttendanceBook },
    { provide: TRANSCRIPT_ARCHIVE, useClass: PrismaTranscriptArchive },
    {
      provide: VIDEO_TOKEN_ISSUER,
      useFactory: (jwt: JwtService, config: AppConfig) => new LiveKitTokenIssuer(jwt, config.livekit),
      inject: [JwtService, APP_CONFIG],
    },
    useCaseProvider(ListMyCoursesUseCase, [CLASSROOM_REPOSITORY]),
    useCaseProvider(IssueClassroomTokenUseCase, [CLASSROOM_REPOSITORY, VIDEO_TOKEN_ISSUER, AVAILABLE_LABS]),
    useCaseProvider(StartClassSessionUseCase, [CLASSROOM_REPOSITORY]),
    useCaseProvider(ListCourseSessionsUseCase, [CLASSROOM_REPOSITORY]),
    useCaseProvider(RecordHeldClassUseCase, [CLASSROOM_REPOSITORY]),
    useCaseProvider(RecordRoomLifecycleUseCase, [SESSION_RECORDER, NOTIFIER]),
    useCaseProvider(GetSessionAttendanceUseCase, [ATTENDANCE_BOOK]),
    useCaseProvider(RecordAttendanceByHandUseCase, [ATTENDANCE_BOOK, NOTIFIER]),
    useCaseProvider(RecordParticipationUseCase, [SESSION_RECORDER]),
    useCaseProvider(RecordChatMessageUseCase, [SESSION_RECORDER]),
    useCaseProvider(RemoveChatMessageUseCase, [SESSION_RECORDER]),
    useCaseProvider(RecordTranscriptSegmentUseCase, [SESSION_RECORDER]),
    useCaseProvider(ListCourseTranscriptsUseCase, [CLASSROOM_REPOSITORY, TRANSCRIPT_ARCHIVE]),
    useCaseProvider(GetClassTranscriptUseCase, [CLASSROOM_REPOSITORY, TRANSCRIPT_ARCHIVE]),
  ],
})
export class ClassroomModule {}
