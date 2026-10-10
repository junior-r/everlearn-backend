import { normalizeCode, type Pensum } from '../../domain/entities/academic.entities.js';
import {
  PensumNotFoundException,
  SubjectNotFoundException,
} from '../../domain/exceptions/academic.exceptions.js';
import type {
  PensumChanges,
  PensumRepository,
  PensumSubjectPlacement,
  SubjectRepository,
} from '../../domain/ports/academic.repositories.js';

export class ListPensumsUseCase {
  constructor(private readonly pensums: PensumRepository) {}

  execute(institutionId: string): Promise<Pensum[]> {
    return this.pensums.list(institutionId);
  }
}

export class GetPensumUseCase {
  constructor(private readonly pensums: PensumRepository) {}

  async execute(institutionId: string, id: string): Promise<Pensum> {
    const pensum = await this.pensums.findById(institutionId, id);
    if (!pensum) {
      throw new PensumNotFoundException();
    }
    return pensum;
  }
}

export class CreatePensumUseCase {
  constructor(private readonly pensums: PensumRepository) {}

  execute(
    institutionId: string,
    input: { code: string; name: string; version?: number },
  ): Promise<Pensum> {
    return this.pensums.create(institutionId, {
      code: normalizeCode(input.code),
      name: input.name.trim(),
      version: input.version ?? 1,
    });
  }
}

export class UpdatePensumUseCase {
  constructor(private readonly pensums: PensumRepository) {}

  async execute(institutionId: string, id: string, changes: PensumChanges): Promise<Pensum> {
    const updated = await this.pensums.update(institutionId, id, {
      ...changes,
      name: changes.name?.trim(),
    });
    if (!updated) {
      throw new PensumNotFoundException();
    }
    return updated;
  }
}

export class DeletePensumUseCase {
  constructor(private readonly pensums: PensumRepository) {}

  async execute(institutionId: string, id: string): Promise<void> {
    if (!(await this.pensums.delete(institutionId, id))) {
      throw new PensumNotFoundException();
    }
  }
}

export class PlaceSubjectInPensumUseCase {
  constructor(
    private readonly pensums: PensumRepository,
    private readonly subjects: SubjectRepository,
  ) {}

  /** Both the pensum and the subject must belong to the acting institution, so curricula never mix tenants. */
  async execute(
    institutionId: string,
    pensumId: string,
    subjectId: string,
    placement: PensumSubjectPlacement,
  ): Promise<Pensum> {
    if (!(await this.pensums.findById(institutionId, pensumId))) {
      throw new PensumNotFoundException();
    }
    if (!(await this.subjects.findById(institutionId, subjectId))) {
      throw new SubjectNotFoundException();
    }
    await this.pensums.placeSubject(pensumId, subjectId, placement);
    return new GetPensumUseCase(this.pensums).execute(institutionId, pensumId);
  }
}

export class RemoveSubjectFromPensumUseCase {
  constructor(private readonly pensums: PensumRepository) {}

  async execute(institutionId: string, pensumId: string, subjectId: string): Promise<void> {
    if (!(await this.pensums.findById(institutionId, pensumId))) {
      throw new PensumNotFoundException();
    }
    if (!(await this.pensums.removeSubject(pensumId, subjectId))) {
      throw new SubjectNotFoundException();
    }
  }
}
