import {
  InMemoryLabAccessRepository,
  InMemoryLanguageExerciseRepository,
} from '../../../../../test/support/lab.fakes.js';
import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { BUILT_IN_EXERCISES } from '../../domain/built-in-exercises.js';
import { TeacherOnlyException } from '../../domain/lab-assignment.js';
import { LabKey, LabNotFoundException } from '../../domain/lab-catalog.js';
import {
  ExerciseNotFoundException,
  InvalidExerciseException,
  Verdict,
} from '../../domain/language-exercise.js';
import type { Actor } from '../actor.js';
import {
  ArchiveExerciseUseCase,
  CheckPracticeUseCase,
  CreateExerciseUseCase,
  GetPracticeSetUseCase,
  ListTeacherExercisesUseCase,
  SyncBuiltInExercisesUseCase,
  UpdateExerciseUseCase,
} from './language-exercise.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';

const actor = (id: string, role: Role, institutionId = A): Actor => {
  const claim: MembershipClaim = { id, institutionId, role };
  return { institutionId, memberships: [claim] };
};
const alan = actor('alan', Role.TEACHER);
const emmy = actor('emmy', Role.TEACHER);
const grace = actor('grace', Role.STUDENT);

async function setup() {
  const access = new InMemoryLabAccessRepository();
  access.grantAll(A, [LabKey.COMPLETIONS, LabKey.DEFINITIONS, LabKey.GRAVITY]);
  const exercises = new InMemoryLanguageExerciseRepository();
  await new SyncBuiltInExercisesUseCase(exercises).execute();
  return {
    access,
    exercises,
    list: new ListTeacherExercisesUseCase(access, exercises),
    create: new CreateExerciseUseCase(access, exercises),
    update: new UpdateExerciseUseCase(exercises),
    archive: new ArchiveExerciseUseCase(exercises),
    practice: new GetPracticeSetUseCase(access, exercises),
    check: new CheckPracticeUseCase(access, exercises),
  };
}

const sentence = { prompt: 'La capital de Francia es ___.', answers: ['París'], hint: null };

describe('the exercise bank', () => {
  it('is written whole, and rewriting it changes nothing', async () => {
    const ctx = await setup();
    const before = ctx.exercises.rows.length;

    await new SyncBuiltInExercisesUseCase(ctx.exercises).execute();

    expect(before).toBe(BUILT_IN_EXERCISES.length);
    expect(ctx.exercises.rows).toHaveLength(before);
  });

  it('archives an exercise the bank no longer has, without touching Teachers\' exercises', async () => {
    const ctx = await setup();
    ctx.exercises.rows.push({ ...ctx.exercises.rows[0], id: 'retired' });
    const own = await ctx.create.execute(alan, LabKey.COMPLETIONS, sentence);

    await new SyncBuiltInExercisesUseCase(ctx.exercises).execute();

    expect(ctx.exercises.rows.find((row) => row.id === 'retired')?.archived).toBe(true);
    expect(ctx.exercises.rows.find((row) => row.id === own.id)?.archived).toBe(false);
  });
});

describe("a Teacher's exercises", () => {
  it('lists the bank and their own, each lab apart', async () => {
    const ctx = await setup();
    await ctx.create.execute(alan, LabKey.COMPLETIONS, sentence);
    await ctx.create.execute(emmy, LabKey.COMPLETIONS, sentence);

    const { builtIn, own } = await ctx.list.execute(alan, LabKey.COMPLETIONS);

    expect(builtIn.every((exercise) => exercise.labKey === LabKey.COMPLETIONS && exercise.authorId === null)).toBe(true);
    expect(builtIn.length).toBeGreaterThan(0);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ authorId: 'alan', institutionId: A, answers: ['París'] });
  });

  it('refuses an exercise that does not fit its lab', async () => {
    const ctx = await setup();

    await expect(
      ctx.create.execute(alan, LabKey.DEFINITIONS, sentence),
    ).rejects.toBeInstanceOf(InvalidExerciseException);
  });

  it('is only for Teachers, and only in a language lab the institution may use', async () => {
    const ctx = await setup();

    await expect(ctx.create.execute(grace, LabKey.COMPLETIONS, sentence)).rejects.toBeInstanceOf(TeacherOnlyException);
    await expect(ctx.create.execute(alan, LabKey.GRAVITY, sentence)).rejects.toBeInstanceOf(LabNotFoundException);
    await expect(
      ctx.create.execute(actor('bob', Role.TEACHER, B), LabKey.COMPLETIONS, sentence),
    ).rejects.toBeInstanceOf(LabNotFoundException);
  });

  it('lets the author alone rewrite or archive an exercise; the bank is nobody\'s to change', async () => {
    const ctx = await setup();
    const own = await ctx.create.execute(alan, LabKey.COMPLETIONS, sentence);
    const [bank] = BUILT_IN_EXERCISES;

    const updated = await ctx.update.execute(alan, own.id, { ...sentence, answers: ['París', 'Paris'] });
    expect(updated.answers).toEqual(['París', 'Paris']);

    await expect(ctx.update.execute(emmy, own.id, sentence)).rejects.toBeInstanceOf(ExerciseNotFoundException);
    await expect(ctx.update.execute(alan, bank.id, sentence)).rejects.toBeInstanceOf(ExerciseNotFoundException);
    await expect(ctx.archive.execute(emmy, own.id)).rejects.toBeInstanceOf(ExerciseNotFoundException);

    await ctx.archive.execute(alan, own.id);
    expect((await ctx.list.execute(alan, LabKey.COMPLETIONS)).own).toEqual([]);
    await expect(ctx.archive.execute(alan, own.id)).rejects.toBeInstanceOf(ExerciseNotFoundException);
  });
});

describe('practising', () => {
  it('hands out the bank without the answers', async () => {
    const ctx = await setup();

    const questions = await ctx.practice.execute(A, LabKey.DEFINITIONS);

    expect(questions.length).toBeGreaterThan(0);
    expect(questions[0]).toEqual({
      id: expect.any(String),
      labKey: LabKey.DEFINITIONS,
      prompt: expect.any(String),
      hint: null,
    });
  });

  it("marks answers to the bank only, never to a Teacher's exercise", async () => {
    const ctx = await setup();
    const own = await ctx.create.execute(alan, LabKey.COMPLETIONS, sentence);
    const first = BUILT_IN_EXERCISES.find((exercise) => exercise.labKey === LabKey.COMPLETIONS);

    const marked = await ctx.check.execute(A, LabKey.COMPLETIONS, [
      { exerciseId: first?.id ?? '', answer: first?.answers[0] ?? '' },
      { exerciseId: own.id, answer: 'París' },
    ]);

    expect(marked).toEqual([{ exerciseId: first?.id, answer: first?.answers[0], verdict: Verdict.CORRECT }]);
  });

  it('is closed when the lab is not available', async () => {
    const ctx = await setup();
    await ctx.access.setEnabled(A, LabKey.DEFINITIONS, false);

    await expect(ctx.practice.execute(A, LabKey.DEFINITIONS)).rejects.toBeInstanceOf(LabNotFoundException);
    await expect(ctx.check.execute(A, LabKey.DEFINITIONS, [])).rejects.toBeInstanceOf(LabNotFoundException);
  });
});
