-- AlterEnum
ALTER TYPE "OnboardingStatus" ADD VALUE 'PENDING_CONFIRMATION';

-- AlterTable
ALTER TABLE "OnboardingApplication" ALTER COLUMN "institutionId" DROP NOT NULL,
ALTER COLUMN "requestedRole" DROP NOT NULL;
