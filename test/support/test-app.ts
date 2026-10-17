import type { Server } from 'node:http';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../../src/app.module.js';
import { APP_CONFIG, loadAppConfig } from '../../src/config/app-config.js';
import {
  LLM_PROVIDER,
  TEACHING_RECORDS,
  type LLMProvider,
} from '../../src/modules/ai/domain/ports/assistant.ports.js';
import { DASHBOARD_CACHE, DASHBOARD_QUERIES } from '../../src/modules/analytics/domain/ports/analytics.ports.js';
import { MESSAGE_REPOSITORY } from '../../src/modules/messaging/domain/ports/messaging.ports.js';
import {
  NOTIFICATION_REPOSITORY,
  REMINDER_QUERIES,
} from '../../src/modules/notifications/domain/ports/notification.ports.js';
import { GUARDIAN_REPOSITORY } from '../../src/modules/guardians/domain/ports/guardian.ports.js';
import { PASSWORD_RESET_TOKENS } from '../../src/modules/identity/domain/ports/password-reset-tokens.js';
import { EMAIL_PROVIDER } from '../../src/shared/domain/email/email-provider.js';
import { MockLLMProvider } from '../../src/modules/ai/infrastructure/mock-llm.provider.js';
import {
  PENSUM_REPOSITORY,
  SUBJECT_REPOSITORY,
} from '../../src/modules/academics/domain/ports/academic.repositories.js';
import {
  GROUP_REPOSITORY,
  MEMBER_DIRECTORY,
  PERIOD_REPOSITORY,
} from '../../src/modules/academics/domain/ports/group.repositories.js';
import {
  ATTENDANCE_BOOK,
  CLASSROOM_REPOSITORY,
  SESSION_RECORDER,
  VIDEO_TOKEN_ISSUER,
} from '../../src/modules/classroom/domain/ports/classroom.ports.js';
import { EVALUATION_REPOSITORY } from '../../src/modules/evaluations/domain/ports/evaluation.ports.js';
import {
  LAB_ACCESS_REPOSITORY,
  LAB_ASSIGNMENT_REPOSITORY,
  LANGUAGE_EXERCISE_REPOSITORY,
} from '../../src/modules/labs/domain/ports/lab.ports.js';
import { UserStatus } from '../../src/modules/identity/domain/entities/user.entity.js';
import { GOOGLE_OAUTH_GATEWAY } from '../../src/modules/identity/domain/ports/google-oauth.gateway.js';
import { MEMBER_REPOSITORY } from '../../src/modules/identity/domain/ports/member.repository.js';
import { PASSWORD_HASHER } from '../../src/modules/identity/domain/ports/password-hasher.js';
import { REFRESH_TOKEN_REVOCATIONS } from '../../src/modules/identity/domain/ports/refresh-token-revocations.js';
import { USER_REPOSITORY } from '../../src/modules/identity/domain/ports/user.repository.js';
import { INSTITUTION_REPOSITORY } from '../../src/modules/institutions/domain/ports/institution.repository.js';
import {
  DOCUMENT_STORAGE,
  OCR_PROVIDER,
  ONBOARDING_REPOSITORY,
} from '../../src/modules/onboarding/domain/ports/onboarding.ports.js';
import type { Role } from '../../src/shared/domain/auth/role.js';
import {
  AVAILABILITY_REPOSITORY,
  SCHEDULE_LOCK,
  SCHEDULE_REPOSITORY,
} from '../../src/modules/scheduling/domain/ports/scheduling.ports.js';
import { RATE_LIMITER } from '../../src/shared/domain/rate-limit/rate-limiter.js';
import { PrismaService } from '../../src/shared/infrastructure/prisma/prisma.service.js';
import { REDIS_CLIENT } from '../../src/shared/infrastructure/redis/redis.tokens.js';
import { createAdminFakes } from './admin.fakes.js';
import { InMemoryTeachingRecords } from './ai.fakes.js';
import { InMemoryDashboardCache, InMemoryDashboardQueries } from './analytics.fakes.js';
import { FakeVideoTokenIssuer, InMemoryClassroomRepository } from './classroom.fakes.js';
import {
  InMemoryMessageRepository,
  InMemoryNotificationRepository,
  InMemoryReminderQueries,
  RecordingEmailProvider,
} from './communication.fakes.js';
import { InMemoryEvaluationRepository } from './evaluation.fakes.js';
import { InMemoryGuardianRepository } from './guardian.fakes.js';
import {
  InMemoryLabAccessRepository,
  InMemoryLabAssignmentRepository,
  InMemoryLanguageExerciseRepository,
} from './lab.fakes.js';
import {
  InMemoryGroupRepository,
  InMemoryMemberDirectory,
  InMemoryPeriodRepository,
  type DirectoryEntry,
} from './group.fakes.js';
import {
  FakeGoogleGateway,
  FakePasswordHasher,
  InMemoryMemberRepository,
  InMemoryPasswordResetTokens,
  InMemoryRateLimiter,
  InMemoryRefreshTokenRevocations,
  InMemoryUserRepository,
  TEST_PASSWORD,
  type StoredMember,
} from './identity.fakes.js';
import { createOnboardingFakes } from './onboarding.fakes.js';
import {
  InMemoryAvailabilityRepository,
  InMemoryScheduleLock,
  InMemoryScheduleRepository,
} from './scheduling.fakes.js';

