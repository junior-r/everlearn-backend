import { DomainException } from '../../../shared/domain/domain.exception.js';

export const LabCategory = {
  PHYSICS: 'PHYSICS',
  MATHS: 'MATHS',
  LANGUAGE: 'LANGUAGE',
} as const;
export type LabCategory = (typeof LabCategory)[keyof typeof LabCategory];

/** Every lab the platform offers. Adding one means adding its key here and its screen in the frontend. */
export const LabKey = {
  GRAVITY: 'gravity',
  FORCES: 'forces',
  KINEMATICS: 'kinematics',
  PROJECTILE: 'projectile',
  FUNCTION_GRAPHER: 'function-grapher',
  SCIENTIFIC_CALCULATOR: 'scientific-calculator',
  EQUATION_SOLVER: 'equation-solver',
  COMPLETIONS: 'completions',
  DEFINITIONS: 'definitions',
} as const;
export type LabKey = (typeof LabKey)[keyof typeof LabKey];

export interface LabDefinition {
  key: LabKey;
  category: LabCategory;
}

/** The catalogue, in the order labs are listed. */
export const LAB_CATALOG: readonly LabDefinition[] = [
  { key: LabKey.GRAVITY, category: LabCategory.PHYSICS },
  { key: LabKey.FORCES, category: LabCategory.PHYSICS },
  { key: LabKey.KINEMATICS, category: LabCategory.PHYSICS },
  { key: LabKey.PROJECTILE, category: LabCategory.PHYSICS },
  { key: LabKey.FUNCTION_GRAPHER, category: LabCategory.MATHS },
  { key: LabKey.SCIENTIFIC_CALCULATOR, category: LabCategory.MATHS },
  { key: LabKey.EQUATION_SOLVER, category: LabCategory.MATHS },
  { key: LabKey.COMPLETIONS, category: LabCategory.LANGUAGE },
  { key: LabKey.DEFINITIONS, category: LabCategory.LANGUAGE },
];

/** The labs whose exercises are typed answers the backend scores. */
export const LANGUAGE_LABS: readonly LabKey[] = [LabKey.COMPLETIONS, LabKey.DEFINITIONS];

export function isLabKey(value: string): value is LabKey {
  return LAB_CATALOG.some((lab) => lab.key === value);
}

export function isLanguageLab(key: LabKey): boolean {
  return LANGUAGE_LABS.includes(key);
}

/** The two decisions about one lab in one institution. A lab never decided on is not granted. */
export interface InstitutionLab {
  labKey: LabKey;
  /** Set by a Platform Admin: whether the institution may use the lab at all. */
  granted: boolean;
  /** Set by the Institution Admin, among granted labs only. */
  enabled: boolean;
}

/** A lab is available only when the platform granted it and the institution left it on. */
export function isLabAvailable(decision: InstitutionLab | undefined): boolean {
  return decision !== undefined && decision.granted && decision.enabled;
}

/** The catalogue with the institution's decisions, missing ones read as not granted. */
export function withDecisions(decisions: InstitutionLab[]): Array<LabDefinition & InstitutionLab> {
  return LAB_CATALOG.map((lab) => {
    const decision = decisions.find((candidate) => candidate.labKey === lab.key);
    return { ...lab, labKey: lab.key, granted: decision?.granted ?? false, enabled: decision?.enabled ?? true };
  });
}

/** The available labs of an institution, in catalogue order. */
export function availableLabs(decisions: InstitutionLab[]): LabDefinition[] {
  return LAB_CATALOG.filter((lab) =>
    isLabAvailable(decisions.find((decision) => decision.labKey === lab.key)),
  );
}

/** An unknown lab, and one the institution may not use, look the same: not found. */
export class LabNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'LAB_NOT_FOUND', 'Lab not found');
  }
}

export class InstitutionNotFoundForLabsException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'INSTITUTION_NOT_FOUND', 'Institution not found');
  }
}
