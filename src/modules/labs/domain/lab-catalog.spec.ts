import {
  availableLabs,
  isLabAvailable,
  isLabKey,
  isLanguageLab,
  LAB_CATALOG,
  LabKey,
  withDecisions,
} from './lab-catalog.js';

describe('lab availability', () => {
  it('needs both the grant of the platform and the switch of the institution', () => {
    expect(isLabAvailable({ labKey: LabKey.GRAVITY, granted: true, enabled: true })).toBe(true);
    expect(isLabAvailable({ labKey: LabKey.GRAVITY, granted: true, enabled: false })).toBe(false);
    expect(isLabAvailable({ labKey: LabKey.GRAVITY, granted: false, enabled: true })).toBe(false);
    expect(isLabAvailable(undefined)).toBe(false);
  });

  it('lists the available labs in catalogue order, whatever order they were decided in', () => {
    const labs = availableLabs([
      { labKey: LabKey.DEFINITIONS, granted: true, enabled: true },
      { labKey: LabKey.FORCES, granted: true, enabled: false },
      { labKey: LabKey.GRAVITY, granted: true, enabled: true },
    ]);

    expect(labs.map((lab) => lab.key)).toEqual([LabKey.GRAVITY, LabKey.DEFINITIONS]);
  });

  it('reads a lab never decided on as not granted, and switched on for when it is', () => {
    const labs = withDecisions([{ labKey: LabKey.FORCES, granted: true, enabled: false }]);

    expect(labs).toHaveLength(LAB_CATALOG.length);
    expect(labs.find((lab) => lab.key === LabKey.GRAVITY)).toMatchObject({ granted: false, enabled: true });
    expect(labs.find((lab) => lab.key === LabKey.FORCES)).toMatchObject({ granted: true, enabled: false });
  });

  it('knows its keys and which labs are language labs', () => {
    expect(isLabKey('function-grapher')).toBe(true);
    expect(isLabKey('alchemy')).toBe(false);
    expect(isLanguageLab(LabKey.COMPLETIONS)).toBe(true);
    expect(isLanguageLab(LabKey.PROJECTILE)).toBe(false);
  });

  it('offers three categories: physics, maths and language', () => {
    expect(new Set(LAB_CATALOG.map((lab) => lab.category))).toEqual(new Set(['PHYSICS', 'MATHS', 'LANGUAGE']));
  });
});
