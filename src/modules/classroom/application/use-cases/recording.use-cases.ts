import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import { NotificationType, type Notifier } from '../../../../shared/domain/notifications/notifier.js';
import { CourseNotFoundException, InvalidSessionEventException } from '../../domain/classroom.js';
import type { ClassroomRepository } from '../../domain/ports/classroom.ports.js';
import type { RecordingRepository, RecordingSpool, RecordingStorage } from '../../domain/ports/recording.ports.js';
import {
  ABANDONED_CLAIM_MS,
  downloadNameFor,
  isSpoolFileOf,
  MAX_ARCHIVE_ATTEMPTS,
  MAX_LISTED_RECORDINGS,
  RECORDING_LINK_SECONDS,
  RecordingNotFoundException,
  SpoolFileMissingException,
  storageKeyFor,
  type ClaimedRecording,
  type CourseRecordings,
  type FinishedRecording,
  type RecordingLink,
} from '../../domain/recording.js';
import { classroomMemberships, participantOf, type StartClassSessionInput } from './classroom.use-cases.js';

export class RecordFinishedRecordingUseCase {
  constructor(private readonly recordings: RecordingRepository) {}

  /** Notes a file Egress finished, to be stored by the archiver. The video-server may report it twice. */
  async execute(recording: FinishedRecording): Promise<void> {
    if (!isSpoolFileOf(recording.sessionId, recording.spoolFile)) {
      throw new InvalidSessionEventException('A recording must be a file the video-server named for its session');
    }
    if (recording.endedAt.getTime() < recording.startedAt.getTime()) {
      throw new InvalidSessionEventException('A recording cannot end before it starts');
    }
    await this.recordings.register(recording);
  }
}

/** What happened to the recording an archiving pass took, if it took one. */
export type ArchiveOutcome = 'NONE' | 'STORED' | 'RETRY' | 'FAILED';

export class ArchiveNextRecordingUseCase {
  constructor(
    private readonly recordings: RecordingRepository,
    private readonly spool: RecordingSpool,
    private readonly storage: RecordingStorage,
    private readonly notifier: Notifier,
  ) {}

  /**
   * Moves the oldest waiting recording from the spool to the recording storage and
   * tells the course it can be watched. A failure keeps the claim, so it is tried again
   * once the claim lapses, up to MAX_ARCHIVE_ATTEMPTS; a file not in the spool fails at once.
   */
  async execute(now = new Date()): Promise<ArchiveOutcome> {
    const claim = await this.recordings.claimNext(now, new Date(now.getTime() - ABANDONED_CLAIM_MS));
    if (!claim) {
      return 'NONE';
    }
    const key = storageKeyFor(claim);
    try {
      await this.storage.save(key, await this.spool.read(claim.spoolFile));
    } catch (error) {
      if (error instanceof SpoolFileMissingException || claim.attempts >= MAX_ARCHIVE_ATTEMPTS) {
        await this.recordings.markFailed(claim.id);
        return 'FAILED';
      }
      return 'RETRY';
    }
    await this.recordings.markReady(claim.id, key);
    // Stored: the copy in the spool is only taking space now, and a later pass may still clear it
    await this.spool.remove(claim.spoolFile).catch(() => undefined);
    await this.notifier.notify(readyNotices(claim));
    return 'STORED';
  }
}

function readyNotices(claim: ClaimedRecording) {
  return claim.audience.map((membershipId) => ({
    recipient: { membershipId },
    institutionId: claim.institutionId,
    type: NotificationType.RECORDING_READY,
    data: {
      recordingId: claim.id,
      sessionId: claim.sessionId,
      groupId: claim.groupId,
      subjectId: claim.subjectId,
      subjectName: claim.subjectName,
      groupName: claim.groupName,
      startsAt: claim.startsAt.toISOString(),
    },
    dedupeKey: `recording-ready:${claim.id}:${membershipId}`,
    // One per recorded class would fill every inbox of the group
    email: false,
  }));
}

export class ListCourseRecordingsUseCase {
  constructor(
    private readonly classroom: ClassroomRepository,
    private readonly recordings: RecordingRepository,
  ) {}

  /** The stored recordings of a course, for its Teacher and the Students of its group; anyone else finds no course. */
  async execute(input: StartClassSessionInput): Promise<CourseRecordings> {
    const course = await this.classroom.findCourse(input.institutionId, input.groupId, input.subjectId);
    const memberships = classroomMemberships(input.memberships, input.institutionId);
    if (!course || !(await participantOf(this.classroom, { ...course, groupId: input.groupId }, memberships))) {
      throw new CourseNotFoundException();
    }
    return {
      subjectName: course.subjectName,
      groupName: course.groupName,
      recordings: await this.recordings.listReady(course.courseId, MAX_LISTED_RECORDINGS),
    };
  }
}

export class GetRecordingLinkUseCase {
  constructor(
    private readonly classroom: ClassroomRepository,
    private readonly recordings: RecordingRepository,
    private readonly storage: RecordingStorage,
  ) {}

  /**
   * A link to watch, or download, a recording, for the Teacher of its class and the
   * Students of its group. For anyone else, here or in another institution, it does not exist.
   */
  async execute(
    institutionId: string,
    memberships: MembershipClaim[],
    recordingId: string,
    download: boolean,
    now = new Date(),
  ): Promise<RecordingLink> {
    const recording = await this.recordings.findReady(recordingId);
    const session = recording ? await this.classroom.findSession(institutionId, recording.sessionId) : null;
    if (
      !recording ||
      !session ||
      !(await participantOf(this.classroom, session, classroomMemberships(memberships, institutionId)))
    ) {
      throw new RecordingNotFoundException();
    }
    const url = await this.storage.link(recording.storageKey, {
      fileName: downloadNameFor(session.subjectName, session.groupName, recording.startedAt),
      download,
      expiresInSeconds: RECORDING_LINK_SECONDS,
    });
    return { url, expiresAt: new Date(now.getTime() + RECORDING_LINK_SECONDS * 1000) };
  }
}
