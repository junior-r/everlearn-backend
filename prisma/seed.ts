import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';
import { BUILT_IN_EXERCISES } from '../src/modules/labs/domain/built-in-exercises.js';
import { LAB_CATALOG } from '../src/modules/labs/domain/lab-catalog.js';
import { PrismaClient } from '../src/shared/infrastructure/prisma/generated/client.js';

/**
 * Demo data for trying the platform by hand: `pnpm prisma db seed`.
 * It ERASES every institution and every account except Platform Admins, then
 * builds one institution with a member of each role, a group, classes and grades.
 */

const PASSWORD = 'password123';
// The cost the application hashes with, so signing in costs what it does for a real account
const BCRYPT_COST = 12;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}
if (process.env.NODE_ENV === 'production') {
  throw new Error('The seeder erases every institution and member: it does not run with NODE_ENV=production');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

type Status = 'PRESENT' | 'LATE' | 'ABSENT' | 'EXCUSED';

/** A moment `days` from now (negative is the past) at `hour` o'clock UTC. */
function dayAt(days: number, hour: number): Date {
  const date = new Date(Date.now() + days * MS_PER_DAY);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

async function wipe(): Promise<void> {
  // Everything else hangs from an institution, whether or not its foreign key cascades on delete
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Institution" CASCADE');
  await prisma.user.deleteMany({ where: { isPlatformAdmin: false } });
}

async function main(): Promise<void> {
  await wipe();
  const passwordHash = await bcrypt.hash(PASSWORD, BCRYPT_COST);

  const institution = await prisma.institution.create({
    data: { name: 'EverLearn Demo', slug: 'everlearn-demo', timezone: 'America/Caracas' },
  });

  /** An active account with one active role in the demo institution; resolves to its membership id. */
  async function member(
    role: 'ADMIN' | 'COORDINATOR' | 'STAFF' | 'TEACHER' | 'STUDENT' | 'GUARDIAN',
    email: string,
    firstName: string,
    lastName: string,
    documentNumber: string,
  ): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        profile: { create: { documentType: 'NATIONAL_ID', documentNumber } },
        memberships: { create: { institutionId: institution.id, role, isActive: true } },
      },
      include: { memberships: true },
    });
    return user.memberships[0].id;
  }

  const accounts = [
    { label: 'Institution Admin', role: 'ADMIN', email: 'admin@demo.everlearn.local', first: 'Ada', last: 'Lovelace' },
    { label: 'Principal', role: 'COORDINATOR', email: 'principal@demo.everlearn.local', first: 'Marie', last: 'Curie' },
    { label: 'Staff', role: 'STAFF', email: 'staff@demo.everlearn.local', first: 'Rosalind', last: 'Franklin' },
    { label: 'Teacher', role: 'TEACHER', email: 'teacher@demo.everlearn.local', first: 'Alan', last: 'Turing' },
    { label: 'Student 1', role: 'STUDENT', email: 'student1@demo.everlearn.local', first: 'Grace', last: 'Hopper' },
    { label: 'Student 2', role: 'STUDENT', email: 'student2@demo.everlearn.local', first: 'Linus', last: 'Pauling' },
    { label: 'Guardian (of Student 1)', role: 'GUARDIAN', email: 'guardian@demo.everlearn.local', first: 'Gina', last: 'Hopper' },
  ] as const;
  const ids: string[] = [];
  for (const [index, account] of accounts.entries()) {
    ids.push(await member(account.role, account.email, account.first, account.last, `V-1000000${index + 1}`));
  }
  const [, , , teacherId, graceId, linusId, guardianId] = ids;

  await prisma.guardianLink.create({
    data: { studentId: graceId, guardianId, relationship: 'MOTHER', isPrimary: true },
  });

  const period = await prisma.academicPeriod.create({
    data: {
      institutionId: institution.id,
      name: 'Año escolar en curso',
      startDate: dayAt(-60, 0),
      endDate: dayAt(240, 0),
      isActive: true,
    },
  });
  const pensum = await prisma.pensum.create({
    data: { institutionId: institution.id, code: 'BACH', name: 'Bachillerato' },
  });
  const group = await prisma.group.create({
    data: { institutionId: institution.id, pensumId: pensum.id, periodId: period.id, name: '1ro A', level: 1, capacity: 30 },
  });
  const [grace, linus] = await Promise.all(
    [graceId, linusId].map((studentId) => prisma.enrollment.create({ data: { groupId: group.id, studentId } })),
  );

  await prisma.teacherAvailability.createMany({
    data: (['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const).map((dayOfWeek) => ({
      teacherId,
      periodId: period.id,
      dayOfWeek,
      startMinute: 7 * 60,
      endMinute: 13 * 60,
    })),
  });

  /** A subject of the pensum given to the group by the Teacher, on the mornings given. */
  async function course(code: string, name: string, weeklyHours: number, days: Array<'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY'>) {
    const subject = await prisma.subject.create({ data: { institutionId: institution.id, code, name } });
    const pensumSubject = await prisma.pensumSubject.create({
      data: { pensumId: pensum.id, subjectId: subject.id, level: 1, weeklyHours },
    });
    return prisma.course.create({
      data: {
        groupId: group.id,
        pensumSubjectId: pensumSubject.id,
        teacherId,
        scheduleSlots: {
          create: days.map((dayOfWeek) => ({ dayOfWeek, startMinute: 8 * 60, endMinute: 9 * 60, room: 'Aula 1' })),
        },
      },
    });
  }
  const math = await course('MAT-1', 'Matemática', 4, ['MONDAY', 'WEDNESDAY']);
  const physics = await course('FIS-1', 'Física', 3, ['TUESDAY', 'THURSDAY']);
  const language = await course('LEN-1', 'Lengua', 2, ['FRIDAY']);

  /** A class already given, with the roll the Teacher took: [Grace, Linus]. */
  async function heldClass(courseId: string, daysAgo: number, marks: [Status, Status]): Promise<void> {
    const startsAt = dayAt(-daysAgo, 12);
    await prisma.classSession.create({
      data: {
        courseId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        status: 'COMPLETED',
        attendance: {
          create: [grace, linus].map((enrollment, index) => ({
            enrollmentId: enrollment.id,
            status: marks[index],
            source: 'MANUAL' as const,
            recordedById: teacherId,
          })),
        },
      },
    });
  }
  // Grace attends; Linus misses enough to show among the Students at risk
  await heldClass(math.id, 9, ['PRESENT', 'PRESENT']);
  await heldClass(math.id, 7, ['PRESENT', 'ABSENT']);
  await heldClass(math.id, 2, ['LATE', 'ABSENT']);
  await heldClass(physics.id, 8, ['PRESENT', 'ABSENT']);
  await heldClass(physics.id, 6, ['PRESENT', 'LATE']);
  await heldClass(physics.id, 1, ['EXCUSED', 'ABSENT']);

  /** An evaluation of a course; `scores` are [Grace, Linus], or null while it is not graded. */
  async function evaluation(
    courseId: string,
    data: { title: string; type: 'EXAM' | 'QUIZ' | 'ASSIGNMENT' | 'PROJECT'; weight: number; dueInDays: number; isPublished: boolean },
    scores: [number, number] | null,
  ): Promise<void> {
    await prisma.evaluation.create({
      data: {
        courseId,
        title: data.title,
        type: data.type,
        weight: data.weight,
        maxScore: 20,
        dueAt: dayAt(data.dueInDays, 16),
        isPublished: data.isPublished,
        grades: scores
          ? {
              create: [grace, linus].map((enrollment, index) => ({
                enrollmentId: enrollment.id,
                score: scores[index],
                gradedById: teacherId,
              })),
            }
          : undefined,
      },
    });
  }
  // Maths leaves 20% unplanned, so the demo Teacher can add an evaluation
  await evaluation(math.id, { title: 'Examen parcial', type: 'EXAM', weight: 30, dueInDays: -10, isPublished: true }, [18, 11]);
  await evaluation(math.id, { title: 'Taller de álgebra', type: 'ASSIGNMENT', weight: 20, dueInDays: -4, isPublished: true }, [16, 9]);
  await evaluation(math.id, { title: 'Proyecto final', type: 'PROJECT', weight: 30, dueInDays: 10, isPublished: true }, null);
  await evaluation(physics.id, { title: 'Quiz de cinemática', type: 'QUIZ', weight: 30, dueInDays: -5, isPublished: true }, [15, 13]);
  await evaluation(physics.id, { title: 'Informe de laboratorio', type: 'ASSIGNMENT', weight: 30, dueInDays: 14, isPublished: false }, null);

  // Labs: every lab granted and on, the exercise bank (truncated with the institutions) written back, two activities
  await prisma.institutionLab.createMany({
    data: LAB_CATALOG.map((lab) => ({ institutionId: institution.id, labKey: lab.key })),
  });
  for (const { id, labKey, prompt, answers, hint } of BUILT_IN_EXERCISES) {
    await prisma.languageExercise.create({ data: { id, labKey, prompt, answers, hint } });
  }
  await prisma.labAssignment.create({
    data: {
      courseId: physics.id,
      createdById: teacherId,
      labKey: 'gravity',
      title: 'Caída libre en otros planetas',
      instructions: 'Deja caer el objeto desde 20 m en la Tierra, la Luna y Marte, y anota cuánto tarda en cada uno.',
      dueAt: dayAt(5, 16),
    },
  });
  const verbs = BUILT_IN_EXERCISES.filter((exercise) => exercise.labKey === 'completions').slice(0, 5);
  await prisma.labAssignment.create({
    data: {
      courseId: language.id,
      createdById: teacherId,
      labKey: 'completions',
      title: 'Repaso de verbos',
      dueAt: dayAt(3, 16),
      exercises: { create: verbs.map((exercise, position) => ({ exerciseId: exercise.id, position })) },
    },
  });

  console.log(`\nSeeded "${institution.name}": group 1ro A, 3 subjects, 6 classes, 5 evaluations, every lab and 2 lab activities.\n`);
  console.log(`Every account below signs in with the password: ${PASSWORD}\n`);
  console.table(accounts.map(({ label, email, first, last }) => ({ role: label, email, name: `${first} ${last}` })));
  console.log('\nThe Platform Admin was left as it was (PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD).');
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
