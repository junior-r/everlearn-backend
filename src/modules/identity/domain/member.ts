import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { canRegister } from '../../../shared/domain/auth/registration.js';
import type { Role } from '../../../shared/domain/auth/role.js';
import type { UserStatus } from './entities/user.entity.js';
import { MemberRoleNotAllowedException } from './exceptions/identity.exceptions.js';

/** A person's place in one institution: their account plus the role they hold there. */
export interface Member {
  userId: string;
  membershipId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  status: UserStatus;
  isActive: boolean;
}

/** A member found by a search: enough to tell two people with the same name apart. */
export interface MemberMatch {
  membershipId: string;
  firstName: string;
  lastName: string;
  email: string;
  documentNumber: string | null;
}

export const MEMBER_SEARCH_LIMIT = 10;
export const MEMBER_PAGE_SIZE = 20;

/** One page of the members of an institution, with how many there are in all. */
export interface MemberPage {
  items: Member[];
  total: number;
  page: number;
  pageSize: number;
}
const MEMBER_SEARCH_MIN_LENGTH = 2;
const MEMBER_SEARCH_MAX_TERMS = 5;

/**
 * The words a search must all match, in a name or in a document number.
 * Empty when there is too little to search by: nobody is listed without asking.
 */
export function searchTerms(query: string): string[] {
  const text = query.trim();
  return text.length < MEMBER_SEARCH_MIN_LENGTH ? [] : text.split(/\s+/).slice(0, MEMBER_SEARCH_MAX_TERMS);
}

/** Throws unless the actor may give this role in the institution (see `registrableRoles`). */
export function assertCanRegister(
  actor: AuthenticatedUser,
  institutionId: string,
  role: Role,
): void {
  if (!canRegister(actor, institutionId, role)) {
    throw new MemberRoleNotAllowedException();
  }
}
