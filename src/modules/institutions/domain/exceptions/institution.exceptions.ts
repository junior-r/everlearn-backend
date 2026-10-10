import { DomainException } from '../../../../shared/domain/domain.exception.js';

export class InstitutionNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'INSTITUTION_NOT_FOUND', 'Institution not found');
  }
}

export class InstitutionSlugTakenException extends DomainException {
  constructor() {
    super('CONFLICT', 'INSTITUTION_SLUG_TAKEN', 'Another institution already uses this identifier');
  }
}

export class InstitutionNotEmptyException extends DomainException {
  constructor() {
    super(
      'CONFLICT',
      'INSTITUTION_NOT_EMPTY',
      'An institution with members cannot be deleted. Deactivate it instead',
    );
  }
}

export class InvalidTimezoneException extends DomainException {
  constructor() {
    super('VALIDATION', 'INVALID_TIMEZONE', 'The time zone is not valid');
  }
}
