import { BUILT_IN_EXERCISES } from '../../domain/built-in-exercises.js';
import { isLanguageLab, LabNotFoundException } from '../../domain/lab-catalog.js';
import {
  checkedExercise,
  ExerciseNotFoundException,
  markAnswers,
  questionOf,
  type ExerciseData,
  type ExerciseQuestion,
  type GivenAnswer,
  type LanguageExercise,
  type LanguageLabKey,
  type MarkedAnswer,
} from '../../domain/language-exercise.js';
import type { LabAccessRepository, LanguageExerciseRepository } from '../../domain/ports/lab.ports.js';
import { requireTeacherMembership, type Actor } from '../actor.js';
import { requireAvailableLab } from './lab-access.use-cases.js';

/** The language lab, if the institution may use it now; any other lab is not found. */
export async function requireLanguageLab(
  access: LabAccessRepository,
  institutionId: string,
  labKey: string,
): Promise<LanguageLabKey> {
  const key = await requireAvailableLab(access, institutionId, labKey);
  if (!isLanguageLab(key)) {
    throw new LabNotFoundException();
  }
  return key as LanguageLabKey;
}

/** The exercises a Teacher may put in an activity: the bank's, and their own in the institution. */
export function isUsableBy(exercise: LanguageExercise, institutionId: string, teacherId: string): boolean {
  if (exercise.archived) {
    return false;
  }
  return exercise.authorId === null || (exercise.institutionId === institutionId && exercise.authorId === teacherId);
}

async function requireOwnExercise(
  exercises: LanguageExerciseRepository,
  actor: Actor,
  exerciseId: string,
): Promise<LanguageExercise> {
  const teacherId = requireTeacherMembership(actor);
  const [exercise] = await exercises.findMany([exerciseId]);
  if (
    !exercise ||
    exercise.archived ||
    exercise.institutionId !== actor.institutionId ||
    exercise.authorId !== teacherId
  ) {
    throw new ExerciseNotFoundException();
  }
  return exercise;
}

export interface TeacherExercises {
  builtIn: LanguageExercise[];
  own: LanguageExercise[];
}

export class ListTeacherExercisesUseCase {
  constructor(
    private readonly access: LabAccessRepository,
    private readonly exercises: LanguageExerciseRepository,
  ) {}

  /** The bank's exercises of a lab and the Teacher's own, answers included. */
  async execute(actor: Actor, labKey: string): Promise<TeacherExercises> {
    const key = await requireLanguageLab(this.access, actor.institutionId, labKey);
    const teacherId = requireTeacherMembership(actor);
    const [builtIn, own] = await Promise.all([
      this.exercises.listBuiltIn(key),
      this.exercises.listAuthored(actor.institutionId, teacherId, key),
    ]);
    return { builtIn, own };
  }
}

export class CreateExerciseUseCase {
  constructor(
    private readonly access: LabAccessRepository,
    private readonly exercises: LanguageExerciseRepository,
  ) {}

  /** Adds an exercise of the Teacher's own to a language lab. */
  async execute(actor: Actor, labKey: string, data: ExerciseData): Promise<LanguageExercise> {
    const key = await requireLanguageLab(this.access, actor.institutionId, labKey);
    const authorId = requireTeacherMembership(actor);
    return this.exercises.create({
      ...checkedExercise(key, data),
      labKey: key,
      institutionId: actor.institutionId,
      authorId,
    });
  }
}

export class UpdateExerciseUseCase {
  constructor(private readonly exercises: LanguageExerciseRepository) {}

  /** Rewrites one of the Teacher's own exercises; activities already handed in keep their marks. */
  async execute(actor: Actor, exerciseId: string, data: ExerciseData): Promise<LanguageExercise> {
    const exercise = await requireOwnExercise(this.exercises, actor, exerciseId);
    return this.exercises.update(exercise.id, checkedExercise(exercise.labKey, data));
  }
}

export class ArchiveExerciseUseCase {
  constructor(private readonly exercises: LanguageExerciseRepository) {}

  /** Removes one of the Teacher's own exercises from the list; activities that use it keep it. */
  async execute(actor: Actor, exerciseId: string): Promise<void> {
    const exercise = await requireOwnExercise(this.exercises, actor, exerciseId);
    await this.exercises.archive(exercise.id);
  }
}

export class GetPracticeSetUseCase {
  constructor(
    private readonly access: LabAccessRepository,
    private readonly exercises: LanguageExerciseRepository,
  ) {}

  /** The bank's exercises of a lab to practise with, without their answers. */
  async execute(institutionId: string, labKey: string): Promise<ExerciseQuestion[]> {
    const key = await requireLanguageLab(this.access, institutionId, labKey);
    return (await this.exercises.listBuiltIn(key)).map(questionOf);
  }
}

export class CheckPracticeUseCase {
  constructor(
    private readonly access: LabAccessRepository,
    private readonly exercises: LanguageExerciseRepository,
  ) {}

  /**
   * Marks practice answers to the bank's exercises without storing anything.
   * Only the verdicts go back, so practising does not hand out the answers.
   */
  async execute(institutionId: string, labKey: string, given: GivenAnswer[]): Promise<MarkedAnswer[]> {
    const key = await requireLanguageLab(this.access, institutionId, labKey);
    const found = await this.exercises.findMany(given.map((answer) => answer.exerciseId));
    const practised = found.filter(
      (exercise) => exercise.labKey === key && exercise.authorId === null && !exercise.archived,
    );
    return markAnswers(practised, given);
  }
}

export class SyncBuiltInExercisesUseCase {
  constructor(private readonly exercises: LanguageExerciseRepository) {}

  /** Writes the platform's own bank into storage, as it stands in this version. */
  execute(): Promise<void> {
    return this.exercises.syncBuiltIn(BUILT_IN_EXERCISES);
  }
}
