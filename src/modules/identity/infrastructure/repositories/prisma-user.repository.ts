import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import {
  PrismaErrorCode,
  runQuery,
} from '../../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import type { User } from '../../domain/entities/user.entity.js';
import {
  EmailAlreadyRegisteredException,
  GoogleAccountAlreadyLinkedException,
} from '../../domain/exceptions/identity.exceptions.js';
import type {
  NewUser,
  OAuthIdentity,
  OAuthProvider,
  UserRepository,
} from '../../domain/ports/user.repository.js';
import { toDomainUser, toMembershipClaim } from '../mappers/user.mapper.js';

const identityKey = (identity: OAuthIdentity) => ({
  provider_providerAccountId: {
    provider: identity.provider,
    providerAccountId: identity.providerAccountId,
  },
});

@Injectable()
export class PrismaUserRepository implements UserRepository {
  private readonly logger = new Logger(PrismaUserRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.user.findUnique({ where: { id } });
      return row ? toDomainUser(row) : null;
    });
  }

  findByEmail(email: string): Promise<User | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.user.findUnique({ where: { email } });
      return row ? toDomainUser(row) : null;
    });
  }

  findByOAuthIdentity(identity: OAuthIdentity): Promise<User | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.oAuthAccount.findUnique({
        where: identityKey(identity),
        include: { user: true },
      });
      return row ? toDomainUser(row.user) : null;
    });
  }

  create(user: NewUser): Promise<User> {
    return runQuery(
      this.logger,
      async () => {
        const row = await this.prisma.user.create({
          data: {
            email: user.email,
            passwordHash: user.passwordHash,
            mustChangePassword: user.mustChangePassword,
            firstName: user.firstName,
            lastName: user.lastName,
            avatarUrl: user.avatarUrl,
            emailVerifiedAt: user.emailVerified ? new Date() : null,
            status: user.status,
            isPlatformAdmin: user.isPlatformAdmin,
          },
        });
        return toDomainUser(row);
      },
      { [PrismaErrorCode.UNIQUE_VIOLATION]: () => new EmailAlreadyRegisteredException() },
    );
  }

  setPassword(userId: string, passwordHash: string): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, mustChangePassword: false },
      });
    });
  }

  hasOAuthIdentity(userId: string, provider: OAuthProvider): Promise<boolean> {
    return runQuery(
      this.logger,
      async () => (await this.prisma.oAuthAccount.count({ where: { userId, provider } })) > 0,
    );
  }

  linkOAuthIdentity(userId: string, identity: OAuthIdentity): Promise<void> {
    return runQuery(
      this.logger,
      async () => {
        await this.prisma.oAuthAccount.create({ data: { userId, ...identity } });
      },
      // Either this Google account or this user already has a link (both are unique)
      { [PrismaErrorCode.UNIQUE_VIOLATION]: () => new GoogleAccountAlreadyLinkedException() },
    );
  }

  recordOAuthLogin(identity: OAuthIdentity): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.oAuthAccount.update({
        where: identityKey(identity),
        data: { lastLoginAt: new Date() },
      });
    });
  }

  findActiveMemberships(userId: string): Promise<MembershipClaim[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.membership.findMany({
        where: { userId, isActive: true, institution: { isActive: true } },
        select: { id: true, institutionId: true, role: true },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toMembershipClaim);
    });
  }
}
