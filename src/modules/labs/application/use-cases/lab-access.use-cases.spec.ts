import { InMemoryLabAccessRepository } from '../../../../../test/support/lab.fakes.js';
import {
  InstitutionNotFoundForLabsException,
  LAB_CATALOG,
  LabKey,
  LabNotFoundException,
} from '../../domain/lab-catalog.js';
import {
  LabAvailability,
  ListAvailableLabsUseCase,
  ListInstitutionLabsUseCase,
  ListLabSettingsUseCase,
  requireAvailableLab,
  SetLabEnabledUseCase,
  SetLabGrantUseCase,
} from './lab-access.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';

function setup() {
  const access = new InMemoryLabAccessRepository();
  return {
    access,
    grants: new ListInstitutionLabsUseCase(access),
    grant: new SetLabGrantUseCase(access),
    settings: new ListLabSettingsUseCase(access),
    enable: new SetLabEnabledUseCase(access),
    available: new ListAvailableLabsUseCase(access),
    availability: new LabAvailability(access),
  };
}

describe('granting labs (Platform Admin)', () => {
  it('shows the whole catalogue, nothing granted to a new institution', async () => {
    const ctx = setup();

    const labs = await ctx.grants.execute(A);

    expect(labs).toHaveLength(LAB_CATALOG.length);
    expect(labs.every((lab) => !lab.granted)).toBe(true);
  });

  it('grants a lab to one institution only', async () => {
    const ctx = setup();

    await ctx.grant.execute(A, LabKey.GRAVITY, true);

    expect((await ctx.available.execute(A)).map((lab) => lab.key)).toEqual([LabKey.GRAVITY]);
    expect(await ctx.available.execute(B)).toEqual([]);
  });

  it('withdraws a lab, and granting it again keeps the switch the institution had chosen', async () => {
    const ctx = setup();
    await ctx.grant.execute(A, LabKey.GRAVITY, true);
    await ctx.enable.execute(A, LabKey.GRAVITY, false);

    await ctx.grant.execute(A, LabKey.GRAVITY, false);
    await ctx.grant.execute(A, LabKey.GRAVITY, true);

    expect((await ctx.grants.execute(A)).find((lab) => lab.key === LabKey.GRAVITY)).toMatchObject({
      granted: true,
      enabled: false,
    });
  });

  it('refuses an unknown lab and an unknown institution', async () => {
    const ctx = setup();
    ctx.access.missing.add(B);

    await expect(ctx.grant.execute(A, 'alchemy', true)).rejects.toBeInstanceOf(LabNotFoundException);
    await expect(ctx.grant.execute(B, LabKey.GRAVITY, true)).rejects.toBeInstanceOf(
      InstitutionNotFoundForLabsException,
    );
    await expect(ctx.grants.execute(B)).rejects.toBeInstanceOf(InstitutionNotFoundForLabsException);
  });
});

describe('switching labs (Institution Admin)', () => {
  it('lists only the granted labs, each with its switch', async () => {
    const ctx = setup();
    await ctx.grant.execute(A, LabKey.FORCES, true);
    await ctx.grant.execute(A, LabKey.COMPLETIONS, true);
    await ctx.enable.execute(A, LabKey.COMPLETIONS, false);

    expect(await ctx.settings.execute(A)).toEqual([
      { key: LabKey.FORCES, category: 'PHYSICS', enabled: true },
      { key: LabKey.COMPLETIONS, category: 'LANGUAGE', enabled: false },
    ]);
  });

  it('turns a granted lab off and on again for its members', async () => {
    const ctx = setup();
    await ctx.grant.execute(A, LabKey.FORCES, true);

    await ctx.enable.execute(A, LabKey.FORCES, false);
    expect(await ctx.available.execute(A)).toEqual([]);

    await ctx.enable.execute(A, LabKey.FORCES, true);
    expect((await ctx.available.execute(A)).map((lab) => lab.key)).toEqual([LabKey.FORCES]);
  });

  it('cannot switch on a lab the platform did not grant: it is not found', async () => {
    const ctx = setup();
    await ctx.grant.execute(A, LabKey.FORCES, true);
    await ctx.grant.execute(A, LabKey.FORCES, false);

    await expect(ctx.enable.execute(A, LabKey.GRAVITY, true)).rejects.toBeInstanceOf(LabNotFoundException);
    await expect(ctx.enable.execute(A, LabKey.FORCES, true)).rejects.toBeInstanceOf(LabNotFoundException);
    await expect(ctx.enable.execute(A, 'alchemy', true)).rejects.toBeInstanceOf(LabNotFoundException);
    expect(await ctx.available.execute(A)).toEqual([]);
  });
});

describe('available labs', () => {
  it('answers the classroom with the same rule, as keys', async () => {
    const ctx = setup();
    ctx.access.grantAll(A, [LabKey.DEFINITIONS, LabKey.GRAVITY]);
    await ctx.enable.execute(A, LabKey.DEFINITIONS, false);

    expect(await ctx.availability.keysFor(A)).toEqual([LabKey.GRAVITY]);
  });

  it('lets a use case go on only with an available lab', async () => {
    const ctx = setup();
    ctx.access.grantAll(A, [LabKey.GRAVITY]);

    await expect(requireAvailableLab(ctx.access, A, 'gravity')).resolves.toBe(LabKey.GRAVITY);
    await expect(requireAvailableLab(ctx.access, A, 'forces')).rejects.toBeInstanceOf(LabNotFoundException);
    await expect(requireAvailableLab(ctx.access, B, 'gravity')).rejects.toBeInstanceOf(LabNotFoundException);
  });
});
