import type { Pensum, Subject } from '../entities/academic.entities.js';

export const SUBJECT_REPOSITORY = Symbol('SubjectRepository');
export const PENSUM_REPOSITORY = Symbol('PensumRepository');

export type SubjectData = Pick<Subject, 'code' | 'name' | 'description'>;
export type PensumData = Pick<Pensum, 'code' | 'name' | 'version'>;
export type PensumChanges = Partial<Pick<Pensum, 'name' | 'isActive'>>;

export interface PensumSubjectPlacement {
  level: number;
  weeklyHours: number;
  credits: number | null;
}

/**
 * Every method takes the institution id and never returns or changes another
 * institution's rows. "Not found" results are null or false, never an error.
 */
export interface SubjectRepository {
  list(institutionId: string): Promise<Subject[]>;
  findById(institutionId: string, id: string): Promise<Subject | null>;
  create(institutionId: string, subject: SubjectData): Promise<Subject>;
  update(institutionId: string, id: string, changes: Partial<SubjectData>): Promise<Subject | null>;
  delete(institutionId: string, id: string): Promise<boolean>;
}

export interface PensumRepository {
  list(institutionId: string): Promise<Pensum[]>;
  findById(institutionId: string, id: string): Promise<Pensum | null>;
  create(institutionId: string, pensum: PensumData): Promise<Pensum>;
  update(institutionId: string, id: string, changes: PensumChanges): Promise<Pensum | null>;
  delete(institutionId: string, id: string): Promise<boolean>;
  /** Adds the subject to the pensum, or updates its placement if it is already there. */
  placeSubject(pensumId: string, subjectId: string, placement: PensumSubjectPlacement): Promise<void>;
  removeSubject(pensumId: string, subjectId: string): Promise<boolean>;
}