export const TEST_FRONTEND_URL = 'http://frontend.test';
export const TEST_RATE_LIMIT = 5;
export const TEST_INTERNAL_SECRET = 'internal-secret-for-tests';

/**
 * Boots the real AppModule (guards, pipes, filters, controllers, use cases)
 * with every outbound adapter replaced by an in-memory fake.
 */
export interface TestAppOptions {
  /** The model behind the assistant; the built-in mock, without its typing pauses, by default. */
  llm?: LLMProvider;
}

export async function createTestApp(extraControllers: Type[] = [], options: TestAppOptions = {}) {
  const users = new InMemoryUserRepository();
  const members = new InMemoryMemberRepository(users);
  const onboarding = createOnboardingFakes();
  // Stand in for the joins the Prisma adapter does across module tables
  onboarding.applications.lookupEnrollment = (userId) => members.pendingEnrollment(userId);
  onboarding.applications.lookupApplicant = (userId) => {
    const user = users.users.get(userId);
    return {
      userId,
      email: user?.email ?? '',
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
    };
  };
  onboarding.applications.onApproved = (application) =>
    members.activate(application.userId, application.confirmed ?? undefined);

  const admin = createAdminFakes();
  const periods = new InMemoryPeriodRepository();
  const directory = new InMemoryMemberDirectory();
  const toEntry = (member: StoredMember | null | undefined): DirectoryEntry | null => {
    const user = member ? users.users.get(member.userId) : undefined;
    return member && user
      ? {
          membershipId: member.membershipId,
          institutionId: member.institutionId,
          role: member.role,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
        }
      : null;
  };
  directory.lookup = (institutionId, membershipId) =>
    toEntry(members.findActive(institutionId, membershipId));
  directory.resolve = (membershipId) =>
    toEntry(members.members.find((member) => member.membershipId === membershipId));

  const groups = new InMemoryGroupRepository(admin.pensums, periods, directory);

  // Stand in for the joins the Prisma adapters do on memberships and users
  const notifications = new InMemoryNotificationRepository();
  notifications.lookupUser = (membershipId) =>
    members.members.find((member) => member.membershipId === membershipId)?.userId;
  notifications.lookupAddressee = (userId) => {
    const user = users.users.get(userId);
    return user && { email: user.email, firstName: user.firstName };
  };
  const messages = new InMemoryMessageRepository();
  messages.lookupMembers = (institutionId) => {
    const contacts = new Map<string, { userId: string; firstName: string; lastName: string; roles: Role[] }>();
    for (const member of members.members) {
      const user = users.users.get(member.userId);
      if (member.institutionId === institutionId && member.isActive && user?.isActive()) {
        const contact = contacts.get(user.id) ?? { userId: user.id, firstName: user.firstName, lastName: user.lastName, roles: [] };
        contact.roles.push(member.role);
        contacts.set(user.id, contact);
      }
    }
    return [...contacts.values()];
  };
  const guardians = new InMemoryGuardianRepository();
  guardians.lookupMember = (membershipId) => {
    const member = members.members.find((candidate) => candidate.membershipId === membershipId);
    const user = member && users.users.get(member.userId);
    return (
      member &&
      user && {
        membershipId,
        institutionId: member.institutionId,
        role: member.role,
        firstName: user.firstName,
        lastName: user.lastName,
      }
    );
  };
  guardians.lookupGroups = (studentMembershipId) =>
    groups.rows
      .filter((group) => group.studentIds.includes(studentMembershipId))
      .map((group) => ({ id: group.id, name: group.name }));
  const userOf = (membershipId: string) =>
    members.members.find((member) => member.membershipId === membershipId)?.userId ?? membershipId;
  messages.lookupGroups = (institutionId) =>
    groups.rows
      .filter((group) => group.institutionId === institutionId)
      .map((group) => ({
        teacherUserIds: [...group.teachers.values()].map(userOf),
        studentUserIds: group.studentIds.map(userOf),
      }));
  notifications.lookupGuardians = (studentMembershipId) =>
    guardians.links.filter((link) => link.studentId === studentMembershipId).map((link) => userOf(link.guardianId));
  messages.lookupLinks = (institutionId) =>
    guardians.links
      .filter((link) => link.institutionId === institutionId)
      .map((link) => ({ guardianUserId: userOf(link.guardianId), studentUserId: userOf(link.studentId) }));

  const fakes = {
    users,
    members,
    periods,
    groups,
    availability: new InMemoryAvailabilityRepository(),
    schedule: new InMemoryScheduleRepository(groups, directory),
    scheduleLock: new InMemoryScheduleLock(),
    classroom: new InMemoryClassroomRepository(groups, directory),
    videoTokens: new FakeVideoTokenIssuer(),
    evaluations: new InMemoryEvaluationRepository(groups, directory),
    labAccess: new InMemoryLabAccessRepository(),
    languageExercises: new InMemoryLanguageExerciseRepository(),
    labAssignments: new InMemoryLabAssignmentRepository(groups, directory),
    teaching: new InMemoryTeachingRecords(),
    dashboards: new InMemoryDashboardQueries(),
    notifications,
    emails: new RecordingEmailProvider(),
    reminders: new InMemoryReminderQueries(),
    messages,
    guardians,
    google: new FakeGoogleGateway(),
    revocations: new InMemoryRefreshTokenRevocations(),
    resetTokens: new InMemoryPasswordResetTokens(),
    rateLimiter: new InMemoryRateLimiter(),
    ...onboarding,
    ...admin,
  };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  })
    .overrideProvider(APP_CONFIG)
    .useValue(
      loadAppConfig({
        DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused',
        JWT_ACCESS_SECRET: 'a'.repeat(32),
        JWT_REFRESH_SECRET: 'b'.repeat(32),
        FRONTEND_URL: TEST_FRONTEND_URL,
        RATE_LIMIT_AUTH_MAX_ATTEMPTS: String(TEST_RATE_LIMIT),
        INTERNAL_SERVICE_SECRET: TEST_INTERNAL_SECRET,
        // The job is run by hand in the tests that are about it
        REMINDERS_ENABLED: 'false',
      }),
    )
    .overrideProvider(PrismaService)
    .useValue({})
    .overrideProvider(REDIS_CLIENT)
    .useValue({ disconnect: () => undefined })
    .overrideProvider(RATE_LIMITER)
    .useValue(fakes.rateLimiter)
    .overrideProvider(PASSWORD_HASHER)
    .useValue(new FakePasswordHasher())
    .overrideProvider(USER_REPOSITORY)
    .useValue(fakes.users)
    .overrideProvider(MEMBER_REPOSITORY)
    .useValue(fakes.members)
    .overrideProvider(GOOGLE_OAUTH_GATEWAY)
    .useValue(fakes.google)
    .overrideProvider(REFRESH_TOKEN_REVOCATIONS)
    .useValue(fakes.revocations)
    .overrideProvider(PASSWORD_RESET_TOKENS)
    .useValue(fakes.resetTokens)
    .overrideProvider(ONBOARDING_REPOSITORY)
    .useValue(fakes.applications)
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(fakes.storage)
    .overrideProvider(OCR_PROVIDER)
    .useValue(fakes.ocr)
    .overrideProvider(INSTITUTION_REPOSITORY)
    .useValue(fakes.institutions)
    .overrideProvider(SUBJECT_REPOSITORY)
    .useValue(fakes.subjects)
    .overrideProvider(PENSUM_REPOSITORY)
    .useValue(fakes.pensums)
    .overrideProvider(PERIOD_REPOSITORY)
    .useValue(fakes.periods)
    .overrideProvider(GROUP_REPOSITORY)
    .useValue(fakes.groups)
    .overrideProvider(MEMBER_DIRECTORY)
    .useValue(directory)
    .overrideProvider(AVAILABILITY_REPOSITORY)
    .useValue(fakes.availability)
    .overrideProvider(SCHEDULE_REPOSITORY)
    .useValue(fakes.schedule)
    .overrideProvider(SCHEDULE_LOCK)
    .useValue(fakes.scheduleLock)
    .overrideProvider(CLASSROOM_REPOSITORY)
    .useValue(fakes.classroom)
    .overrideProvider(SESSION_RECORDER)
    .useValue(fakes.classroom)
    .overrideProvider(ATTENDANCE_BOOK)
    .useValue(fakes.classroom)
    .overrideProvider(VIDEO_TOKEN_ISSUER)
    .useValue(fakes.videoTokens)
    .overrideProvider(EVALUATION_REPOSITORY)
    .useValue(fakes.evaluations)
    .overrideProvider(LAB_ACCESS_REPOSITORY)
    .useValue(fakes.labAccess)
    .overrideProvider(LANGUAGE_EXERCISE_REPOSITORY)
    .useValue(fakes.languageExercises)
    .overrideProvider(LAB_ASSIGNMENT_REPOSITORY)
    .useValue(fakes.labAssignments)
    .overrideProvider(TEACHING_RECORDS)
    .useValue(fakes.teaching)
    .overrideProvider(NOTIFICATION_REPOSITORY)
    .useValue(fakes.notifications)
    .overrideProvider(EMAIL_PROVIDER)
    .useValue(fakes.emails)
    .overrideProvider(REMINDER_QUERIES)
    .useValue(fakes.reminders)
    .overrideProvider(MESSAGE_REPOSITORY)
    .useValue(fakes.messages)
    .overrideProvider(GUARDIAN_REPOSITORY)
    .useValue(fakes.guardians)
    .overrideProvider(DASHBOARD_QUERIES)
    .useValue(fakes.dashboards)
    .overrideProvider(DASHBOARD_CACHE)
    .useValue(new InMemoryDashboardCache())
    .overrideProvider(LLM_PROVIDER)
    .useValue(options.llm ?? new MockLLMProvider(0))
    .compile();

  const app: INestApplication<App> = moduleRef.createNestApplication();
  app.use(cookieParser());
  // Listen once on a free port, so supertest does not start and stop the server around every request
  await app.listen(0);
  const server = app.getHttpServer();
  /** The same server as Node sees it, for what supertest's type does not offer. */
  const httpServer = app.getHttpServer() as unknown as Server;

  /** Signs in through the real endpoint and returns the access token. */
  async function tokenFor(email: string, password = TEST_PASSWORD): Promise<string> {
    const response = await request(server).post('/auth/login').send({ email, password });
    if (response.status !== 200) {
      throw new Error(`Login failed for ${email}: ${response.status}`);
    }
    return (response.body as { accessToken: string }).accessToken;
  }

  /**
   * Signs a newly registered member in and replaces their temporary password,
   * as they must before the API lets them do anything else.
   */
  async function tokenAfterPasswordChange(email: string, temporaryPassword: string) {
    const restricted = await tokenFor(email, temporaryPassword);
    const response = await request(server)
      .post('/auth/change-password')
      .set('Authorization', 'Bearer ' + restricted)
      .send({ currentPassword: temporaryPassword, newPassword: TEST_PASSWORD });
    if (response.status !== 200) {
      throw new Error('Password change failed for ' + email + ': ' + response.status);
    }
    // This change is setup: its "password changed" email is not one a test should find
    const told = fakes.emails.sent.findLastIndex((sent) => sent.to === email);
    if (told >= 0) {
      fakes.emails.sent.splice(told, 1);
    }
    return (response.body as { accessToken: string }).accessToken;
  }

  /** Seeds an active account holding `role` in the institution and signs it in. */
  async function signInAs(role: Role, institutionId: string, email = `${role}@example.com`) {
    const user = users.seed({ email: email.toLowerCase(), status: UserStatus.ACTIVE });
    const membership = { id: `membership-${user.id}`, institutionId, role };
    users.memberships.set(user.id, [membership]);
    return { user, membership, token: await tokenFor(user.email) };
  }

  async function signInAsPlatformAdmin() {
    const user = users.seed({ email: 'platform@example.com', isPlatformAdmin: true });
    return { user, token: await tokenFor(user.email) };
  }

  /**
   * Stops the app. Connections still open (a keep-alive socket, an answer
   * still streaming) are dropped first, so closing never waits on them.
   */
  async function close(): Promise<void> {
    httpServer.closeAllConnections();
    await app.close();
  }

  return {
    app,
    server,
    httpServer,
    close,
    tokenFor,
    tokenAfterPasswordChange,
    signInAs,
    signInAsPlatformAdmin,
    ...fakes,
  };
}

export type TestApp = Awaited<ReturnType<typeof createTestApp>>;
