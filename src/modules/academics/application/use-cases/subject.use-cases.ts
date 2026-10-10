import { normalizeCode, type Subject } from '../../domain/entities/academic.entities.js';
import { SubjectNotFoundException } from '../../domain/exceptions/academic.exceptions.js';
import type { SubjectRepository } from '../../domain/ports/academic.repositories.js';

export interface SubjectInput {
  code: string;
  name: string;
  description?: string | null;
}

const emptyToNull = (text: string | null | undefined) => text?.trim() || null;

export class ListSubjectsUseCase {
  constructor(private readonly subjects: SubjectRepository) {}

  execute(institutionId: string): Promise<Subject[]> {
    return this.subjects.list(institutionId);
  }
}

export class CreateSubjectUseCase {
  constructor(private readonly subjects: SubjectRepository) {}

  execute(institutionId: string, input: SubjectInput): Promise<Subject> {
    return this.subjects.create(institutionId, {
      code: normalizeCode(input.code),
      name: input.name.trim(),
      description: emptyToNull(input.description),
    });
  }
}

export class UpdateSubjectUseCase {
  constructor(private readonly subjects: SubjectRepository) {}

  async execute(institutionId: string, id: string, input: Partial<SubjectInput>): Promise<Subject> {
    const updated = await this.subjects.update(institutionId, id, {
      code: input.code === undefined ? undefined : normalizeCode(input.code),
      name: input.name?.trim(),
      description: input.description === undefined ? undefined : emptyToNull(input.description),
    });
    if (!updated) {
      throw new SubjectNotFoundException();
    }
    return updated;
  }
}

export class DeleteSubjectUseCase {
  constructor(private readonly subjects: SubjectRepository) {}

  async execute(institutionId: string, id: string): Promise<void> {
    if (!(await this.subjects.delete(institutionId, id))) {
      throw new SubjectNotFoundException();
    }
  }
}
