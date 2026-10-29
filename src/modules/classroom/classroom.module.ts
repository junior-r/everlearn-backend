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
import { RecordingsController } from './presentation/recordings.controller.js';
import {
  ArchiveNextRecordingUseCase,
  GetRecordingLinkUseCase,
  ListCourseRecordingsUseCase,
  RecordFinishedRecordingUseCase,
} from './application/use-cases/recording.use-cases.js';
import {
  RECORDING_MEDIA_FILES,
  RECORDING_REPOSITORY,
  RECORDING_SPOOL,
  RECORDING_STORAGE,
  RECORDINGS_ENABLED,
  type RecordingStorage,
} from './domain/ports/recording.ports.js';
import { PrismaRecordingRepository } from './infrastructure/prisma-recording.repository.js';
import { LocalDiskRecordingStorage } from './infrastructure/recordings/local-disk-recording-storage.js';
import { LocalRecordingSpool } from './infrastructure/recordings/local-recording-spool.js';
import { RecordingArchiveWorker } from './infrastructure/recordings/recording-archive.worker.js';
import { S3RecordingStorage } from './infrastructure/recordings/s3-recording-storage.js';

/** Where recordings are kept: an S3-compatible bucket when one is configured, this server's disk otherwise. */
function recordingStorage(config: AppConfig): RecordingStorage {
  const { storage, publicApiUrl } = config.recordings;
  return storage.kind === 's3'
    ? new S3RecordingStorage(storage)
    : new LocalDiskRecordingStorage(config.uploadsDir, publicApiUrl, config.jwt.accessSecret);
}

/** Composition root of the virtual classroom: who may enter a class, what the video-server reports about it, and its recordings. */
@Module({
  imports: [JwtModule.register({})],
  controllers: [ClassroomController, InternalClassroomController, RecordingsController],
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
    { provide: RECORDING_REPOSITORY, useClass: PrismaRecordingRepository },
    {
      provide: RECORDING_SPOOL,
      useFactory: (config: AppConfig) => new LocalRecordingSpool(config.recordings.spoolDir),
      inject: [APP_CONFIG],
    },
    { provide: RECORDING_STORAGE, useFactory: recordingStorage, inject: [APP_CONFIG] },
    {
      provide: RECORDING_MEDIA_FILES,
      // Only the local storage serves files through this API; a bucket serves its own links
      useFactory: (storage: RecordingStorage) => (storage instanceof LocalDiskRecordingStorage ? storage : null),
      inject: [RECORDING_STORAGE],
    },
    {
      provide: RECORDINGS_ENABLED,
      useFactory: (config: AppConfig) => config.recordings.enabled,
      inject: [APP_CONFIG],
    },
    RecordingArchiveWorker,
    useCaseProvider(ListMyCoursesUseCase, [CLASSROOM_REPOSITORY]),
    useCaseProvider(IssueClassroomTokenUseCase, [
      CLASSROOM_REPOSITORY,
      VIDEO_TOKEN_ISSUER,
      AVAILABLE_LABS,
      RECORDINGS_ENABLED,
    ]),
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
    useCaseProvider(RecordFinishedRecordingUseCase, [RECORDING_REPOSITORY]),
    useCaseProvider(ArchiveNextRecordingUseCase, [RECORDING_REPOSITORY, RECORDING_SPOOL, RECORDING_STORAGE, NOTIFIER]),
    useCaseProvider(ListCourseRecordingsUseCase, [CLASSROOM_REPOSITORY, RECORDING_REPOSITORY]),
    useCaseProvider(GetRecordingLinkUseCase, [CLASSROOM_REPOSITORY, RECORDING_REPOSITORY, RECORDING_STORAGE]),
  ],
})
export class ClassroomModule {}
