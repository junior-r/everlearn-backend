import { Inject, Injectable, Logger } from '@nestjs/common';
import { runQuery } from '../../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import type { ConfirmedIdentity } from '../../domain/confirmed-identity.js';
import {
  OnboardingStatus,
  type Enrollment,
  type OnboardingApplication,
} from '../../domain/entities/onboarding-application.entity.js';
import type { Applicant, OnboardingRepository } from '../../domain/ports/onboarding.ports.js';
import { toDomainApplication, toPersistence } from '../mappers/onboarding.mapper.js';

const toDate = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);

@Injectable()
export class PrismaOnboardingRepository implements OnboardingRepository {
  private readonly logger = new Logger(PrismaOnboardingRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findApplicant(membershipId: string, institutionId: string): Promise<Applicant | null> {
    return runQuery(this.logger, async () => {
      const membership = await this.prisma.membership.findFirst({
        where: { id: membershipId, institutionId },
        select: { id: true, role: true, user: { select: { id: true, status: true } } },
      });
      return membership
        ? {
            userId: membership.user.id,
            membershipId: membership.id,
            role: membership.role,
            // Only pending accounts still need the check; a suspended one is not reopened by it
            isVerified: membership.user.status !== 'PENDING_ONBOARDING',
          }
        : null;
    });
  }

  findOpen(userId: string, institutionId: string): Promise<OnboardingApplication | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.onboardingApplication.findFirst({
        where: { userId, institutionId, status: { not: OnboardingStatus.APPROVED } },
        orderBy: { createdAt: 'desc' },
      });
      return row ? toDomainApplication(row) : null;
    });
  }

  create(userId: string, enrollment: Enrollment): Promise<OnboardingApplication> {
    return runQuery(this.logger, async () =>
      toDomainApplication(
        await this.prisma.onboardingApplication.create({ data: { userId, ...enrollment } }),
      ),
    );
  }

  save(application: OnboardingApplication): Promise<void> {
    return runQuery(this.logger, async () => {
      await this.prisma.onboardingApplication.update({
        where: { id: application.id },
        data: toPersistence(application),
      });
    });
  }

  completeCheck(
    application: OnboardingApplication,
    identity: ConfirmedIdentity,
    verifierMembershipId: string | null,
  ): Promise<void> {
    const { userId } = application;
    const profile = {
      documentType: identity.documentType,
      documentNumber: identity.documentNumber,
      birthDate: toDate(identity.birthDate),
    };
    return runQuery(this.logger, async () => {
      await this.prisma.$transaction([
        this.prisma.onboardingApplication.update({
          where: { id: application.id },
          data: { ...toPersistence(application), verifiedById: verifierMembershipId, verifiedAt: new Date() },
        }),
        this.prisma.profile.upsert({
          where: { userId },
          create: { userId, ...profile },
          update: profile,
        }),
        this.prisma.user.update({
          where: { id: userId },
          data: { status: 'ACTIVE', firstName: identity.firstName, lastName: identity.lastName },
        }),
        // Identity is verified once per person, so every role they were registered for becomes usable
        this.prisma.membership.updateMany({
          where: { userId, isActive: false },
          data: { isActive: true },
        }),
      ]);
    });
  }
}
