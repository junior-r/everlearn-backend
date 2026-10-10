import { DomainException } from '../../../../shared/domain/domain.exception.js';

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('UNAUTHORIZED', 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
}

export class EmailAlreadyRegisteredException extends DomainException {
  constructor() {
    super('CONFLICT', 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists');
  }
}

export class AccountSuspendedException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'ACCOUNT_SUSPENDED', 'This account has been suspended');
  }
}

export class InvalidRefreshTokenException extends DomainException {
  constructor() {
    super('UNAUTHORIZED', 'INVALID_REFRESH_TOKEN', 'The session has expired');
  }
}

export class UserNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'USER_NOT_FOUND', 'User not found');
  }
}

export class InvalidOAuthStateException extends DomainException {
  constructor() {
    super('UNAUTHORIZED', 'INVALID_OAUTH_STATE', 'The sign-in request could not be verified');
  }
}

export class GoogleEmailNotVerifiedException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'GOOGLE_EMAIL_NOT_VERIFIED', 'The Google account email is not verified');
  }
}

export class GoogleAuthenticationFailedException extends DomainException {
  constructor() {
    super('UNAUTHORIZED', 'GOOGLE_AUTHENTICATION_FAILED', 'Google sign-in failed');
  }
}

export class GoogleOAuthUnavailableException extends DomainException {
  constructor() {
    super('UNAVAILABLE', 'GOOGLE_OAUTH_UNAVAILABLE', 'Google sign-in is not configured');
  }
}

export class SessionStoreUnavailableException extends DomainException {
  constructor() {
    super('UNAVAILABLE', 'SESSION_STORE_UNAVAILABLE', 'Sessions cannot be verified right now');
  }
}

export class AccountNotRegisteredException extends DomainException {
  constructor() {
    super(
      'FORBIDDEN',
      'ACCOUNT_NOT_REGISTERED',
      'No account exists for this email. Your institution must register you first',
    );
  }
}

export class MemberRoleNotAllowedException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'MEMBER_ROLE_NOT_ALLOWED', 'You cannot register members with this role');
  }
}

export class InstitutionNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'INSTITUTION_NOT_FOUND', 'Institution not found');
  }
}
