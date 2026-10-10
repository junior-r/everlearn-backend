export const UserStatus = {
  PENDING_ONBOARDING: 'PENDING_ONBOARDING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export interface UserProps {
  id: string;
  email: string;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  status: UserStatus;
  isPlatformAdmin: boolean;
  emailVerifiedAt: Date | null;
}

export class User {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly avatarUrl: string | null;
  readonly status: UserStatus;
  readonly isPlatformAdmin: boolean;
  readonly emailVerifiedAt: Date | null;

  constructor(props: UserProps) {
    this.id = props.id;
    this.email = props.email;
    this.passwordHash = props.passwordHash;
    this.firstName = props.firstName;
    this.lastName = props.lastName;
    this.avatarUrl = props.avatarUrl;
    this.status = props.status;
    this.isPlatformAdmin = props.isPlatformAdmin;
    this.emailVerifiedAt = props.emailVerifiedAt;
  }

  isSuspended(): boolean {
    return this.status === UserStatus.SUSPENDED;
  }

  hasVerifiedEmail(): boolean {
    return this.emailVerifiedAt !== null;
  }
}

/** Canonical form used for storage and lookups, so emails compare case-insensitively. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
