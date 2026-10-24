-- IDs are now checked in person at the institution, so nothing waits for an admin's review.
-- Applications that were waiting go back to the desk to be confirmed; rejected attempts are dropped.
UPDATE "OnboardingApplication" SET "status" = 'PENDING_CONFIRMATION' WHERE "status" = 'NEEDS_REVIEW';
DELETE FROM "OnboardingApplication" WHERE "status" = 'REJECTED';

ALTER TYPE "OnboardingStatus" RENAME TO "OnboardingStatus_old";
CREATE TYPE "OnboardingStatus" AS ENUM ('PENDING_UPLOAD', 'PROCESSING', 'PENDING_CONFIRMATION', 'APPROVED');
ALTER TABLE "OnboardingApplication" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "OnboardingApplication" ALTER COLUMN "status" TYPE "OnboardingStatus" USING ("status"::text::"OnboardingStatus");
ALTER TABLE "OnboardingApplication" ALTER COLUMN "status" SET DEFAULT 'PENDING_UPLOAD';
DROP TYPE "OnboardingStatus_old";

-- The reviewer is now whoever checked the ID at the desk
ALTER TABLE "OnboardingApplication" RENAME COLUMN "reviewedById" TO "verifiedById";
ALTER TABLE "OnboardingApplication" RENAME COLUMN "reviewedAt" TO "verifiedAt";
ALTER TABLE "OnboardingApplication" RENAME CONSTRAINT "OnboardingApplication_reviewedById_fkey" TO "OnboardingApplication_verifiedById_fkey";
ALTER TABLE "OnboardingApplication" DROP COLUMN "rejectionReason";

DROP INDEX "OnboardingApplication_status_idx";
