import type { Role } from '../../../../shared/domain/auth/role.js';
import type { Member, MemberMatch } from '../member.js';

export const MEMBER_REPOSITORY = Symbol('MemberRepository');

export interface NewMember {
  institutionId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** Hash of a temporary password; the account is flagged to change it at first sign-in. */
  passwordHash: string;
  role: Role;
  /** False for members who must still pass onboarding: the account is pending and the membership inactive. */
  activate: boolean;
}

export interface NewMembership {
  userId: string;
  institutionId: string;
  role: Role;
  /** Whether the membership grants its role immediately. */
  activate: boolean;
  /** Also marks a pending account as active (used when a Platform Admin appoints an Institution Admin). */
  activateAccount: boolean;
}

export interface MemberRepository {
  /** Creates a new account and its first membership atomically. */
  register(member: NewMember): Promise<Member>;
  /** Adds a membership to an existing account. Rejects with MemberAlreadyRegisteredException on a duplicate. */
  addMembership(membership: NewMembership): Promise<Member>;
  listByInstitution(institutionId: string): Promise<Member[]>;
  /**
   * The first `limit` members holding `role` whose name or document number
   * contains every term, ignoring case, by last name.
   */
  search(institutionId: string, role: Role, terms: string[], limit: number): Promise<MemberMatch[]>;
}
