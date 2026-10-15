import type { AvailableLabs } from '../../../../shared/domain/labs/available-labs.js';
import {
  availableLabs,
  InstitutionNotFoundForLabsException,
  isLabAvailable,
  isLabKey,
  LabNotFoundException,
  withDecisions,
  type LabCategory,
  type LabDefinition,
  type LabKey,
} from '../../domain/lab-catalog.js';
import type { LabAccessRepository } from '../../domain/ports/lab.ports.js';

/** A lab of the catalogue with both decisions about it, as a Platform Admin sees it. */
export interface LabGrantView {
  key: LabKey;
  category: LabCategory;
  granted: boolean;
  enabled: boolean;
}

/** A granted lab and its switch, as the Institution Admin sees it. */
export interface LabSettingView {
  key: LabKey;
  category: LabCategory;
  enabled: boolean;
}

function requireLabKey(labKey: string): LabKey {
  if (!isLabKey(labKey)) {
    throw new LabNotFoundException();
  }
  return labKey;
}

/** The lab, if the institution may use it now; any other lab is not found. Shared by every Labs use case. */
export async function requireAvailableLab(
  access: LabAccessRepository,
  institutionId: string,
  labKey: string,
): Promise<LabKey> {
  const key = requireLabKey(labKey);
  const decisions = await access.list(institutionId);
  if (!isLabAvailable(decisions.find((decision) => decision.labKey === key))) {
    throw new LabNotFoundException();
  }
  return key;
}

async function requireInstitution(access: LabAccessRepository, institutionId: string): Promise<void> {
  if (!(await access.institutionExists(institutionId))) {
    throw new InstitutionNotFoundForLabsException();
  }
}

export class ListInstitutionLabsUseCase {
  constructor(private readonly access: LabAccessRepository) {}

  /** The whole catalogue for one institution, with what the platform granted it and what it left on. */
  async execute(institutionId: string): Promise<LabGrantView[]> {
    await requireInstitution(this.access, institutionId);
    return withDecisions(await this.access.list(institutionId)).map(({ key, category, granted, enabled }) => ({
      key,
      category,
      granted,
      enabled,
    }));
  }
}

export class SetLabGrantUseCase {
  constructor(private readonly access: LabAccessRepository) {}

  /** Grants a lab to an institution, or withdraws it; only a Platform Admin may. */
  async execute(institutionId: string, labKey: string, granted: boolean): Promise<void> {
    const key = requireLabKey(labKey);
    await requireInstitution(this.access, institutionId);
    await this.access.setGranted(institutionId, key, granted);
  }
}

export class ListLabSettingsUseCase {
  constructor(private readonly access: LabAccessRepository) {}

  /** The labs granted to the institution, each with its switch. Labs not granted are not shown. */
  async execute(institutionId: string): Promise<LabSettingView[]> {
    return withDecisions(await this.access.list(institutionId))
      .filter((lab) => lab.granted)
      .map(({ key, category, enabled }) => ({ key, category, enabled }));
  }
}

export class SetLabEnabledUseCase {
  constructor(private readonly access: LabAccessRepository) {}

  /** Switches a granted lab on or off for the institution. A lab not granted is not found. */
  async execute(institutionId: string, labKey: string, enabled: boolean): Promise<void> {
    const key = requireLabKey(labKey);
    const decisions = await this.access.list(institutionId);
    if (!decisions.some((decision) => decision.labKey === key && decision.granted)) {
      throw new LabNotFoundException();
    }
    await this.access.setEnabled(institutionId, key, enabled);
  }
}

export class ListAvailableLabsUseCase {
  constructor(private readonly access: LabAccessRepository) {}

  /** The labs a member of the institution may open, in catalogue order. */
  async execute(institutionId: string): Promise<LabDefinition[]> {
    return availableLabs(await this.access.list(institutionId));
  }
}

/** Answers other modules (the classroom) with the same rule the Labs screens follow. */
export class LabAvailability implements AvailableLabs {
  constructor(private readonly access: LabAccessRepository) {}

  async keysFor(institutionId: string): Promise<string[]> {
    return availableLabs(await this.access.list(institutionId)).map((lab) => lab.key);
  }
}
