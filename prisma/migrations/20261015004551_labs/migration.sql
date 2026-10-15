-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LAB_ASSIGNED';

-- CreateTable
CREATE TABLE "InstitutionLab" (
    "institutionId" UUID NOT NULL,
    "labKey" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionLab_pkey" PRIMARY KEY ("institutionId","labKey")
);

-- CreateTable
CREATE TABLE "LanguageExercise" (
    "id" UUID NOT NULL,
    "labKey" TEXT NOT NULL,
    "institutionId" UUID,
    "authorId" UUID,
    "prompt" TEXT NOT NULL,
    "answers" TEXT[],
    "hint" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LanguageExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabAssignment" (
    "id" UUID NOT NULL,
    "courseId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "labKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabAssignmentExercise" (
    "assignmentId" UUID NOT NULL,
    "exerciseId" UUID NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "LabAssignmentExercise_pkey" PRIMARY KEY ("assignmentId","position")
);

-- CreateTable
CREATE TABLE "LabAttempt" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "studentId" UUID NOT NULL,
    "score" INTEGER,
    "total" INTEGER,
    "note" TEXT,
    "answers" JSONB NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LanguageExercise_labKey_institutionId_authorId_idx" ON "LanguageExercise"("labKey", "institutionId", "authorId");

-- CreateIndex
CREATE INDEX "LabAssignment_courseId_createdAt_idx" ON "LabAssignment"("courseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LabAssignmentExercise_assignmentId_exerciseId_key" ON "LabAssignmentExercise"("assignmentId", "exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "LabAttempt_assignmentId_studentId_key" ON "LabAttempt"("assignmentId", "studentId");

-- AddForeignKey
ALTER TABLE "InstitutionLab" ADD CONSTRAINT "InstitutionLab_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LanguageExercise" ADD CONSTRAINT "LanguageExercise_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LanguageExercise" ADD CONSTRAINT "LanguageExercise_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAssignment" ADD CONSTRAINT "LabAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAssignment" ADD CONSTRAINT "LabAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAssignmentExercise" ADD CONSTRAINT "LabAssignmentExercise_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "LabAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAssignmentExercise" ADD CONSTRAINT "LabAssignmentExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "LanguageExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAttempt" ADD CONSTRAINT "LabAttempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "LabAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabAttempt" ADD CONSTRAINT "LabAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
