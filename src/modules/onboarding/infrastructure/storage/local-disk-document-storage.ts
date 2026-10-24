import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config.js';
import { PersistenceException } from '../../../../shared/domain/domain.exception.js';
import type { DocumentImage, ImageFormat } from '../../domain/document-image.js';
import type { DocumentStorage } from '../../domain/ports/onboarding.ports.js';

const EXTENSION: Record<ImageFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };

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

  private failure(error: unknown): PersistenceException {
    this.logger.error(error instanceof Error ? error.stack : String(error));
    return new PersistenceException();
  }
}
