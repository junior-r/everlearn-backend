import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DomainException,
  PersistenceException,
} from '../../../../shared/domain/domain.exception.js';
import { Prisma } from '../../../../shared/infrastructure/prisma/generated/client.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import {
  EmailAlreadyRegisteredException,
  InstitutionNotFoundException,
} from '../../domain/exceptions/identity.exceptions.js';
import type { Member } from '../../domain/member.js';
import type { MemberRepository, NewMember } from '../../domain/ports/member.repository.js';

const UNIQUE_VIOLATION = 'P2002';
const FOREIGN_KEY_VIOLATION = 'P2003';
const RECORD_NOT_FOUND = 'P2025';

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

function translate(error: unknown): DomainException | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }
  if (error.code === UNIQUE_VIOLATION) {
    return new EmailAlreadyRegisteredException();
  }
  // A missing institution surfaces as either code, depending on how Prisma resolves the nested connect
  return error.code === FOREIGN_KEY_VIOLATION || error.code === RECORD_NOT_FOUND
    ? new InstitutionNotFoundException()
    : null;
}

@Injectable()
export class PrismaMemberRepository implements MemberRepository {
  private readonly logger = new Logger(PrismaMemberRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async register(member: NewMember): Promise<Member> {
    try {
      // A nested create is one transaction: no account can exist without its membership
      const row = await this.prisma.membership.create({
        data: {
          role: member.role,
          isActive: member.activate,
          institution: { connect: { id: member.institutionId } },
          user: {
            create: {
              email: member.email,
              passwordHash: member.passwordHash,
              firstName: member.firstName,
              lastName: member.lastName,
              status: member.activate ? 'ACTIVE' : 'PENDING_ONBOARDING',
            },
          },
        },
        select: memberSelect,
      });
      return toMember(row);
    } catch (error) {
      throw this.toDomain(error);
    }
  }

  async listByInstitution(institutionId: string): Promise<Member[]> {
    try {
      const rows = await this.prisma.membership.findMany({
        where: { institutionId },
        select: memberSelect,
        orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
      });
      return rows.map(toMember);
    } catch (error) {
      throw this.toDomain(error);
    }
  }

  private toDomain(error: unknown): DomainException {
    const known = translate(error);
    if (known) {
      return known;
    }
    this.logger.error(error instanceof Error ? error.stack : String(error));
    return new PersistenceException();
  }
}
