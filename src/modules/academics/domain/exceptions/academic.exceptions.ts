import { DomainException } from '../../../../shared/domain/domain.exception.js';

export class SubjectNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'SUBJECT_NOT_FOUND', 'Subject not found');
  }
}

export class SubjectCodeTakenException extends DomainException {
  constructor() {
    super('CONFLICT', 'SUBJECT_CODE_TAKEN', 'Another subject already uses this code');
  }
}

export class SubjectInUseException extends DomainException {
  constructor() {
    super('CONFLICT', 'SUBJECT_IN_USE', 'The subject belongs to a pensum and cannot be deleted');
  }
}

export class PensumNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'PENSUM_NOT_FOUND', 'Pensum not found');
  }
}

export class PensumVersionTakenException extends DomainException {
  constructor() {
    super('CONFLICT', 'PENSUM_VERSION_TAKEN', 'This pensum code and version already exist');
  }
}

export class PensumInUseException extends DomainException {
  constructor() {
    super('CONFLICT', 'PENSUM_IN_USE', 'The pensum is used by groups and cannot be changed this way');
  }
}
