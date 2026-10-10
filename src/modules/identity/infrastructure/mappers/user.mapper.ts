import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import type {
  Membership as MembershipRow,
  User as UserRow,
} from '../../../../shared/infrastructure/prisma/generated/client.js';
import { User } from '../../domain/entities/user.entity.js';

export function toDomainUser(row: UserRow): User {
  return new User({
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    mustChangePassword: row.mustChangePassword,
    firstName: row.firstName,
    lastName: row.lastName,
    avatarUrl: row.avatarUrl,
    status: row.status,
    isPlatformAdmin: row.isPlatformAdmin,
    emailVerifiedAt: row.emailVerifiedAt,
  });
}

export function toMembershipClaim(
  row: Pick<MembershipRow, 'id' | 'institutionId' | 'role'>,
): MembershipClaim {
  return { id: row.id, institutionId: row.institutionId, role: row.role };
}
