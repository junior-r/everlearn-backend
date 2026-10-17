import { DomainException } from '../../../shared/domain/domain.exception.js';
import { LabKey } from './lab-catalog.js';

/** The language labs, whose exercises are typed answers. */
export type LanguageLabKey = typeof LabKey.COMPLETIONS | typeof LabKey.DEFINITIONS;

/** Where a completion exercise leaves its word out. */
export const BLANK = '___';
export const MAX_PROMPT_LENGTH = 300;
export const MAX_ANSWER_LENGTH = 60;
export const MAX_ANSWERS = 5;
export const MAX_HINT_LENGTH = 120;

/**
 * What a Teacher writes. A completion's prompt is a sentence with one `___`;
 * a definition's prompt is the definition, and the answer is the word.
 * `answers` lists every accepted answer, the first being the one shown.
 */
export interface ExerciseData {
  prompt: string;
  answers: string[];
  hint: string | null;
}

export interface LanguageExercise extends ExerciseData {
  id: string;
  labKey: LanguageLabKey;
  /** Null for the platform's own bank, shared by every institution. */
  authorId: string | null;
  institutionId: string | null;
  archived: boolean;
}

/** An exercise as a Student sees it before answering. */
export type ExerciseQuestion = Pick<LanguageExercise, 'id' | 'labKey' | 'prompt' | 'hint'>;

export const questionOf = ({ id, labKey, prompt, hint }: LanguageExercise): ExerciseQuestion => ({
  id,
  labKey,
  prompt,
  hint,
});

export const Verdict = {
  CORRECT: 'CORRECT',
  /** Right word, wrong accents: a spelling lesson, not a point. */
  ACCENTS: 'ACCENTS',
  INCORRECT: 'INCORRECT',
} as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

export interface GivenAnswer {
  exerciseId: string;
  answer: string;
}

export interface MarkedAnswer extends GivenAnswer {
  verdict: Verdict;
}

/** Case, surrounding spaces, repeated spaces and closing punctuation do not make an answer wrong. */
export function normalizeAnswer(answer: string): string {
  return answer
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[¿¡"'«“]+|[.,;:!?"'»”]+$/g, '')
    .trim()
    .toLocaleLowerCase('es');
}

// Acute accent and diaeresis only: the tilde of ñ (U+0303) makes another letter
const ACCENT_MARKS = /[́̈]/g;

const withoutAccents = (answer: string) => answer.normalize('NFD').replace(ACCENT_MARKS, '').normalize('NFC');

/** Marks one answer against the accepted ones. */
export function verdictFor(answer: string, accepted: readonly string[]): Verdict {
  const given = normalizeAnswer(answer);
  if (!given) {
    return Verdict.INCORRECT;
  }
  const expected = accepted.map(normalizeAnswer);
  if (expected.includes(given)) {
    return Verdict.CORRECT;
  }
  return expected.map(withoutAccents).includes(withoutAccents(given)) ? Verdict.ACCENTS : Verdict.INCORRECT;
}

/**
 * Marks every exercise of a set, in the set's order. An exercise left without
 * an answer is incorrect; answers to exercises outside the set are ignored.
 */
export function markAnswers(exercises: readonly LanguageExercise[], given: readonly GivenAnswer[]): MarkedAnswer[] {
  return exercises.map((exercise) => {
    const answer = given.find((candidate) => candidate.exerciseId === exercise.id)?.answer ?? '';
    return { exerciseId: exercise.id, answer, verdict: verdictFor(answer, exercise.answers) };
  });
}

export const scoreOf = (marked: readonly MarkedAnswer[]) =>
  marked.filter((answer) => answer.verdict === Verdict.CORRECT).length;

/** Returns the data cleaned up, or refuses what no exercise of that lab can be. */
export function checkedExercise(labKey: LanguageLabKey, data: ExerciseData): ExerciseData {
  const prompt = data.prompt.trim().replace(/\s+/g, ' ');
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) {
    throw new InvalidExerciseException(`A prompt must have between 1 and ${MAX_PROMPT_LENGTH} characters`);
  }
  const blanks = prompt.split(BLANK).length - 1;
  if (labKey === LabKey.COMPLETIONS && blanks !== 1) {
    throw new InvalidExerciseException(`A completion must leave exactly one blank (${BLANK})`);
  }
  if (labKey === LabKey.DEFINITIONS && blanks !== 0) {
    throw new InvalidExerciseException('A definition has no blank');
  }
  const answers = [...new Set(data.answers.map((answer) => answer.trim().replace(/\s+/g, ' ')))].filter(Boolean);
  if (answers.length === 0 || answers.length > MAX_ANSWERS) {
    throw new InvalidExerciseException(`An exercise accepts between 1 and ${MAX_ANSWERS} answers`);
  }
  if (answers.some((answer) => answer.length > MAX_ANSWER_LENGTH)) {
    throw new InvalidExerciseException(`An answer has at most ${MAX_ANSWER_LENGTH} characters`);
  }
  const hint = data.hint?.trim() || null;
  if (hint && hint.length > MAX_HINT_LENGTH) {
    throw new InvalidExerciseException(`A hint has at most ${MAX_HINT_LENGTH} characters`);
  }
  return { prompt, answers, hint };
}

export class InvalidExerciseException extends DomainException {
  constructor(message: string) {
    super('VALIDATION', 'INVALID_EXERCISE', message);
  }
}

export class ExerciseNotFoundException extends DomainException {
  constructor() {
    super('NOT_FOUND', 'EXERCISE_NOT_FOUND', 'Exercise not found');
  }
}
