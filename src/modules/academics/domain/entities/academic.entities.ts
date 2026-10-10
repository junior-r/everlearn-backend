export interface Subject {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  description: string | null;
}

/** A subject's place in a pensum: which level it is taught in and its workload. */
export interface PensumSubject {
  subjectId: string;
  code: string;
  name: string;
  level: number;
  weeklyHours: number;
  credits: number | null;
}

/** A curriculum: the versioned list of subjects a group follows. */
export interface Pensum {
  id: string;
  institutionId: string;
  code: string;
  name: string;
  version: number;
  isActive: boolean;
  subjects: PensumSubject[];
}

/** Codes are stored upper-case without surrounding spaces, so "mat-101" and "MAT-101" are the same subject. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}
