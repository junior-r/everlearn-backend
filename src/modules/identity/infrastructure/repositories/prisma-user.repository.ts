import { Inject, Injectable, Logger } from '@nestjs/common';
import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import {
  DomainException,
  PersistenceException,
} from '../../../../shared/domain/domain.exception.js';
import { Prisma } from '../../../../shared/infrastructure/prisma/generated/client.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import type { User } from '../../domain/entities/user.entity.js';
import { EmailAlreadyRegisteredException } from '../../domain/exceptions/identity.exceptions.js';
import type {
  LinkOAuthOptions,
  NewUser,
  OAuthIdentity,
  UserRepository,
} from '../../domain/ports/user.repository.js';
import { toDomainUser, toMembershipClaim } from '../mappers/user.mapper.js';

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class PrismaUserRepository implements UserRepository {
  private readonly logger = new Logger(PrismaUserRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findById(id: string): Promise<User | null> {
    return this.run(async () => {
      const row = await this.prisma.user.findUnique({ where: { id } });
      return row ? toDomainUser(row) : null;
    });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.run(async () => {
      const row = await this.prisma.user.findUnique({ where: { email } });
      return row ? toDomainUser(row) : null;
    });
  }

  findByOAuthIdentity(identity: OAuthIdentity): Promise<User | null> {
    return this.run(async () => {
      const row = await this.prisma.oAuthAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: identity.provider,
            providerAccountId: identity.providerAccountId,
          },
        },
        include: { user: true },
      });
      return row ? toDomainUser(row.user) : null;
    });
  }

  create(user: NewUser, identity?: OAuthIdentity): Promise<User> {
    return this.run(
      async () => {
        const row = await this.prisma.user.create({
          data: {
            email: user.email,
            passwordHash: user.passwordHash,
            firstName: user.firstName,
            lastName: user.lastName,
            avatarUrl: user.avatarUrl,
            emailVerifiedAt: user.emailVerified ? new Date() : null,
            oauthAccounts: identity ? { create: identity } : undefined,
          },
        });
        return toDomainUser(row);
      },
      () => new EmailAlreadyRegisteredException(),
    );
  }

  linkOAuthIdentity(
    userId: string,
    identity: OAuthIdentity,
    options: LinkOAuthOptions,
  ): Promise<void> {
    return this.run(async () => {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          oauthAccounts: { create: identity },
          ...(options.resetUnverifiedCredentials
            ? { passwordHash: null, emailVerifiedAt: new Date() }
            : {}),
        },
      });
    });
  }

  recordOAuthLogin(identity: OAuthIdentity): Promise<void> {
    return this.run(async () => {
      await this.prisma.oAuthAccount.update({
        where: {
          provider_providerAccountId: {
            provider: identity.provider,
            providerAccountId: identity.providerAccountId,
          },
        },
        data: { lastLoginAt: new Date() },
      });
    });
  }

  findActiveMemberships(userId: string): Promise<MembershipClaim[]> {
    return this.run(async () => {
      const rows = await this.prisma.membership.findMany({
        where: { userId, isActive: true, institution: { isActive: true } },
        select: { id: true, institutionId: true, role: true },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map(toMembershipClaim);
    });
  }

  /**
   * Runs a query and converts any database failure into a Domain Exception,
   * so driver errors never reach the client.
   */
  private async run<T>(
    operation: () => Promise<T>,
    onUniqueViolation?: () => DomainException,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        onUniqueViolation &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw onUniqueViolation();
      }
      this.logger.error(error instanceof Error ? error.stack : String(error));
      throw new PersistenceException();
    }
  }
}
