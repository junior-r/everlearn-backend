import { BUILT_IN_EXERCISES } from './built-in-exercises.js';
import { LabKey } from './lab-catalog.js';
import {
  checkedExercise,
  InvalidExerciseException,
  markAnswers,
  normalizeAnswer,
  scoreOf,
  Verdict,
  verdictFor,
  type LanguageExercise,
} from './language-exercise.js';

const exercise = (id: string, answers: string[]): LanguageExercise => ({
  id,
  labKey: LabKey.COMPLETIONS,
  authorId: null,
  institutionId: null,
  prompt: 'Ayer nosotros ___ al parque.',
  answers,
  hint: null,
  archived: false,
});

describe('marking an answer', () => {
  it('forgives case, spaces and closing punctuation', () => {
    expect(normalizeAnswer('  Fuimos.  ')).toBe('fuimos');
    expect(normalizeAnswer('¡Muy   BIEN!')).toBe('muy bien');
    expect(verdictFor(' FUIMOS ', ['fuimos'])).toBe(Verdict.CORRECT);
  });

  it('accepts any of the accepted answers', () => {
    expect(verdictFor('feliz', ['contento', 'feliz'])).toBe(Verdict.CORRECT);
  });

  it('tells a missing or extra accent apart from a wrong word', () => {
    expect(verdictFor('leeria', ['leería'])).toBe(Verdict.ACCENTS);
    expect(verdictFor('lápíces', ['lápices'])).toBe(Verdict.ACCENTS);
    expect(verdictFor('escribiría', ['leería'])).toBe(Verdict.INCORRECT);
  });

  it('keeps ñ a letter of its own', () => {
    expect(verdictFor('tacano', ['tacaño'])).toBe(Verdict.INCORRECT);
    expect(verdictFor('TACAÑO', ['tacaño'])).toBe(Verdict.CORRECT);
  });

  it('counts an empty answer as incorrect', () => {
    expect(verdictFor('   ', ['fuimos'])).toBe(Verdict.INCORRECT);
  });

  it('marks a whole set in its order, missing answers included, and scores only correct ones', () => {
    const set = [exercise('a', ['fuimos']), exercise('b', ['leería']), exercise('c', ['haga'])];

    const marked = markAnswers(set, [
      { exerciseId: 'b', answer: 'leeria' },
      { exerciseId: 'a', answer: 'Fuimos' },
      { exerciseId: 'stranger', answer: 'haga' },
    ]);

    expect(marked.map(({ exerciseId, verdict }) => [exerciseId, verdict])).toEqual([
      ['a', Verdict.CORRECT],
      ['b', Verdict.ACCENTS],
      ['c', Verdict.INCORRECT],
    ]);
    expect(scoreOf(marked)).toBe(1);
  });
});

describe('writing an exercise', () => {
  it('cleans the text and drops repeated or empty answers', () => {
    expect(
      checkedExercise(LabKey.COMPLETIONS, {
        prompt: '  El   agua hierve a 100 grados ___. ',
        answers: [' Celsius', 'Celsius', '', 'centígrados '],
        hint: '  ',
      }),
    ).toEqual({ prompt: 'El agua hierve a 100 grados ___.', answers: ['Celsius', 'centígrados'], hint: null });
  });

  it('requires exactly one blank in a completion and none in a definition', () => {
    const data = (prompt: string) => ({ prompt, answers: ['x'], hint: null });

    expect(() => checkedExercise(LabKey.COMPLETIONS, data('Sin hueco'))).toThrow(InvalidExerciseException);
    expect(() => checkedExercise(LabKey.COMPLETIONS, data('Dos ___ y ___'))).toThrow(InvalidExerciseException);
    expect(() => checkedExercise(LabKey.DEFINITIONS, data('Con ___ hueco'))).toThrow(InvalidExerciseException);
    expect(checkedExercise(LabKey.DEFINITIONS, data('Signo sobre una vocal')).prompt).toBe('Signo sobre una vocal');
  });

  it('needs at least one answer', () => {
    expect(() => checkedExercise(LabKey.DEFINITIONS, { prompt: 'Algo', answers: ['  '], hint: null })).toThrow(
      InvalidExerciseException,
    );
  });

  it('ships a bank whose every exercise is a valid one, with unique ids', () => {
    for (const { labKey, prompt, answers, hint } of BUILT_IN_EXERCISES) {
      expect(() => checkedExercise(labKey, { prompt, answers, hint })).not.toThrow();
    }
    expect(new Set(BUILT_IN_EXERCISES.map(({ id }) => id)).size).toBe(BUILT_IN_EXERCISES.length);
  });
});
