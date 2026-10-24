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

export class IdentityAlreadyVerifiedException extends DomainException {
  constructor() {
    super('CONFLICT', 'IDENTITY_ALREADY_VERIFIED', "This member's ID was already checked");
  }
}

export class NothingToConfirmException extends DomainException {
  constructor() {
    super('CONFLICT', 'NOTHING_TO_CONFIRM', 'Photograph the ID before confirming its data');
  }
}

/** Also for a member of another institution, so its existence is not revealed. */
export class ApplicantNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'MEMBER_NOT_FOUND', 'Member not found');
  }
}

export class IdentityCheckNotAllowedException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'IDENTITY_CHECK_NOT_ALLOWED', "You cannot check this member's ID");
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
