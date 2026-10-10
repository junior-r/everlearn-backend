import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../../shared/infrastructure/prisma/generated/client.js';
import {
  PrismaErrorCode,
  runQuery,
} from '../../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import {
  EmailAlreadyRegisteredException,
  InstitutionNotFoundException,
  MemberAlreadyRegisteredException,
} from '../../domain/exceptions/identity.exceptions.js';
import type { Member } from '../../domain/member.js';
import type {
  MemberRepository,
  NewMember,
  NewMembership,
} from '../../domain/ports/member.repository.js';

const memberSelect = {
  id: true,
  role: true,
  isActive: true,
  user: { select: { id: true, email: true, firstName: true, lastName: true, status: true } },
} satisfies Prisma.MembershipSelect;

type MemberRow = Prisma.MembershipGetPayload<{ select: typeof memberSelect }>;

function toMember(row: MemberRow): Member {
  return {
    userId: row.user.id,
    membershipId: row.id,
    email: row.user.email,
    firstName: row.user.firstName,
    lastName: row.user.lastName,
    role: row.role,
    status: row.user.status,
    isActive: row.isActive,
  };
}

// A missing institution surfaces as either code, depending on how Prisma resolves the nested connect
const missingInstitution = {
  [PrismaErrorCode.FOREIGN_KEY_VIOLATION]: () => new InstitutionNotFoundException(),
  [PrismaErrorCode.RECORD_NOT_FOUND]: () => new InstitutionNotFoundException(),
};

@Injectable()
export class PrismaMemberRepository implements MemberRepository {
  private readonly logger = new Logger(PrismaMemberRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  register(member: NewMember): Promise<Member> {
    return runQuery(
      this.logger,
      async () =>
        // A nested create is one transaction: no account can exist without its membership
        toMember(
          await this.prisma.membership.create({
            data: {
              role: member.role,
              isActive: member.activate,
              institution: { connect: { id: member.institutionId } },
              user: {
                create: {
                  email: member.email,
                  passwordHash: member.passwordHash,
                  mustChangePassword: true,
                  firstName: member.firstName,
                  lastName: member.lastName,
                  status: member.activate ? 'ACTIVE' : 'PENDING_ONBOARDING',
                },
              },
            },
            select: memberSelect,
          }),
        ),
      {
        ...missingInstitution,
        [PrismaErrorCode.UNIQUE_VIOLATION]: () => new EmailAlreadyRegisteredException(),
      },
    );
  }

  addMembership(membership: NewMembership): Promise<Member> {
    return runQuery(
      this.logger,
      async () =>
        toMember(
          await this.prisma.membership.create({
            data: {
              role: membership.role,
              isActive: membership.activate,
              institution: { connect: { id: membership.institutionId } },
              user: {
                connect: { id: membership.userId },
                ...(membership.activateAccount ? { update: { status: 'ACTIVE' } } : {}),
              },
            },
            select: memberSelect,
          }),
        ),
      {
        ...missingInstitution,
        [PrismaErrorCode.UNIQUE_VIOLATION]: () => new MemberAlreadyRegisteredException(),
      },
    );
  }

  listByInstitution(institutionId: string): Promise<Member[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.membership.findMany({
        where: { institutionId },
        select: memberSelect,
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      });
      return rows.map(toMember);
    });
  }
}
