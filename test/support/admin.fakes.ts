import { randomUUID } from 'node:crypto';
import type {
  Pensum,
  Subject,
} from '../../src/modules/academics/domain/entities/academic.entities.js';
import {
  PensumVersionTakenException,
  SubjectCodeTakenException,
  SubjectInUseException,
} from '../../src/modules/academics/domain/exceptions/academic.exceptions.js';
import type {
  PensumChanges,
  PensumData,
  PensumRepository,
  PensumSubjectPlacement,
  SubjectData,
  SubjectRepository,
} from '../../src/modules/academics/domain/ports/academic.repositories.js';
import type { Institution } from '../../src/modules/institutions/domain/entities/institution.entity.js';
import { InstitutionSlugTakenException } from '../../src/modules/institutions/domain/exceptions/institution.exceptions.js';
import type {
  InstitutionChanges,
  InstitutionRepository,
  NewInstitution,
} from '../../src/modules/institutions/domain/ports/institution.repository.js';

// Mirrors what Prisma does with undefined fields: they are left unchanged
function defined<T extends object>(changes: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export class InMemoryInstitutionRepository implements InstitutionRepository {
  readonly rows: Institution[] = [];
  /** Ids of institutions that have at least one member. */
  readonly withMembers = new Set<string>();

  seed(props: Partial<Institution> = {}): Institution {
    const institution: Institution = {
      id: randomUUID(),
      name: 'Colegio Central',
      slug: `colegio-${this.rows.length + 1}`,
      timezone: 'UTC',
      isActive: true,
      ...props,
    };
    this.rows.push(institution);
    return institution;
  }

  list(): Promise<Institution[]> {
    return Promise.resolve([...this.rows]);
  }

  findByIds(ids: string[]): Promise<Institution[]> {
    return Promise.resolve(this.rows.filter((row) => ids.includes(row.id)));
  }

  create(institution: NewInstitution): Promise<Institution> {
    if (this.rows.some((row) => row.slug === institution.slug)) {
      return Promise.reject(new InstitutionSlugTakenException());
    }
    return Promise.resolve(this.seed(institution));
  }

  update(id: string, changes: InstitutionChanges): Promise<Institution | null> {
    const row = this.rows.find((candidate) => candidate.id === id);
    return Promise.resolve(row ? Object.assign(row, defined(changes)) : null);
  }

  hasMembers(id: string): Promise<boolean> {
    return Promise.resolve(this.withMembers.has(id));
  }

  delete(id: string): Promise<boolean> {
    const index = this.rows.findIndex((row) => row.id === id);
    if (index >= 0) {
      this.rows.splice(index, 1);
    }
    return Promise.resolve(index >= 0);
  }
}

export class InMemorySubjectRepository implements SubjectRepository {
  readonly rows: Subject[] = [];
  /** Ids of subjects placed in some pensum, which the database would refuse to delete. */
  readonly inUse = new Set<string>();

  private find(institutionId: string, id: string) {
    return this.rows.find((row) => row.id === id && row.institutionId === institutionId);
  }

  private assertCodeFree(institutionId: string, code: string | undefined, exceptId?: string) {
    const clash = this.rows.some(
      (row) => row.institutionId === institutionId && row.code === code && row.id !== exceptId,
    );
    if (clash) {
      throw new SubjectCodeTakenException();
    }
  }

  list(institutionId: string): Promise<Subject[]> {
    return Promise.resolve(this.rows.filter((row) => row.institutionId === institutionId));
  }

  findById(institutionId: string, id: string): Promise<Subject | null> {
    return Promise.resolve(this.find(institutionId, id) ?? null);
  }

  async create(institutionId: string, subject: SubjectData): Promise<Subject> {
    this.assertCodeFree(institutionId, subject.code);
    const row: Subject = { id: randomUUID(), institutionId, ...subject };
    this.rows.push(row);
    return row;
  }

  async update(
    institutionId: string,
    id: string,
    changes: Partial<SubjectData>,
  ): Promise<Subject | null> {
    const row = this.find(institutionId, id);
    if (!row) {
      return null;
    }
    this.assertCodeFree(institutionId, changes.code, id);
    return Object.assign(row, defined(changes));
  }

  async delete(institutionId: string, id: string): Promise<boolean> {
    const row = this.find(institutionId, id);
    if (!row) {
      return false;
    }
    if (this.inUse.has(id)) {
      throw new SubjectInUseException();
    }
    this.rows.splice(this.rows.indexOf(row), 1);
    return true;
  }
}

export class InMemoryPensumRepository implements PensumRepository {
  readonly rows: Pensum[] = [];

  constructor(private readonly subjects: InMemorySubjectRepository) {}

  private find(institutionId: string, id: string) {
    return this.rows.find((row) => row.id === id && row.institutionId === institutionId);
  }

  list(institutionId: string): Promise<Pensum[]> {
    return Promise.resolve(this.rows.filter((row) => row.institutionId === institutionId));
  }

  findById(institutionId: string, id: string): Promise<Pensum | null> {
    return Promise.resolve(this.find(institutionId, id) ?? null);
  }

  async create(institutionId: string, pensum: PensumData): Promise<Pensum> {
    const clash = this.rows.some(
      (row) =>
        row.institutionId === institutionId &&
        row.code === pensum.code &&
        row.version === pensum.version,
    );
    if (clash) {
      throw new PensumVersionTakenException();
    }
    const row: Pensum = { id: randomUUID(), institutionId, isActive: true, subjects: [], ...pensum };
    this.rows.push(row);
    return row;
  }

  update(institutionId: string, id: string, changes: PensumChanges): Promise<Pensum | null> {
    const row = this.find(institutionId, id);
    return Promise.resolve(row ? Object.assign(row, defined(changes)) : null);
  }

  delete(institutionId: string, id: string): Promise<boolean> {
    const row = this.find(institutionId, id);
    if (row) {
      this.rows.splice(this.rows.indexOf(row), 1);
    }
    return Promise.resolve(Boolean(row));
  }

  placeSubject(
    pensumId: string,
    subjectId: string,
    placement: PensumSubjectPlacement,
  ): Promise<void> {
    const pensum = this.rows.find((row) => row.id === pensumId);
    const subject = this.subjects.rows.find((row) => row.id === subjectId);
    if (pensum && subject) {
      pensum.subjects = [
        ...pensum.subjects.filter((entry) => entry.subjectId !== subjectId),
        { subjectId, code: subject.code, name: subject.name, ...placement },
      ];
      this.subjects.inUse.add(subjectId);
    }
    return Promise.resolve();
  }

  removeSubject(pensumId: string, subjectId: string): Promise<boolean> {
    const pensum = this.rows.find((row) => row.id === pensumId);
    const before = pensum?.subjects.length ?? 0;
    if (pensum) {
      pensum.subjects = pensum.subjects.filter((entry) => entry.subjectId !== subjectId);
      this.subjects.inUse.delete(subjectId);
    }
    return Promise.resolve((pensum?.subjects.length ?? 0) < before);
  }
}

export function createAdminFakes() {
  const institutions = new InMemoryInstitutionRepository();
  const subjects = new InMemorySubjectRepository();
  const pensums = new InMemoryPensumRepository(subjects);
  return { institutions, subjects, pensums };
}
