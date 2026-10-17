-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" UUID;
