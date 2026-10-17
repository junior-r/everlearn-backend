import { randomUUID } from 'node:crypto';
import {
  AttemptAlreadySubmittedException,
  type AssignmentData,
  type LabAssignment,
  type LabAttempt,
  type LabCourse,
  type PersonRef,
} from '../../src/modules/labs/domain/lab-assignment.js';
import type { InstitutionLab, LabKey } from '../../src/modules/labs/domain/lab-catalog.js';
import type {
  ExerciseData,
  LanguageExercise,
  LanguageLabKey,
} from '../../src/modules/labs/domain/language-exercise.js';
import type {
  AssignmentSummary,
  BuiltInExercise,
  LabAccessRepository,
  LabAssignmentRepository,
  LanguageExerciseRepository,
  NewExercise,
  StudentAssignment,
} from '../../src/modules/labs/domain/ports/lab.ports.js';
import type { InMemoryGroupRepository, InMemoryMemberDirectory } from './group.fakes.js';

/** Grants and switches; any institution id counts as existing unless listed in `missing`. */
export class InMemoryLabAccessRepository implements LabAccessRepository {
  readonly decisions = new Map<string, InstitutionLab[]>();
  readonly missing = new Set<string>();

  institutionExists(institutionId: string): Promise<boolean> {
    return Promise.resolve(!this.missing.has(institutionId));
  }

  list(institutionId: string): Promise<InstitutionLab[]> {
    return Promise.resolve((this.decisions.get(institutionId) ?? []).map((decision) => ({ ...decision })));
  }

  setGranted(institutionId: string, labKey: LabKey, granted: boolean): Promise<void> {
    const decisions = this.decisions.get(institutionId) ?? [];
    const existing = decisions.find((decision) => decision.labKey === labKey);
    if (existing) {
      existing.granted = granted;
    } else {
      decisions.push({ labKey, granted, enabled: true });
    }
    this.decisions.set(institutionId, decisions);
    return Promise.resolve();
  }

  setEnabled(institutionId: string, labKey: LabKey, enabled: boolean): Promise<void> {
    const existing = this.decisions.get(institutionId)?.find((decision) => decision.labKey === labKey);
    if (existing) {
      existing.enabled = enabled;
    }
    return Promise.resolve();
  }

  /** Test setup: grants and switches on every lab given. */
  grantAll(institutionId: string, labKeys: readonly LabKey[]): void {
    this.decisions.set(
      institutionId,
      labKeys.map((labKey) => ({ labKey, granted: true, enabled: true })),
    );
  }
}

export class InMemoryLanguageExerciseRepository implements LanguageExerciseRepository {
  readonly rows: LanguageExercise[] = [];

  private live(labKey: LanguageLabKey) {
    return this.rows.filter((row) => row.labKey === labKey && !row.archived);
  }

  listBuiltIn(labKey: LanguageLabKey): Promise<LanguageExercise[]> {
    return Promise.resolve(this.live(labKey).filter((row) => row.authorId === null));
  }

  listAuthored(institutionId: string, authorId: string, labKey: LanguageLabKey): Promise<LanguageExercise[]> {
    return Promise.resolve(
      this.live(labKey).filter((row) => row.institutionId === institutionId && row.authorId === authorId),
    );
  }

  findMany(ids: readonly string[]): Promise<LanguageExercise[]> {
    return Promise.resolve(this.rows.filter((row) => ids.includes(row.id)).map((row) => ({ ...row })));
  }

  create(data: NewExercise): Promise<LanguageExercise> {
    const row: LanguageExercise = { ...data, id: randomUUID(), archived: false };
    this.rows.push(row);
    return Promise.resolve({ ...row });
  }

  update(id: string, data: ExerciseData): Promise<LanguageExercise> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (!row) {
      throw new Error(`No exercise ${id}`);
    }
    Object.assign(row, data);
    return Promise.resolve({ ...row });
  }

  archive(id: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === id);
    if (row) {
      row.archived = true;
    }
    return Promise.resolve();
  }

  syncBuiltIn(bank: readonly BuiltInExercise[]): Promise<void> {
    for (const exercise of bank) {
      const row = this.rows.find((candidate) => candidate.id === exercise.id);
      const synced = { ...exercise, authorId: null, institutionId: null, archived: false };
      if (row) {
        Object.assign(row, synced);
      } else {
        this.rows.push(synced);
      }
    }
    for (const row of this.rows) {
      if (row.authorId === null && !bank.some((exercise) => exercise.id === row.id)) {
        row.archived = true;
      }
    }
    return Promise.resolve();
  }
}

interface StoredAssignment extends LabAssignment {
  createdById: string;
}

const courseKey = (groupId: string, subjectId: string) => `${groupId}:${subjectId}`;

/**
 * Activities and attempts. Courses, Teachers and enrollments are read from the
 * academics fakes; a course id is "groupId:subjectId".
 */
