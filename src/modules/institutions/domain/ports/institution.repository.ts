import type { Institution } from '../entities/institution.entity.js';

export const INSTITUTION_REPOSITORY = Symbol('InstitutionRepository');

export type NewInstitution = Pick<Institution, 'name' | 'slug' | 'timezone'>;
export type InstitutionChanges = Partial<Pick<Institution, 'name' | 'timezone' | 'isActive'>>;

export interface InstitutionRepository {
  list(): Promise<Institution[]>;
  findByIds(ids: string[]): Promise<Institution[]>;
  create(institution: NewInstitution): Promise<Institution>;
  /** Resolves to null when the institution does not exist. */
  update(id: string, changes: InstitutionChanges): Promise<Institution | null>;
  hasMembers(id: string): Promise<boolean>;
  /** Resolves to false when the institution does not exist. */
  delete(id: string): Promise<boolean>;
}
