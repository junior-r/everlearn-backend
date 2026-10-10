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

export class GoogleAccountNotLinkedException extends DomainException {
  constructor() {
    super(
      'FORBIDDEN',
      'GOOGLE_ACCOUNT_NOT_LINKED',
      'This Google account is not linked. Sign in with your password and link it from your profile',
    );
  }
}

export class GoogleAccountAlreadyLinkedException extends DomainException {
  constructor() {
    super('CONFLICT', 'GOOGLE_ACCOUNT_ALREADY_LINKED', 'This Google account or user is already linked');
  }
}

export class AccountNotActiveException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'ACCOUNT_NOT_ACTIVE', 'Your account must be active to do this');
  }
}

export class InvalidCurrentPasswordException extends DomainException {
  constructor() {
    super('FORBIDDEN', 'INVALID_CURRENT_PASSWORD', 'The current password is incorrect');
  }
}

export class PasswordUnchangedException extends DomainException {
  constructor() {
    super('VALIDATION', 'PASSWORD_UNCHANGED', 'The new password must be different');
  }
}

export class MemberAlreadyRegisteredException extends DomainException {
  constructor() {
    super('CONFLICT', 'MEMBER_ALREADY_REGISTERED', 'This person already has this role here');
  }
}