export class InMemoryLabAssignmentRepository implements LabAssignmentRepository {
  readonly assignments: StoredAssignment[] = [];
  readonly attempts = new Map<string, LabAttempt[]>();

  constructor(
    private readonly groups: InMemoryGroupRepository,
    private readonly directory: InMemoryMemberDirectory,
  ) {}

  private courseOf(courseId: string): LabCourse | null {
    const [groupId, subjectId] = courseId.split(':');
    const group = this.groups.rows.find((row) => row.id === groupId);
    return group
      ? {
          courseId,
          groupId,
          groupName: group.name,
          subjectId,
          subjectName: `Subject ${subjectId}`,
          teacherMembershipId: group.teachers.get(subjectId) ?? null,
        }
      : null;
  }

  private institutionOf(assignment: LabAssignment) {
    return this.groups.rows.find((row) => row.id === assignment.course.groupId)?.institutionId;
  }

  private publicView({ createdById: _createdById, ...assignment }: StoredAssignment): LabAssignment {
    return { ...assignment, course: this.courseOf(assignment.course.courseId) ?? assignment.course };
  }

  findCourse(institutionId: string, groupId: string, subjectId: string): Promise<LabCourse | null> {
    const group = this.groups.rows.find((row) => row.id === groupId && row.institutionId === institutionId);
    return Promise.resolve(group && group.teachers.has(subjectId) ? this.courseOf(courseKey(groupId, subjectId)) : null);
  }

  create(courseId: string, createdById: string, data: AssignmentData): Promise<LabAssignment> {
    const course = this.courseOf(courseId);
    if (!course) {
      throw new Error(`No course ${courseId}`);
    }
    const stored: StoredAssignment = { ...data, id: randomUUID(), course, createdAt: new Date(), createdById };
    this.assignments.push(stored);
    return Promise.resolve(this.publicView(stored));
  }

  find(institutionId: string, assignmentId: string): Promise<LabAssignment | null> {
    const stored = this.assignments.find((assignment) => assignment.id === assignmentId);
    return Promise.resolve(stored && this.institutionOf(stored) === institutionId ? this.publicView(stored) : null);
  }

  listForCourse(courseId: string): Promise<AssignmentSummary[]> {
    const studentCount = this.groups.rows.find((row) => row.id === courseId.split(':')[0])?.studentIds.length ?? 0;
    return Promise.resolve(
      this.assignments
        .filter((assignment) => assignment.course.courseId === courseId)
        .reverse()
        .map((assignment) => ({
          ...this.publicView(assignment),
          submittedCount: this.attempts.get(assignment.id)?.length ?? 0,
          studentCount,
        })),
    );
  }

  delete(assignmentId: string): Promise<void> {
    const index = this.assignments.findIndex((assignment) => assignment.id === assignmentId);
    if (index >= 0) {
      this.assignments.splice(index, 1);
      this.attempts.delete(assignmentId);
    }
    return Promise.resolve();
  }

  listStudents(groupId: string): Promise<PersonRef[]> {
    const group = this.groups.rows.find((row) => row.id === groupId);
    return Promise.resolve(
      (group?.studentIds ?? []).map((studentId) => {
        const { membershipId, firstName, lastName } = this.directory.describe(studentId);
        return { membershipId, firstName, lastName };
      }),
    );
  }

  isEnrolled(groupId: string, studentId: string): Promise<boolean> {
    return Promise.resolve(
      this.groups.rows.some((row) => row.id === groupId && row.studentIds.includes(studentId)),
    );
  }

  listForStudent(institutionId: string, studentId: string): Promise<StudentAssignment[]> {
    return Promise.resolve(
      this.assignments
        .filter((assignment) => {
          const group = this.groups.rows.find((row) => row.id === assignment.course.groupId);
          return group?.institutionId === institutionId && group.studentIds.includes(studentId);
        })
        .reverse()
        .map((assignment) => ({
          ...this.publicView(assignment),
          attempt: this.attempts.get(assignment.id)?.find((attempt) => attempt.studentId === studentId) ?? null,
        })),
    );
  }

  findAttempt(assignmentId: string, studentId: string): Promise<LabAttempt | null> {
    return Promise.resolve(
      this.attempts.get(assignmentId)?.find((attempt) => attempt.studentId === studentId) ?? null,
    );
  }

  listAttempts(assignmentId: string): Promise<LabAttempt[]> {
    return Promise.resolve([...(this.attempts.get(assignmentId) ?? [])]);
  }

  saveAttempt(assignmentId: string, attempt: LabAttempt): Promise<void> {
    const attempts = this.attempts.get(assignmentId) ?? [];
    if (attempts.some((candidate) => candidate.studentId === attempt.studentId)) {
      return Promise.reject(new AttemptAlreadySubmittedException());
    }
    attempts.push(attempt);
    this.attempts.set(assignmentId, attempts);
    return Promise.resolve();
  }
}
