import type { Role } from '../../../../shared/domain/auth/role.js';
import type { Member } from '../member.js';

export const MEMBER_REPOSITORY = Symbol('MemberRepository');

export interface NewMember {
  institutionId: string;
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  role: Role;
  /** False for members who must still pass onboarding: the account is pending and the membership inactive. */
  activate: boolean;
}

export interface MemberRepository {
  /** Creates the account and its membership atomically. */
  register(member: NewMember): Promise<Member>;
  listByInstitution(institutionId: string): Promise<Member[]>;
}
