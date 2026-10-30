import type {
  ClaimedRecording,
  ClassRecordingSummary,
  FinishedRecording,
  StoredRecording,
} from '../recording.js';

export const RECORDING_REPOSITORY = Symbol('RecordingRepository');
export const RECORDING_SPOOL = Symbol('RecordingSpool');
export const RECORDING_STORAGE = Symbol('RecordingStorage');
export const RECORDING_MEDIA_FILES = Symbol('RecordingMediaFiles');
/** Whether this deployment records classes: a boolean, from configuration. */
export const RECORDINGS_ENABLED = Symbol('RecordingsEnabled');

/** What is known about each recording, whichever storage keeps its file. */
export interface RecordingRepository {
  /**
   * Notes a finished recording as waiting to be stored. A second report of the same
   * Egress id is ignored. Rejects with ClassSessionNotFoundException for an unknown session.
   */
  register(recording: FinishedRecording): Promise<void>;
  /**
   * Takes the oldest recording waiting to be stored, or one whose claim is older than
   * `abandonedBefore`, so that no other archiver takes it meanwhile. Resolves to null when none waits.
   */
  claimNext(now: Date, abandonedBefore: Date): Promise<ClaimedRecording | null>;
  markReady(id: string, storageKey: string): Promise<void>;
  markFailed(id: string): Promise<void>;
  /** The latest `limit` stored recordings of a course, most recent first. */
  listReady(courseId: string, limit: number): Promise<ClassRecordingSummary[]>;
  /** Resolves to null unless the recording exists and is stored. */
  findReady(recordingId: string): Promise<StoredRecording | null>;
}

/** A recording's bytes, read once from start to end. */
export interface RecordingContent {
  sizeBytes: number;
  chunks: AsyncIterable<Uint8Array>;
}

/** Where Egress leaves each finished recording until it is stored. */
export interface RecordingSpool {
  /** Rejects with SpoolFileMissingException when the file is not there. */
  read(spoolFile: string): Promise<RecordingContent>;
  /** Deletes a file that was stored. A file already gone is not an error. */
  remove(spoolFile: string): Promise<void>;
}

/** Keeps recordings for good and hands out links to watch them: the server's disk, R2, S3... */
export interface RecordingStorage {
  save(key: string, content: RecordingContent): Promise<void>;
  /** A link that plays the file, or downloads it under `fileName` when `download` is true. */
  link(key: string, options: { fileName: string; download: boolean; expiresInSeconds: number }): Promise<string>;
}

/** A recording on this server's disk, as a playback link names it. */
export interface MediaFile {
  path: string;
  fileName: string;
  download: boolean;
}

/** The recordings a storage serves through this API rather than from links of its own. */
export interface RecordingMediaFiles {
  /** Resolves to null when the link was forged, has expired, or names no file. */
  resolve(token: string): Promise<MediaFile | null>;
}
