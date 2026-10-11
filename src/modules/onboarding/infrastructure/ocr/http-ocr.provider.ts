import { Logger } from '@nestjs/common';
import type { DocumentImage } from '../../domain/document-image.js';
import type {
  DocumentType,
  ExtractedIdentity,
} from '../../domain/entities/onboarding-application.entity.js';
import { OcrProcessingFailedException } from '../../domain/exceptions/onboarding.exceptions.js';
import type { OcrProvider } from '../../domain/ports/onboarding.ports.js';

const TIMEOUT_MS = 30_000;
const MIME_TYPE = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface HttpOcrOptions {
  baseUrl: string;
  /** Sent in `X-Internal-Secret`; the OCR service refuses requests without it. */
  internalSecret: string;
  fetch?: typeof fetch;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Sends the ID photo to the `ocr-server` microservice and maps its answer.
 * A photo with no readable text is not an error: it comes back as empty
 * fields, which the applicant then fills in by hand.
 */
export class HttpOcrProvider implements OcrProvider {
  private readonly logger = new Logger(HttpOcrProvider.name);
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: HttpOcrOptions) {
    this.doFetch = options.fetch ?? fetch;
  }

  async extract(image: DocumentImage, _documentType: DocumentType): Promise<ExtractedIdentity> {
    const body = new FormData();
    // Copied into a fresh array: Blob needs a plain ArrayBuffer, not a view over a shared one
    const bytes = new Uint8Array(image.content);
    body.append('file', new Blob([bytes], { type: MIME_TYPE[image.format] }), `id.${image.format}`);
    let response: Response;
    try {
      response = await this.doFetch(`${this.options.baseUrl}/extract`, {
        method: 'POST',
        headers: { 'X-Internal-Secret': this.options.internalSecret },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw this.failure(error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) {
      throw this.failure(`OCR service answered ${response.status}`);
    }
    const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!data) {
      throw this.failure('OCR service returned an unreadable body');
    }
    const birthDate = text(data.birth_date);
    return {
      firstName: text(data.first_name),
      lastName: text(data.last_name),
      documentNumber: text(data.document_number),
      // Anything but a calendar date is dropped rather than stored
      birthDate: ISO_DATE.test(birthDate) ? birthDate : null,
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      provider: text(data.engine) || 'ocr-server',
      extractedAt: new Date(),
    };
  }

  // The cause is logged here; the applicant only learns that reading failed
  private failure(reason: string): OcrProcessingFailedException {
    this.logger.error(reason);
    return new OcrProcessingFailedException();
  }
}
