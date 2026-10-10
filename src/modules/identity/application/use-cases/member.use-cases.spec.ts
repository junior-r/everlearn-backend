import { createIdentityFakes } from '../../../../../test/support/identity.fakes.js';
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { UserStatus } from '../../domain/entities/user.entity.js';
import {
  EmailAlreadyRegisteredException,
  InstitutionNotFoundException,
  MemberRoleNotAllowedException,
} from '../../domain/exceptions/identity.exceptions.js';
import { EnsurePlatformAdminUseCase } from './ensure-platform-admin.use-case.js';
import { LoginWithPasswordUseCase } from './login-with-password.use-case.js';
import { ListMembersUseCase, RegisterMemberUseCase } from './member.use-cases.js';

const INSTITUTION = 'inst-1';

const institutionAdmin: AuthenticatedUser = {
  userId: 'admin-1',
  email: 'admin@example.com',
  isPlatformAdmin: false,
  memberships: [{ id: 'm-admin', institutionId: INSTITUTION, role: Role.ADMIN }],
};
const platformAdmin: AuthenticatedUser = {
  userId: 'root',
  email: 'root@example.com',
  isPlatformAdmin: true,
  memberships: [],
};

function setup() {
  const fakes = createIdentityFakes();
  const register = new RegisterMemberUseCase(
    fakes.members,
    fakes.users,
    fakes.hasher,
    () => 'temp-password-1',
  );
  return { ...fakes, register, login: new LoginWithPasswordUseCase(fakes.users, fakes.hasher, fakes.sessions) };
}

const student = {
  actor: institutionAdmin,
  institutionId: INSTITUTION,
  email: ' Grace@Example.COM ',
  firstName: ' Grace ',
  lastName: 'Hopper',
  role: Role.STUDENT,
};

describe('RegisterMemberUseCase', () => {
  it.each([Role.STUDENT, Role.TEACHER])(
    'registers a %s as pending onboarding with an inactive membership',
    async (role) => {
      const { register } = setup();

      const { member } = await register.execute({ ...student, role });

      expect(member).toMatchObject({
        email: 'grace@example.com',
        firstName: 'Grace',
        role,
        status: UserStatus.PENDING_ONBOARDING,
        isActive: false,
      });
    },
  );

  it('returns the temporary password once and stores only its hash', async () => {
    const { register, users } = setup();

    const { member, temporaryPassword } = await register.execute(student);

    expect(temporaryPassword).toBe('temp-password-1');
    const stored = await users.findById(member.userId);
    expect(stored?.passwordHash).toBe('hashed:temp-password-1');
    expect(JSON.stringify(member)).not.toContain('temp-password-1');
  });

  it('lets the new member sign in with the temporary password, holding no role until approved', async () => {
    const { register, login } = setup();
    const { temporaryPassword } = await register.execute(student);

    const session = await login.execute({ email: 'grace@example.com', password: temporaryPassword });

    expect(session.user.status).toBe(UserStatus.PENDING_ONBOARDING);
    expect(session.user.memberships).toEqual([]);
  });

  it('generates a long random password by default', async () => {
    const { members, users, hasher } = createIdentityFakes();
    const register = new RegisterMemberUseCase(members, users, hasher);

    const first = await register.execute(student);
    const second = await register.execute({ ...student, email: 'other@example.com' });

    expect(first.temporaryPassword).toHaveLength(16);
    expect(first.temporaryPassword).not.toBe(second.temporaryPassword);
  });

  it.each([Role.ADMIN, Role.COORDINATOR, Role.GUARDIAN])(
    'forbids an Institution Admin from registering a %s',
    async (role) => {
      const { register, users } = setup();

      await expect(register.execute({ ...student, role })).rejects.toBeInstanceOf(
        MemberRoleNotAllowedException,
      );
      expect(users.users.size).toBe(0);
    },
  );

  it('lets a Platform Admin appoint an Institution Admin, who is active immediately', async () => {
    const { register, login } = setup();

    const { member, temporaryPassword } = await register.execute({
      ...student,
      actor: platformAdmin,
      role: Role.ADMIN,
    });

    expect(member).toMatchObject({ status: UserStatus.ACTIVE, isActive: true });
    const session = await login.execute({ email: member.email, password: temporaryPassword });
    expect(session.user.memberships).toEqual([
      { id: member.membershipId, institutionId: INSTITUTION, role: Role.ADMIN },
    ]);
  });

  it('rejects an email that already has an account, ignoring case', async () => {
    const { register, users } = setup();
    users.seed({ email: 'grace@example.com' });

    await expect(register.execute(student)).rejects.toBeInstanceOf(EmailAlreadyRegisteredException);
    expect(users.users.size).toBe(1);
  });

  it('reports a missing institution', async () => {
    const { register, members } = setup();
    members.knownInstitutionIds = new Set(['another-institution']);

    await expect(register.execute(student)).rejects.toBeInstanceOf(InstitutionNotFoundException);
  });
});

describe('ListMembersUseCase', () => {
  it("lists only the institution's own members", async () => {
    const { register, members } = setup();
    await register.execute(student);
    await register.execute({ ...student, email: 'other@example.com', institutionId: 'inst-2' });

    const listed = await new ListMembersUseCase(members).execute(INSTITUTION);

    expect(listed.map((member) => member.email)).toEqual(['grace@example.com']);
  });
});

describe('EnsurePlatformAdminUseCase', () => {
  const credentials = { email: 'Root@Example.com', password: 'a-long-admin-password' };

  it('creates an active, verified Platform Admin that can sign in', async () => {
    const { users, hasher, login } = setup();
    const useCase = new EnsurePlatformAdminUseCase(users, hasher);

    await expect(useCase.execute(credentials)).resolves.toBe(true);

    const session = await login.execute({ email: 'root@example.com', password: credentials.password });
    expect(session.user).toMatchObject({ isPlatformAdmin: true, status: UserStatus.ACTIVE });
  });

  it('never touches an existing account, so restarting cannot reset a password or grant admin rights', async () => {
    const { users, hasher } = setup();
    const existing = users.seed({ email: 'root@example.com', passwordHash: 'hashed:changed-since' });
    const useCase = new EnsurePlatformAdminUseCase(users, hasher);

    await expect(useCase.execute(credentials)).resolves.toBe(false);

    const stored = await users.findById(existing.id);
    expect(stored?.passwordHash).toBe('hashed:changed-since');
    expect(stored?.isPlatformAdmin).toBe(false);
  });
});
