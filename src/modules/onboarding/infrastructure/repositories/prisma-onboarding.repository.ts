import { Inject, Injectable, Logger } from '@nestjs/common';
import { runQuery } from '../../../../shared/infrastructure/prisma/prisma-errors.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import type { ConfirmedIdentity } from '../../domain/confirmed-identity.js';
import {
  OnboardingStatus,
  type Enrollment,
  type OnboardingApplication,
} from '../../domain/entities/onboarding-application.entity.js';
import type {
  ApplicationUnderReview,
  OnboardingRepository,
} from '../../domain/ports/onboarding.ports.js';
import { toDomainApplication, toPersistence } from '../mappers/onboarding.mapper.js';

const toDate = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);

@Injectable()
export class PrismaOnboardingRepository implements OnboardingRepository {
  private readonly logger = new Logger(PrismaOnboardingRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findById(id: string): Promise<OnboardingApplication | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.onboardingApplication.findUnique({ where: { id } });
      return row ? toDomainApplication(row) : null;
    });
  }

  findLatestByUserId(userId: string): Promise<OnboardingApplication | null> {
    return runQuery(this.logger, async () => {
      const row = await this.prisma.onboardingApplication.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      return row ? toDomainApplication(row) : null;
    });
  }

  findPendingEnrollment(userId: string): Promise<Enrollment | null> {
    return runQuery(this.logger, async () => {
      // Registration leaves the membership inactive until the ID check is approved
      const membership = await this.prisma.membership.findFirst({
        where: { userId, isActive: false, user: { status: 'PENDING_ONBOARDING' } },
        orderBy: { createdAt: 'desc' },
        select: { institutionId: true, role: true },
      });
      return membership
        ? { institutionId: membership.institutionId, requestedRole: membership.role }
        : null;
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

  submitForReview(application: OnboardingApplication, identity: ConfirmedIdentity): Promise<void> {
    const profile = {
      documentType: identity.documentType,
      documentNumber: identity.documentNumber,
      birthDate: toDate(identity.birthDate),
    };
    return runQuery(this.logger, async () => {
      await this.prisma.$transaction([
        this.prisma.onboardingApplication.update({
          where: { id: application.id },
          data: toPersistence(application),
        }),
        this.prisma.profile.upsert({
          where: { userId: application.userId },
          create: { userId: application.userId, ...profile },
          update: profile,
        }),
      ]);
    });
  }

  listAwaitingReview(institutionId: string): Promise<ApplicationUnderReview[]> {
    return runQuery(this.logger, async () => {
      const rows = await this.prisma.onboardingApplication.findMany({
        where: { institutionId, status: OnboardingStatus.NEEDS_REVIEW },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
        orderBy: { updatedAt: 'asc' },
      });
      return rows.map((row) => ({
        application: toDomainApplication(row),
        applicant: {
          userId: row.user.id,
          email: row.user.email,
          firstName: row.user.firstName,
          lastName: row.user.lastName,
        },
      }));
    });
  }

  completeReview(
    application: OnboardingApplication,
    reviewerMembershipId: string | null,
  ): Promise<void> {
    const { userId, institutionId, requestedRole, confirmed } = application;
    return runQuery(this.logger, async () => {
      const recordReview = this.prisma.onboardingApplication.update({
        where: { id: application.id },
        data: {
          ...toPersistence(application),
          reviewedById: reviewerMembershipId,
          reviewedAt: new Date(),
        },
      });
      if (application.status !== OnboardingStatus.APPROVED) {
        await recordReview;
        return;
      }
      await this.prisma.$transaction([
        recordReview,
        this.prisma.user.update({
          where: { id: userId },
          data: {
            status: 'ACTIVE',
            ...(confirmed ? { firstName: confirmed.firstName, lastName: confirmed.lastName } : {}),
          },
        }),
        // Only the membership this application was for; other institutions decide for themselves
        this.prisma.membership.updateMany({
          where: { userId, institutionId: institutionId ?? undefined, role: requestedRole ?? undefined },
          data: { isActive: true },
        }),
      ]);
    });
  }
}
