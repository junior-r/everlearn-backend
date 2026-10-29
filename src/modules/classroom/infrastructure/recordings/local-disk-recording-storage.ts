import { createHmac, timingSafeEqual } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  MediaFile,
  RecordingContent,
  RecordingMediaFiles,
  RecordingStorage,
} from '../../domain/ports/recording.ports.js';
import { pathInside } from './local-recording-spool.js';

/** What a playback link names: the file, its download name, whether to download it, and until when (seconds). */
interface LinkClaims {
  key: string;
  name: string;
  download: boolean;
  exp: number;
}

const encode = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/**
 * Keeps recordings on this server's disk, under the uploads directory, and serves
 * them through `GET /recordings/media/:token`. Its links are signed and expire,
 * since a `<video>` cannot send the member's session with its requests.
 */
export class LocalDiskRecordingStorage implements RecordingStorage, RecordingMediaFiles {
  private readonly signingKey: Buffer;

  constructor(
    private readonly root: string,
    private readonly publicApiUrl: string,
    secret: string,
    private readonly now: () => number = Date.now,
  ) {
    // A key of its own, so a link can never pass for any other token signed with the same secret
    this.signingKey = createHmac('sha256', secret).update('everlearn:recording-links').digest();
  }

  private target(key: string): string {
    const target = pathInside(this.root, key);
    if (!target) {
      throw new Error(`Recording key outside the storage: ${key}`);
    }
    return target;
  }

  async save(key: string, content: RecordingContent): Promise<void> {
    const target = this.target(key);
    // Written aside and renamed, so a file cut short by a restart is never served as a recording
    const partial = `${target}.partial`;
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await pipeline(Readable.from(content.chunks), createWriteStream(partial, { mode: 0o600 }));
      await rename(partial, target);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }

  link(key: string, options: { fileName: string; download: boolean; expiresInSeconds: number }): Promise<string> {
    const claims: LinkClaims = {
      key,
      name: options.fileName,
      download: options.download,
      exp: Math.floor(this.now() / 1000) + options.expiresInSeconds,
    };
    const payload = encode(JSON.stringify(claims));
    return Promise.resolve(`${this.publicApiUrl}/recordings/media/${payload}.${this.sign(payload)}`);
  }

  async resolve(token: string): Promise<MediaFile | null> {
    const claims = this.verify(token);
    const target = claims ? pathInside(this.root, claims.key) : null;
    if (!claims || !target) {
      return null;
    }
    const info = await stat(target).catch(() => null);
    return info?.isFile() ? { path: target, fileName: claims.name, download: claims.download } : null;
  }

  private sign(payload: string): string {
    return encode(createHmac('sha256', this.signingKey).update(payload).digest());
  }

  private verify(token: string): LinkClaims | null {
    const [payload, signature, ...rest] = token.split('.');
    if (!payload || !signature || rest.length > 0) {
      return null;
    }
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return null;
    }
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<LinkClaims>;
      const valid =
        typeof claims.key === 'string' &&
        typeof claims.name === 'string' &&
        typeof claims.download === 'boolean' &&
        typeof claims.exp === 'number' &&
        claims.exp * 1000 > this.now();
      return valid ? (claims as LinkClaims) : null;
    } catch {
      return null;
    }
  }
}
