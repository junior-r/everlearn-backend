import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import type { S3StorageConfig } from '../../../../config/app-config.js';
import type { RecordingContent, RecordingStorage } from '../../domain/ports/recording.ports.js';

// Parts of a multipart upload: an hour of class is about 90 of them, a few sent at once
const PART_SIZE = 16 * 1024 * 1024;
const PARTS_AT_ONCE = 4;

/**
 * Keeps recordings in an S3-compatible bucket (Cloudflare R2, AWS S3, MinIO). The
 * browser plays them straight from the bucket through presigned links, which
 * serve byte ranges, so seeking through a class never goes through this API.
 */
export class S3RecordingStorage implements RecordingStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint ?? undefined,
      // R2 and MinIO name the bucket in the path, not in the host
      forcePathStyle: config.endpoint !== null,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async save(key: string, content: RecordingContent): Promise<void> {
    await new Upload({
      client: this.client,
      params: {
        Bucket: this.config.bucket,
        Key: key,
        Body: Readable.from(content.chunks),
        ContentType: 'video/mp4',
      },
      partSize: PART_SIZE,
      queueSize: PARTS_AT_ONCE,
    }).done();
  }

  link(key: string, options: { fileName: string; download: boolean; expiresInSeconds: number }): Promise<string> {
    const disposition = `${options.download ? 'attachment' : 'inline'}; filename="${options.fileName}"`;
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        ResponseContentType: 'video/mp4',
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: options.expiresInSeconds },
    );
  }
}
