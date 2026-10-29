import { DomainException } from '../../../shared/domain/domain.exception.js';

/** A file Egress finished writing for a class, as the video-server reports it. */
export interface FinishedRecording {
  /** Egress's id, which makes a report delivered twice harmless. */
  egressId: string;
  sessionId: string;
  /** Where the file waits, relative to the spool: `<session id>/<file id>.mp4`. */
  spoolFile: string;
  startedAt: Date;
  endedAt: Date;
  sizeBytes: number;
}

/** A recording taken by an archiver to be stored, with who to tell once it is. */
export interface ClaimedRecording {
  id: string;
  sessionId: string;
  spoolFile: string;
  sizeBytes: number;
  /** How many archivers took it so far, this one included. */
  attempts: number;
  institutionId: string;
  groupId: string;
  subjectId: string;
  subjectName: string;
  groupName: string;
  /** When the class started. */
  startsAt: Date;
  /** The Teacher of the course and the Students enrolled in its group. */
  audience: string[];
}

/** A stored recording, as the Teacher and the Students of its course see it in a list. */
export interface ClassRecordingSummary {
  id: string;
  sessionId: string;
  /** When the class started. */
  startsAt: Date;
  startedAt: Date;
  endedAt: Date;
  sizeBytes: number;
}

/** The stored recordings of a course, most recent first, with what the course is. */
export interface CourseRecordings {
  subjectName: string;
  groupName: string;
  recordings: ClassRecordingSummary[];
}

/** A stored recording and the class it belongs to. */
export interface StoredRecording {
  id: string;
  sessionId: string;
  storageKey: string;
  startedAt: Date;
}

/** A link the browser plays or downloads a recording from, good until `expiresAt`. */
export interface RecordingLink {
  url: string;
  expiresAt: Date;
}

/** How many of a course's recordings are listed, most recent first. */
export const MAX_LISTED_RECORDINGS = 60;
/** How many times storing a recording is tried before it is given up as failed. */
export const MAX_ARCHIVE_ATTEMPTS = 5;
/**
 * A claim older than this was abandoned, by an archiver that stopped or by a pass that
 * failed, and may be taken again: it is also how long a failed recording waits for a retry.
 */
export const ABANDONED_CLAIM_MS = 30 * 60 * 1000;
/** How long a playback link works: a whole class can be watched, and sought through, on one link. */
export const RECORDING_LINK_SECONDS = 6 * 60 * 60;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SPOOL_FILE = new RegExp(`^(${UUID})/${UUID}\\.mp4$`);

/** True when the name is one the video-server gives a recording of this session; nothing else may be read from the spool. */
export function isSpoolFileOf(sessionId: string, spoolFile: string): boolean {
  return SPOOL_FILE.exec(spoolFile)?.[1] === sessionId.toLowerCase();
}

/** Where a recording is kept: grouped by institution and class, named by its own id. */
export function storageKeyFor(recording: Pick<ClaimedRecording, 'id' | 'institutionId' | 'sessionId'>): string {
  return `recordings/${recording.institutionId}/${recording.sessionId}/${recording.id}.mp4`;
}

/** The name a downloaded recording is saved under: subject, group and day of the class. */
export function downloadNameFor(subjectName: string, groupName: string, startsAt: Date): string {
  const safe = `${subjectName} ${groupName}`
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${safe || 'clase'}-${startsAt.toISOString().slice(0, 10)}.mp4`;
}

export class RecordingNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'RECORDING_NOT_FOUND', 'Recording not found');
  }
}

/** The spool has no such file: Egress did not write it here, or it was already moved. */
export class SpoolFileMissingException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'RECORDING_FILE_MISSING', 'The recording file is not in the spool');
  }
}
