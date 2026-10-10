import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config.js';
import { PersistenceException } from '../../../../shared/domain/domain.exception.js';
import type { DocumentImage, ImageFormat } from '../../domain/document-image.js';
import type { DocumentStorage } from '../../domain/ports/onboarding.ports.js';

const EXTENSION: Record<ImageFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const FORMAT_BY_EXTENSION: Record<string, ImageFormat> = { jpg: 'jpeg', png: 'png', webp: 'webp' };

const isMissingFile = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/**
 * Development storage: writes ID photos under the uploads directory, which is
 * never served over HTTP. Swap for object storage behind the same port in production.
 */
@Injectable()
export class LocalDiskDocumentStorage implements DocumentStorage {
  private readonly logger = new Logger(LocalDiskDocumentStorage.name);
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.root = path.resolve(config.uploadsDir);
  }

  async store(ownerId: string, image: DocumentImage): Promise<string> {
    // The file name is generated here; nothing from the client reaches the file system path
    const key = path.posix.join('onboarding', ownerId, `${randomUUID()}.${EXTENSION[image.format]}`);
    const target = path.join(this.root, key);
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, image.content, { mode: 0o600 });
      return key;
    } catch (error) {
      throw this.failure(error);
    }
  }

  async read(key: string): Promise<DocumentImage | null> {
    const target = path.resolve(this.root, key);
    const format = FORMAT_BY_EXTENSION[path.extname(target).slice(1)];
    // Keys come from our own database, but a key must still never resolve outside the uploads directory
    if (!format || !target.startsWith(this.root + path.sep)) {
      return null;
    }
    try {
      return { content: await readFile(target), format };
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw this.failure(error);
    }
  }

  private failure(error: unknown): PersistenceException {
    this.logger.error(error instanceof Error ? error.stack : String(error));
    return new PersistenceException();
  }
}
