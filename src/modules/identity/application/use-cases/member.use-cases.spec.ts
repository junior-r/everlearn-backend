import { createIdentityFakes } from '../../../../../test/support/identity.fakes.js';
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { registrableRoles } from '../../../../shared/domain/auth/registration.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { UserStatus } from '../../domain/entities/user.entity.js';
import {
  AccountSuspendedException,
  MemberAlreadyRegisteredException,
  InstitutionNotFoundException,
  MemberRoleNotAllowedException,
} from '../../domain/exceptions/identity.exceptions.js';
import { EnsurePlatformAdminUseCase } from './ensure-platform-admin.use-case.js';
import { LoginWithPasswordUseCase } from './login-with-password.use-case.js';
import {
  ListMembersUseCase,
  PageMembersUseCase,
  RegisterMemberUseCase,
  SearchMembersUseCase,
} from './member.use-cases.js';

const INSTITUTION = 'inst-1';

const institutionAdmin: AuthenticatedUser = {
  userId: 'admin-1',
  email: 'admin@example.com',
  isPlatformAdmin: false,
  mustChangePassword: false,
  memberships: [{ id: 'm-admin', institutionId: INSTITUTION, role: Role.ADMIN }],
};
const platformAdmin: AuthenticatedUser = {
  userId: 'root',
  email: 'root@example.com',
  isPlatformAdmin: true,
  mustChangePassword: false,
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

  it('lets the new member sign in with the temporary password, holding no role until their ID is checked', async () => {
    const { register, login } = setup();
    const { temporaryPassword } = await register.execute(student);

    const session = await login.execute({ email: 'grace@example.com', password: temporaryPassword ?? "" });

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

  it('forbids an Institution Admin from registering another Institution Admin', async () => {
    const { register, users } = setup();

    await expect(register.execute({ ...student, role: Role.ADMIN })).rejects.toBeInstanceOf(
      MemberRoleNotAllowedException,
    );
    expect(users.users.size).toBe(0);
  });

  it('lets an Institution Admin register a Guardian, who must pass the ID check like everyone else', async () => {
    const { register, members } = setup();

    await register.execute({ ...student, role: Role.GUARDIAN });

    expect(members.members[0]).toMatchObject({ role: Role.GUARDIAN, isActive: false });
  });

  describe('the registration hierarchy', () => {
    const staff: AuthenticatedUser = {
      ...institutionAdmin,
      userId: 'staff-1',
      memberships: [{ id: 'm-staff', institutionId: INSTITUTION, role: Role.STAFF }],
    };
    const everyRole = Object.values(Role);
    const allowedFor = (actor: AuthenticatedUser, institutionId = INSTITUTION) =>
      registrableRoles(actor, institutionId);

    it('lets each level register only the levels below it', () => {
      expect(allowedFor(platformAdmin)).toEqual([
        Role.ADMIN, Role.COORDINATOR, Role.TEACHER, Role.STAFF, Role.GUARDIAN, Role.STUDENT,
      ]);
      expect(allowedFor(institutionAdmin)).toEqual([
        Role.COORDINATOR, Role.TEACHER, Role.STAFF, Role.GUARDIAN, Role.STUDENT,
      ]);
      expect(allowedFor(staff)).toEqual([Role.GUARDIAN, Role.STUDENT]);
    });

    it('lets a Principal enrol Students and Guardians at the desk, like Staff', () => {
      const principal = { ...staff, memberships: [{ id: 'm', institutionId: INSTITUTION, role: Role.COORDINATOR }] };

      expect(allowedFor(principal)).toEqual([Role.GUARDIAN, Role.STUDENT]);
    });

    it.each([Role.TEACHER, Role.STUDENT, Role.GUARDIAN])(
      'lets a %s register nobody',
      (role) => {
        const actor = { ...staff, memberships: [{ id: 'm', institutionId: INSTITUTION, role }] };

        expect(allowedFor(actor)).toEqual([]);
      },
    );

    it('never lets anyone register a peer or a superior', () => {
      expect(allowedFor(institutionAdmin)).not.toContain(Role.ADMIN);
      expect(allowedFor(staff)).not.toContain(Role.STAFF);
      for (const role of everyRole) {
        expect(allowedFor({ ...staff, memberships: [] })).not.toContain(role);
      }
    });

    it('judges the actor by their role in the institution being acted on, not elsewhere', () => {
      // Institution Admin of another institution, Staff here
      const actor: AuthenticatedUser = {
        ...staff,
        memberships: [
          { id: 'm1', institutionId: 'other-institution', role: Role.ADMIN },
          { id: 'm2', institutionId: INSTITUTION, role: Role.STAFF },
        ],
      };

      expect(allowedFor(actor)).toEqual([Role.GUARDIAN, Role.STUDENT]);
      expect(allowedFor(actor, 'other-institution')).toContain(Role.TEACHER);
      expect(allowedFor(actor, 'a-third-institution')).toEqual([]);
    });

    it('uses the higher role when someone is both Admin and Staff in the same institution', () => {
      const actor: AuthenticatedUser = {
        ...staff,
        memberships: [
          { id: 'm1', institutionId: INSTITUTION, role: Role.STAFF },
          { id: 'm2', institutionId: INSTITUTION, role: Role.ADMIN },
        ],
      };

      expect(allowedFor(actor)).toContain(Role.TEACHER);
    });

    it('lets Staff register a Student but not a Teacher', async () => {
      const { register } = setup();

      await expect(register.execute({ ...student, actor: staff })).resolves.toMatchObject({
        member: { role: Role.STUDENT, status: UserStatus.PENDING_ONBOARDING },
      });
      await expect(
        register.execute({ ...student, actor: staff, email: 't@example.com', role: Role.TEACHER }),
      ).rejects.toBeInstanceOf(MemberRoleNotAllowedException);
    });

    it.each([Role.STAFF, Role.COORDINATOR])(
      'lets an Institution Admin register %s, who must still show their ID',
      async (role) => {
        const { register } = setup();

        const { member } = await register.execute({ ...student, role });

        expect(member).toMatchObject({ role, status: UserStatus.PENDING_ONBOARDING, isActive: false });
      },
    );
  });

  it('lets a Platform Admin appoint an Institution Admin, who is active immediately', async () => {
    const { register, login } = setup();

    const { member, temporaryPassword } = await register.execute({
      ...student,
      actor: platformAdmin,
      role: Role.ADMIN,
    });

    expect(member).toMatchObject({ status: UserStatus.ACTIVE, isActive: true });
    const session = await login.execute({ email: member.email, password: temporaryPassword ?? "" });
    expect(session.user.memberships).toEqual([
      { id: member.membershipId, institutionId: INSTITUTION, role: Role.ADMIN },
    ]);
  });

  describe('when the email already has an account (one person, several institutions)', () => {
    it('adds a membership to the existing account instead of creating or refusing', async () => {
      const { register, users, login } = setup();
      const existing = users.seed({ email: 'grace@example.com', firstName: 'Grace', lastName: 'Hopper' });
      users.memberships.set(existing.id, [{ id: 'm-a', institutionId: 'inst-a', role: Role.TEACHER }]);

      const { member, temporaryPassword } = await register.execute({
        ...student,
        email: ' GRACE@example.com ',
        firstName: 'Typed Differently',
      });

      expect(users.users.size).toBe(1);
      expect(member).toMatchObject({ userId: existing.id, role: Role.STUDENT, firstName: 'Grace' });
      // They keep their own credentials: no temporary password is issued and theirs is untouched
      expect(temporaryPassword).toBeNull();
      const session = await login.execute({ email: 'grace@example.com', password: 'correct-password' });
      expect(session.user.mustChangePassword).toBe(false);
      expect(session.user.memberships).toEqual([
        { id: 'm-a', institutionId: 'inst-a', role: Role.TEACHER },
        { id: member.membershipId, institutionId: INSTITUTION, role: Role.STUDENT },
      ]);
    });

    it('activates the new role at once for someone already verified', async () => {
      const { register, users } = setup();
      users.seed({ email: 'grace@example.com', status: UserStatus.ACTIVE });

      const { member } = await register.execute(student);

      expect(member).toMatchObject({ status: UserStatus.ACTIVE, isActive: true });
    });

    it('keeps the new role inactive for someone whose ID has not been checked yet', async () => {
      const { register, users, members } = setup();
      const pending = users.seed({ email: 'grace@example.com', status: UserStatus.PENDING_ONBOARDING });

      const { member } = await register.execute(student);

      expect(member).toMatchObject({ status: UserStatus.PENDING_ONBOARDING, isActive: false });
      expect(await users.findActiveMemberships(pending.id)).toEqual([]);

      // One approval verifies the person, which unlocks every role they were registered for
      members.activate(pending.id);
      expect(await users.findActiveMemberships(pending.id)).toHaveLength(1);
    });

    it('lets a Platform Admin appoint a pending person as Institution Admin, activating their account', async () => {
      const { register, users } = setup();
      const pending = users.seed({ email: 'grace@example.com', status: UserStatus.PENDING_ONBOARDING });

      const { member } = await register.execute({ ...student, actor: platformAdmin, role: Role.ADMIN });

      expect(member).toMatchObject({ isActive: true, status: UserStatus.ACTIVE });
      expect((await users.findById(pending.id))?.status).toBe(UserStatus.ACTIVE);
    });

    it('refuses the same role in the same institution twice, but allows a second role', async () => {
      const { register, users } = setup();
      users.seed({ email: 'grace@example.com' });
      await register.execute(student);

      await expect(register.execute(student)).rejects.toBeInstanceOf(MemberAlreadyRegisteredException);
      await expect(register.execute({ ...student, role: Role.TEACHER })).resolves.toBeDefined();
    });

    it('refuses to add a role to a suspended account', async () => {
      const { register, users, members } = setup();
      users.seed({ email: 'grace@example.com', status: UserStatus.SUSPENDED });

      await expect(register.execute(student)).rejects.toBeInstanceOf(AccountSuspendedException);
      expect(members.members).toHaveLength(0);
    });

    it('still applies the role rules: an Institution Admin cannot make an existing user an admin', async () => {
      const { register, users, members } = setup();
      users.seed({ email: 'grace@example.com' });

      await expect(register.execute({ ...student, role: Role.ADMIN })).rejects.toBeInstanceOf(
        MemberRoleNotAllowedException,
      );
      expect(members.members).toHaveLength(0);
    });
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
    // Only a Platform Admin may act on an institution they hold no role in
    await register.execute({
      ...student,
      actor: platformAdmin,
      email: 'other@example.com',
      institutionId: 'inst-2',
    });

    const listed = await new ListMembersUseCase(members).execute(INSTITUTION);

    expect(listed.map((member) => member.email)).toEqual(['grace@example.com']);
  });
});

describe('SearchMembersUseCase', () => {
  async function school() {
    const ctx = setup();
    const add = async (firstName: string, lastName: string, role: Role, institutionId = INSTITUTION) =>
      (
        await ctx.register.execute({
          ...student,
          actor: platformAdmin,
          email: `${firstName}.${lastName}.${institutionId}@example.com`.toLowerCase(),
          firstName,
          lastName,
          role,
          institutionId,
        })
      ).member;
    const grace = await add('Grace', 'Hopper', Role.STUDENT);
    await add('Graciela', 'Hopkins', Role.STUDENT);
    await add('Grace', 'Kelly', Role.GUARDIAN);
    await add('Grace', 'Hopper', Role.STUDENT, 'inst-2');
    ctx.members.documentNumbers.set(grace.userId, 'V-12345678');
    const search = new SearchMembersUseCase(ctx.members);
    const names = async (role: Role, query: string, institutionId = INSTITUTION) =>
      (await search.execute(institutionId, role, query)).map((match) => `${match.firstName} ${match.lastName}`);
    return { ...ctx, grace, search, names };
  }

  it('finds members of the role by any part of their name, whatever the case, in their own institution', async () => {
    const { names } = await school();

    expect(await names(Role.STUDENT, 'gra')).toEqual(['Graciela Hopkins', 'Grace Hopper']);
    expect(await names(Role.STUDENT, '  HOPPER grace ')).toEqual(['Grace Hopper']);
    expect(await names(Role.GUARDIAN, 'grace')).toEqual(['Grace Kelly']);
    expect(await names(Role.STUDENT, 'kelly')).toEqual([]);
  });

  it('leaves out whoever cannot be chosen yet when only active members are asked for', async () => {
    const { search, members, grace } = await school();
    const active = () => search.execute(INSTITUTION, Role.STUDENT, 'gra', true);

    // Both Students are still pending onboarding
    expect(await active()).toEqual([]);
    members.activate(grace.userId, { firstName: 'Grace', lastName: 'Hopper' });

    expect((await active()).map((match) => match.membershipId)).toEqual([grace.membershipId]);
    expect(await search.execute(INSTITUTION, Role.STUDENT, 'gra')).toHaveLength(2);
  });

  it('finds a member by their document number and returns it, to tell namesakes apart', async () => {
    const { search, grace } = await school();

    expect(await search.execute(INSTITUTION, Role.STUDENT, '12345')).toEqual([
      {
        membershipId: grace.membershipId,
        firstName: 'Grace',
        lastName: 'Hopper',
        email: grace.email,
        documentNumber: 'V-12345678',
      },
    ]);
  });

  it('lists nobody for a search too short to mean anything, and never more than a few', async () => {
    const { names, register } = await school();
    for (let index = 0; index < 12; index += 1) {
      await register.execute({
        ...student,
        actor: platformAdmin,
        email: `clone${index}@example.com`,
        firstName: 'Clon',
        lastName: `Número ${String(index).padStart(2, '0')}`,
      });
    }

    expect(await names(Role.STUDENT, ' g ')).toEqual([]);
    expect(await names(Role.STUDENT, '')).toEqual([]);
    expect(await names(Role.STUDENT, 'clon')).toHaveLength(10);
  });
});

describe('PageMembersUseCase', () => {
  async function school() {
    const ctx = setup();
    for (let index = 0; index < 45; index += 1) {
      await ctx.register.execute({
        ...student,
        actor: platformAdmin,
        email: `member${index}@example.com`,
        firstName: 'Estudiante',
        lastName: `Apellido ${String(index).padStart(2, '0')}`,
        role: index < 43 ? Role.STUDENT : Role.TEACHER,
        institutionId: index === 44 ? 'inst-2' : INSTITUTION,
      });
    }
    return { ...ctx, pages: new PageMembersUseCase(ctx.members) };
  }

  it('returns twenty members at a time, by last name, with how many there are in all', async () => {
    const { pages } = await school();

    const first = await pages.execute(INSTITUTION, {});
    const last = await pages.execute(INSTITUTION, { page: 3 });

    expect(first).toMatchObject({ total: 44, page: 1, pageSize: 20 });
    expect(first.items).toHaveLength(20);
    expect(first.items[0].lastName).toBe('Apellido 00');
    expect(last.items.map((member) => member.lastName)).toEqual([
      'Apellido 40',
      'Apellido 41',
      'Apellido 42',
      'Apellido 43',
    ]);
    expect((await pages.execute(INSTITUTION, { page: 9 })).items).toEqual([]);
  });

  it('narrows by what was typed, including the email, and by role, inside the institution only', async () => {
    const { pages } = await school();

    expect((await pages.execute(INSTITUTION, { query: 'MEMBER7@' })).items.map((member) => member.email)).toEqual([
      'member7@example.com',
    ]);
    expect(await pages.execute(INSTITUTION, { role: Role.TEACHER })).toMatchObject({ total: 1 });
    expect(await pages.execute(INSTITUTION, { query: 'apellido 42', role: Role.STUDENT })).toMatchObject({ total: 1 });
    expect(await pages.execute('inst-2', {})).toMatchObject({ total: 1 });
    expect(await pages.execute(INSTITUTION, { query: 'nadie' })).toMatchObject({ total: 0, items: [] });
  });
});

describe('EnsurePlatformAdminUseCase', () => {
  const credentials = { email: 'Root@Example.com', password: 'a-long-admin-password' };

  it('creates an active, verified Platform Admin that can sign in', async () => {
    const { users, hasher, login } = setup();
    const useCase = new EnsurePlatformAdminUseCase(users, hasher);

    await expect(useCase.execute(credentials)).resolves.toBe(true);

    const session = await login.execute({ email: 'root@example.com', password: credentials.password });
    expect(session.user).toMatchObject({ isPlatformAdmin: true,
  mustChangePassword: false, status: UserStatus.ACTIVE });
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
