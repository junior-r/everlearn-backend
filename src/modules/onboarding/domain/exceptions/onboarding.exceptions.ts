import { DomainException } from '../../../../shared/domain/domain.exception.js';

export class UnsupportedDocumentImageException extends DomainException {
  constructor() {
    super(
      'VALIDATION',
      'UNSUPPORTED_DOCUMENT_IMAGE',
      'The document photo must be a JPEG, PNG or WebP image',
    );
  }
}

export class DocumentImageTooLargeException extends DomainException {
  constructor() {
    super('VALIDATION', 'DOCUMENT_IMAGE_TOO_LARGE', 'The document photo is too large');
  }
}

export class ApplicationAlreadySubmittedException extends DomainException {
  constructor() {
    super('CONFLICT', 'APPLICATION_ALREADY_SUBMITTED', 'The application was already submitted');
  }
}

export class NothingToConfirmException extends DomainException {
  constructor() {
    super('CONFLICT', 'NOTHING_TO_CONFIRM', 'Upload a document before confirming your data');
  }
}

export class InvalidBirthDateException extends DomainException {
  constructor() {
    super('VALIDATION', 'INVALID_BIRTH_DATE', 'The date of birth is not valid');
  }
}

export class OcrProcessingFailedException extends DomainException {
  constructor() {
    super('UNAVAILABLE', 'OCR_PROCESSING_FAILED', 'The document could not be read. Try again');
  }
}
