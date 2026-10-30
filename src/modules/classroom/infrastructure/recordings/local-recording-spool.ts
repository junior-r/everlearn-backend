import { createReadStream } from 'node:fs';
import { rm, rmdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { RecordingContent, RecordingSpool } from '../../domain/ports/recording.ports.js';
import { SpoolFileMissingException } from '../../domain/recording.js';

/** A path under `root`, or null for a name that would leave it. */
export function pathInside(root: string, name: string): string | null {
  const base = path.resolve(root);
  const target = path.resolve(base, name);
  return target.startsWith(base + path.sep) ? target : null;
}

const isMissing = (error: unknown) =>
  error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR');

/** The directory Egress writes finished recordings to, shared with this server through a volume. */
export class LocalRecordingSpool implements RecordingSpool {
  constructor(private readonly root: string) {}

  async read(spoolFile: string): Promise<RecordingContent> {
    const target = pathInside(this.root, spoolFile);
    if (!target) {
      throw new SpoolFileMissingException();
    }
    try {
      const info = await stat(target);
      if (!info.isFile()) {
        throw new SpoolFileMissingException();
      }
      return { sizeBytes: info.size, chunks: createReadStream(target) };
    } catch (error) {
      throw isMissing(error) ? new SpoolFileMissingException() : error;
    }
  }

  async remove(spoolFile: string): Promise<void> {
    const target = pathInside(this.root, spoolFile);
    if (!target) {
      return;
    }
    await rm(target, { force: true });
    // The session's folder goes once its last recording is stored; one still holding files stays
    await rmdir(path.dirname(target)).catch(() => undefined);
  }
}
