import { Inject, Injectable, Logger } from '@nestjs/common';
import { PersistenceException } from '../../../../shared/domain/domain.exception.js';
import { PrismaService } from '../../../../shared/infrastructure/prisma/prisma.service.js';
import type { ConfirmedIdentity } from '../../domain/confirmed-identity.js';
import type { OnboardingApplication } from '../../domain/entities/onboarding-application.entity.js';
import type { OnboardingRepository } from '../../domain/ports/onboarding.ports.js';
import { toDomainApplication, toPersistence } from '../mappers/onboarding.mapper.js';

const toDate = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);

@Injectable()
export class PrismaOnboardingRepository implements OnboardingRepository {
  private readonly logger = new Logger(PrismaOnboardingRepository.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  findLatestByUserId(userId: string): Promise<OnboardingApplication | null> {
    return this.run(async () => {
      const row = await this.prisma.onboardingApplication.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      return row ? toDomainApplication(row) : null;
    });
  }

  create(userId: string): Promise<OnboardingApplication> {
    return this.run(async () =>
      toDomainApplication(await this.prisma.onboardingApplication.create({ data: { userId } })),
    );
  }

  save(application: OnboardingApplication): Promise<void> {
    return this.run(async () => {
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
    return this.run(async () => {
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
        this.prisma.user.update({
          where: { id: application.userId },
          data: { firstName: identity.firstName, lastName: identity.lastName },
        }),
      ]);
    });
  }

  /** Converts any database failure into a Domain Exception, so driver errors never reach the client. */
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.stack : String(error));
      throw new PersistenceException();
    }
  }
}
