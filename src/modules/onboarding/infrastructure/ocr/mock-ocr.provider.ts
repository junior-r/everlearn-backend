import type { DocumentImage } from '../../domain/document-image.js';
import type {
  DocumentType,
  ExtractedIdentity,
} from '../../domain/entities/onboarding-application.entity.js';
import type { OcrProvider } from '../../domain/ports/onboarding.ports.js';

const DEFAULT_DELAY_MS = 2000;

/**
 * Stand-in for a real OCR service: waits like a network call would, then
 * returns fixed sample data regardless of the image. Not for production.
 */
export class MockOcrProvider implements OcrProvider {
  constructor(private readonly delayMs: number = DEFAULT_DELAY_MS) {}

  async extract(_image: DocumentImage, _documentType: DocumentType): Promise<ExtractedIdentity> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return {
      firstName: 'María Fernanda',
      lastName: 'González Pérez',
      documentNumber: '12345678',
      birthDate: '2008-03-14',
      confidence: 0.93,
      provider: 'mock',
      extractedAt: new Date(),
    };
  }
}
