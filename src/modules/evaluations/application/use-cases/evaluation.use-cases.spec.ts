import { RecordingNotifier } from '../../../../../test/support/communication.fakes.js';
import { randomUUID } from 'node:crypto';
import { createAdminFakes } from '../../../../../test/support/admin.fakes.js';
import { InMemoryEvaluationRepository } from '../../../../../test/support/evaluation.fakes.js';
import {
  InMemoryGroupRepository,
  InMemoryMemberDirectory,
  InMemoryPeriodRepository,
} from '../../../../../test/support/group.fakes.js';
import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  CourseNotFoundException,
  EvaluationAlreadyPublishedException,
  EvaluationHasGradesException,
  EvaluationNotFoundException,
  EvaluationNotPublishedException,
  EvaluationWeightExceededException,
  fitsWeight,
  InvalidEvaluationException,
  NotCourseTeacherException,
  ScoreOutOfRangeException,
  standingOf,
  StudentNotEnrolledException,
  totalWeight,
  type Evaluation,
  type EvaluationData,
} from '../../domain/evaluation.js';
import {
  CreateEvaluationUseCase,
  DeleteEvaluationUseCase,
  ExportGradebookUseCase,
  GetGradebookUseCase,
  GetMyProgressUseCase,
  ListDueEvaluationsUseCase,
  PublishEvaluationUseCase,
  RecordGradesUseCase,
  UpdateEvaluationUseCase,
  type Actor,
} from './evaluation.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';
const MATH = 'subject-math';
const HISTORY = 'subject-history';
const day = (date: number) => new Date(Date.UTC(2026, 10, date, 12));

const exam = (overrides: Partial<EvaluationData> = {}): EvaluationData => ({
  title: 'Examen parcial',
  type: 'EXAM',
  weight: 40,
  maxScore: 20,
  dueAt: day(10),
  ...overrides,
});

/** A group of institution A: Alan teaches maths and Emmy history; Grace and Linus are enrolled, Ada is not. */
function setup() {
  const directory = new InMemoryMemberDirectory();
  const groups = new InMemoryGroupRepository(createAdminFakes().pensums, new InMemoryPeriodRepository(), directory);
  const repository = new InMemoryEvaluationRepository(groups, directory);
  const member = (role: Role, firstName: string) => {
    const claim: MembershipClaim = {
      id: directory.add(A, role, firstName, 'Prueba').membershipId,
      institutionId: A,
      role,
    };
    return { id: claim.id, actor: { institutionId: A, memberships: [claim] } satisfies Actor };
  };
  const alan = member(Role.TEACHER, 'Alan');
  const emmy = member(Role.TEACHER, 'Emmy');
  const grace = member(Role.STUDENT, 'Grace');
  const linus = member(Role.STUDENT, 'Linus');
  const ada = member(Role.STUDENT, 'Ada');
  const groupId = randomUUID();
  groups.rows.push({
    id: groupId,
    institutionId: A,
    name: '1ro A',
    level: 1,
    capacity: null,
    pensumId: 'pensum',
    periodId: 'period',
    teachers: new Map([
      [MATH, alan.id],
      [HISTORY, emmy.id],
    ]),
    studentIds: [grace.id, linus.id],
  });
  const create = new CreateEvaluationUseCase(repository);
  const notifier = new RecordingNotifier();
  const publish = new PublishEvaluationUseCase(repository, notifier);
  const math = { groupId, subjectId: MATH };
  /** A published maths evaluation. */
  const published = async (data: Partial<EvaluationData> = {}) =>
    publish.execute(alan.actor, (await create.execute(alan.actor, math, exam(data))).id);
  const gradebook = new GetGradebookUseCase(repository);
  return {
    repository,
    notifier,
    exportCsv: new ExportGradebookUseCase(gradebook),
    groupId,
    math,
    history: { groupId, subjectId: HISTORY },
    alan,
    emmy,
    grace,
    linus,
    ada,
    create,
    publish,
    published,
    update: new UpdateEvaluationUseCase(repository),
    remove: new DeleteEvaluationUseCase(repository),
    grade: new RecordGradesUseCase(repository),
    gradebook,
    progress: new GetMyProgressUseCase(repository),
    due: new ListDueEvaluationsUseCase(repository),
  };
}

describe('weights and averages', () => {
  const evaluation = (id: string, weight: number, maxScore: number, isPublished = true): Evaluation => ({
    ...exam({ weight, maxScore }),
    id,
    isPublished,
  });

  it('adds weights exactly and accepts a course of up to 100%', () => {
    const thirds = [{ weight: 33.33 }, { weight: 33.33 }];

    expect(totalWeight([{ weight: 0.1 }, { weight: 0.2 }])).toBe(0.3);
    expect(fitsWeight(thirds, 33.34)).toBe(true);
    expect(fitsWeight(thirds, 33.35)).toBe(false);
    expect(fitsWeight([], 100)).toBe(true);
  });

  it('weighs each graded evaluation by its share of the course', () => {
    const evaluations = [evaluation('exam', 60, 20), evaluation('quiz', 20, 10)];
    const scores = new Map([
      ['exam', 15],
      ['quiz', 10],
    ]);

    // (75% x 60 + 100% x 20) / 80
    expect(standingOf(evaluations, (id) => scores.get(id))).toEqual({ average: 81.25, gradedWeight: 80 });
  });

  it('leaves out evaluations without a score, and drafts even when they have one', () => {
    const evaluations = [evaluation('exam', 60, 20), evaluation('quiz', 20, 10), evaluation('draft', 20, 10, false)];
    const scores = new Map([
      ['exam', 10],
      ['draft', 10],
    ]);

    expect(standingOf(evaluations, (id) => scores.get(id))).toEqual({ average: 50, gradedWeight: 60 });
  });

  it('has no average while nothing is graded, and counts a zero as a grade', () => {
    const evaluations = [evaluation('exam', 60, 20)];

    expect(standingOf(evaluations, () => undefined)).toEqual({ average: null, gradedWeight: 0 });
    expect(standingOf(evaluations, () => 0)).toEqual({ average: 0, gradedWeight: 60 });
  });
});

describe('creating and changing evaluations', () => {
  it('lets the assigned Teacher add a draft with its title trimmed', async () => {
    const ctx = setup();

    const created = await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ title: '  Examen parcial  ' }));

    expect(created).toMatchObject({ title: 'Examen parcial', weight: 40, maxScore: 20, isPublished: false });
    expect(ctx.repository.evaluations).toHaveLength(1);
  });

  it('refuses a Teacher of another subject, a Student, and a role held in another institution', async () => {
    const ctx = setup();
    const elsewhere = { institutionId: A, memberships: [{ id: ctx.alan.id, institutionId: B, role: Role.TEACHER }] };

    for (const actor of [ctx.emmy.actor, ctx.grace.actor, elsewhere]) {
      await expect(ctx.create.execute(actor, ctx.math, exam())).rejects.toBeInstanceOf(NotCourseTeacherException);
    }
    expect(ctx.repository.evaluations).toHaveLength(0);
  });

  it('reports a course of another institution, or one that does not exist, as not found', async () => {
    const ctx = setup();

    await expect(
      ctx.create.execute({ ...ctx.alan.actor, institutionId: B }, ctx.math, exam()),
    ).rejects.toBeInstanceOf(CourseNotFoundException);
    await expect(
      ctx.create.execute(ctx.alan.actor, { groupId: ctx.groupId, subjectId: 'subject-physics' }, exam()),
    ).rejects.toBeInstanceOf(CourseNotFoundException);
  });

  it('refuses an evaluation that would take the course above 100%, drafts included', async () => {
    const ctx = setup();
    await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ weight: 60 }));
    await ctx.published({ weight: 30 });

    await expect(ctx.create.execute(ctx.alan.actor, ctx.math, exam({ weight: 10.01 }))).rejects.toBeInstanceOf(
      EvaluationWeightExceededException,
    );
    await expect(ctx.create.execute(ctx.alan.actor, ctx.math, exam({ weight: 10 }))).resolves.toBeDefined();
  });

  it('counts the weights of each course separately', async () => {
    const ctx = setup();
    await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ weight: 100 }));

    await expect(ctx.create.execute(ctx.emmy.actor, ctx.history, exam({ weight: 100 }))).resolves.toBeDefined();
  });

  it('refuses values no evaluation can have', async () => {
    const ctx = setup();
    const invalid = [{ title: '   ' }, { weight: 0 }, { weight: 100.5 }, { weight: 10.555 }, { maxScore: 0 }, { maxScore: 10000 }];

    for (const overrides of invalid) {
      await expect(ctx.create.execute(ctx.alan.actor, ctx.math, exam(overrides))).rejects.toBeInstanceOf(
        InvalidEvaluationException,
      );
    }
  });

  it('changes only what is sent, and can remove the due date', async () => {
    const ctx = setup();
    const { id } = await ctx.create.execute(ctx.alan.actor, ctx.math, exam());

    const updated = await ctx.update.execute(ctx.alan.actor, id, { title: 'Examen final', dueAt: null });

    expect(updated).toMatchObject({ title: 'Examen final', weight: 40, maxScore: 20, dueAt: null });
  });

  it('checks a new weight against the other evaluations, not against itself', async () => {
    const ctx = setup();
    const { id } = await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ weight: 60 }));
    await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ weight: 30 }));

    await expect(ctx.update.execute(ctx.alan.actor, id, { weight: 70 })).resolves.toMatchObject({ weight: 70 });
    await expect(ctx.update.execute(ctx.alan.actor, id, { weight: 70.01 })).rejects.toBeInstanceOf(
      EvaluationWeightExceededException,
    );
  });

  it('fixes the maximum score once grades exist, but still lets the rest change', async () => {
    const ctx = setup();
    const { id } = await ctx.published();
    await ctx.grade.execute(ctx.alan.actor, id, [{ enrollmentId: ctx.grace.id, score: 18, feedback: null }]);

    await expect(ctx.update.execute(ctx.alan.actor, id, { maxScore: 10 })).rejects.toBeInstanceOf(
      EvaluationHasGradesException,
    );
    await expect(ctx.update.execute(ctx.alan.actor, id, { maxScore: 20, weight: 50 })).resolves.toMatchObject({
      weight: 50,
    });
  });

  it('lets only the assigned Teacher change or publish, and hides other institutions', async () => {
    const ctx = setup();
    const { id } = await ctx.create.execute(ctx.alan.actor, ctx.math, exam());

    await expect(ctx.update.execute(ctx.emmy.actor, id, { weight: 1 })).rejects.toBeInstanceOf(NotCourseTeacherException);
    await expect(ctx.publish.execute(ctx.emmy.actor, id)).rejects.toBeInstanceOf(NotCourseTeacherException);
    await expect(ctx.publish.execute({ ...ctx.alan.actor, institutionId: B }, id)).rejects.toBeInstanceOf(
      EvaluationNotFoundException,
    );
    await expect(ctx.publish.execute(ctx.alan.actor, randomUUID())).rejects.toBeInstanceOf(EvaluationNotFoundException);
    expect(ctx.repository.evaluations[0].isPublished).toBe(false);
  });

  it('deletes a draft, which frees its weight', async () => {
    const ctx = setup();
    const { id } = await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ weight: 100 }));

    await ctx.remove.execute(ctx.alan.actor, id);

    expect(ctx.repository.evaluations).toEqual([]);
    await expect(ctx.create.execute(ctx.alan.actor, ctx.math, exam({ weight: 100 }))).resolves.toBeDefined();
  });

  it('keeps a published evaluation, and lets only the assigned Teacher delete a draft', async () => {
    const ctx = setup();
    const published = await ctx.published();
    const draft = await ctx.create.execute(ctx.alan.actor, ctx.math, exam());

    await expect(ctx.remove.execute(ctx.alan.actor, published.id)).rejects.toBeInstanceOf(
      EvaluationAlreadyPublishedException,
    );
    await expect(ctx.remove.execute(ctx.emmy.actor, draft.id)).rejects.toBeInstanceOf(NotCourseTeacherException);
    await expect(ctx.remove.execute({ ...ctx.alan.actor, institutionId: B }, draft.id)).rejects.toBeInstanceOf(
      EvaluationNotFoundException,
    );
    expect(ctx.repository.evaluations).toHaveLength(2);
  });
});

describe('grading', () => {
  it('stores scores for enrolled Students, replaces them, and removes one entered as null', async () => {
    const ctx = setup();
    const { id } = await ctx.published();

    await ctx.grade.execute(ctx.alan.actor, id, [
      { enrollmentId: ctx.grace.id, score: 18.5, feedback: '  Muy bien  ' },
      { enrollmentId: ctx.linus.id, score: 0, feedback: '' },
    ]);
    await ctx.grade.execute(ctx.alan.actor, id, [
      { enrollmentId: ctx.grace.id, score: 19, feedback: null },
      { enrollmentId: ctx.linus.id, score: null, feedback: null },
    ]);

    expect(ctx.repository.grades).toEqual([
      expect.objectContaining({ enrollmentId: ctx.grace.id, score: 19, feedback: null, gradedById: ctx.alan.id }),
    ]);
  });

  it('keeps the feedback already given when a new score comes without one', async () => {
    const ctx = setup();
    const { id } = await ctx.published();
    await ctx.grade.execute(ctx.alan.actor, id, [{ enrollmentId: ctx.grace.id, score: 12, feedback: 'Revisa el punto 3' }]);

    await ctx.grade.execute(ctx.alan.actor, id, [{ enrollmentId: ctx.grace.id, score: 14 }]);

    expect(ctx.repository.grades).toEqual([
      expect.objectContaining({ score: 14, feedback: 'Revisa el punto 3' }),
    ]);
  });

  it('refuses a draft, a score outside the range, and a Student who is not enrolled', async () => {
    const ctx = setup();
    const draft = await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ weight: 10 }));
    const { id } = await ctx.published();
    const entry = (enrollmentId: string, score: number) => [{ enrollmentId, score, feedback: null }];

    await expect(ctx.grade.execute(ctx.alan.actor, draft.id, entry(ctx.grace.id, 10))).rejects.toBeInstanceOf(
      EvaluationNotPublishedException,
    );
    for (const score of [-1, 20.01, 10.555]) {
      await expect(ctx.grade.execute(ctx.alan.actor, id, entry(ctx.grace.id, score))).rejects.toBeInstanceOf(
        ScoreOutOfRangeException,
      );
    }
    await expect(ctx.grade.execute(ctx.alan.actor, id, entry(ctx.ada.id, 10))).rejects.toBeInstanceOf(
      StudentNotEnrolledException,
    );
    expect(ctx.repository.grades).toHaveLength(0);
  });

  it('stores nothing when one score of the batch is invalid', async () => {
    const ctx = setup();
    const { id } = await ctx.published();

    await expect(
      ctx.grade.execute(ctx.alan.actor, id, [
        { enrollmentId: ctx.grace.id, score: 15, feedback: null },
        { enrollmentId: ctx.linus.id, score: 25, feedback: null },
      ]),
    ).rejects.toBeInstanceOf(ScoreOutOfRangeException);
    expect(ctx.repository.grades).toHaveLength(0);
  });

  it('lets no other Teacher grade', async () => {
    const ctx = setup();
    const { id } = await ctx.published();

    await expect(
      ctx.grade.execute(ctx.emmy.actor, id, [{ enrollmentId: ctx.grace.id, score: 10, feedback: null }]),
    ).rejects.toBeInstanceOf(NotCourseTeacherException);
  });
});

describe('the gradebook', () => {
  it('shows every evaluation and enrolled Student with scores and averages', async () => {
    const ctx = setup();
    const examId = (await ctx.published({ weight: 60 })).id;
    const quizId = (await ctx.published({ title: 'Quiz', type: 'QUIZ', weight: 20, maxScore: 10 })).id;
    await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ title: 'Proyecto', weight: 20 }));
    await ctx.grade.execute(ctx.alan.actor, examId, [{ enrollmentId: ctx.grace.id, score: 15, feedback: null }]);
    await ctx.grade.execute(ctx.alan.actor, quizId, [{ enrollmentId: ctx.grace.id, score: 10, feedback: null }]);

    const book = await ctx.gradebook.execute(ctx.alan.actor, ctx.math);

    expect(book).toMatchObject({ groupName: '1ro A', totalWeight: 100 });
    expect(book.evaluations.map((evaluation) => evaluation.isPublished)).toEqual([true, true, false]);
    expect(book.students).toEqual([
      expect.objectContaining({ firstName: 'Grace', average: 81.25, gradedWeight: 80 }),
      expect.objectContaining({ firstName: 'Linus', average: null, gradedWeight: 0, grades: [] }),
    ]);
    expect(book.students[0].grades).toEqual([
      { evaluationId: examId, score: 15, feedback: null },
      { evaluationId: quizId, score: 10, feedback: null },
    ]);
  });

  it('is only for the assigned Teacher', async () => {
    const ctx = setup();

    await expect(ctx.gradebook.execute(ctx.emmy.actor, ctx.math)).rejects.toBeInstanceOf(NotCourseTeacherException);
    await expect(ctx.gradebook.execute(ctx.grace.actor, ctx.math)).rejects.toBeInstanceOf(NotCourseTeacherException);
  });
});

describe('a Student\'s progress', () => {
  it('shows each course with its published evaluations, own grades and average', async () => {
    const ctx = setup();
    const { id } = await ctx.published({ weight: 60 });
    await ctx.published({ title: 'Quiz', weight: 20, dueAt: day(20) });
    await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ title: 'Borrador', weight: 20 }));
    await ctx.grade.execute(ctx.alan.actor, id, [
      { enrollmentId: ctx.grace.id, score: 16, feedback: 'Bien' },
      { enrollmentId: ctx.linus.id, score: 4, feedback: null },
    ]);

    const courses = await ctx.progress.execute(ctx.grace.actor);

    const math = courses.find((course) => course.subject.id === MATH);
    expect(courses).toHaveLength(2);
    expect(math).toMatchObject({ groupName: '1ro A', average: 80, gradedWeight: 60 });
    expect(math?.teacher).toMatchObject({ firstName: 'Alan' });
    expect(math?.evaluations.map(({ title, grade }) => [title, grade?.score ?? null])).toEqual([
      ['Examen parcial', 16],
      ['Quiz', null],
    ]);
    expect(math?.evaluations[0].grade).toMatchObject({ feedback: 'Bien' });
  });

  it('shows nothing to a Student who is not enrolled, or acting in another institution', async () => {
    const ctx = setup();
    await ctx.published();

    expect(await ctx.progress.execute(ctx.ada.actor)).toEqual([]);
    expect(await ctx.progress.execute({ ...ctx.grace.actor, institutionId: B })).toEqual([]);
    expect(await ctx.progress.execute(ctx.alan.actor)).toEqual([]);
  });
});

describe('the calendar of due evaluations', () => {
  it('shows a Teacher their own evaluations, drafts included, soonest first', async () => {
    const ctx = setup();
    await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ title: 'Segundo', weight: 10, dueAt: day(20) }));
    await ctx.published({ title: 'Primero', weight: 10, dueAt: day(5) });
    await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ title: 'Sin fecha', weight: 10, dueAt: null }));
    await ctx.create.execute(ctx.emmy.actor, ctx.history, exam({ title: 'Historia', dueAt: day(7) }));

    const entries = await ctx.due.execute(ctx.alan.actor, day(1), null);

    expect(entries.map(({ title, isPublished, role }) => [title, isPublished, role])).toEqual([
      ['Primero', true, 'TEACHER'],
      ['Segundo', false, 'TEACHER'],
    ]);
  });

  it('shows a Student the published evaluations of every course, inside the range asked for', async () => {
    const ctx = setup();
    await ctx.published({ title: 'Pasado', weight: 10, dueAt: day(1) });
    await ctx.published({ title: 'Matemática', weight: 10, dueAt: day(12) });
    await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ title: 'Borrador', weight: 10, dueAt: day(13) }));
    const history = await ctx.create.execute(ctx.emmy.actor, ctx.history, exam({ title: 'Historia', dueAt: day(8) }));
    await ctx.publish.execute(ctx.emmy.actor, history.id);
    await ctx.published({ title: 'Lejano', weight: 10, dueAt: day(28) });

    const entries = await ctx.due.execute(ctx.grace.actor, day(5), day(20));

    expect(entries.map(({ title, role }) => [title, role])).toEqual([
      ['Historia', 'STUDENT'],
      ['Matemática', 'STUDENT'],
    ]);
    expect(await ctx.due.execute(ctx.ada.actor, day(1), null)).toEqual([]);
  });

  it('refuses a range that ends before it starts', async () => {
    const ctx = setup();

    await expect(ctx.due.execute(ctx.grace.actor, day(10), day(5))).rejects.toBeInstanceOf(InvalidEvaluationException);
  });
});

describe('announcing a published evaluation', () => {
  it('tells every enrolled Student, and nobody else', async () => {
    const ctx = setup();
    const draft = await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ title: 'Examen parcial' }));
    expect(ctx.notifier.requests).toEqual([]);

    await ctx.publish.execute(ctx.alan.actor, draft.id);

    expect(ctx.notifier.requests.map((request) => request.recipient)).toEqual([
      { membershipId: ctx.grace.id },
      { membershipId: ctx.linus.id },
    ]);
    expect(ctx.notifier.requests[0]).toMatchObject({
      institutionId: A,
      type: 'EVALUATION_PUBLISHED',
      data: { evaluationId: draft.id, evaluationTitle: 'Examen parcial', groupName: '1ro A', dueAt: day(10).toISOString() },
    });
  });

  it('tells nobody again when an evaluation already published is published once more', async () => {
    const ctx = setup();
    const { id } = await ctx.published();
    const told = ctx.notifier.requests.length;

    await ctx.publish.execute(ctx.alan.actor, id);

    expect(ctx.notifier.requests).toHaveLength(told);
  });

  it('tells nobody when publishing is refused', async () => {
    const ctx = setup();
    const { id } = await ctx.create.execute(ctx.alan.actor, ctx.math, exam());

    await expect(ctx.publish.execute(ctx.emmy.actor, id)).rejects.toBeInstanceOf(NotCourseTeacherException);

    expect(ctx.notifier.requests).toEqual([]);
  });
});

describe('exporting the gradebook', () => {
  const format = {
    separator: ';' as const,
    decimal: ',' as const,
    labels: {
      lastName: 'Apellidos',
      firstName: 'Nombres',
      average: 'Promedio',
      gradedWeight: 'Evaluado',
      evaluation: (title: string, weight: string, maxScore: string) => `${title} ${weight}/${maxScore}`,
    },
  };

  it('writes the enrolled Students with their scores in published evaluations and their average', async () => {
    const ctx = setup();
    const { id } = await ctx.published({ title: 'Examen', weight: 60 });
    await ctx.create.execute(ctx.alan.actor, ctx.math, exam({ title: 'Borrador', weight: 20 }));
    await ctx.grade.execute(ctx.alan.actor, id, [{ enrollmentId: ctx.grace.id, score: 15.5, feedback: 'Privado' }]);

    const file = await ctx.exportCsv.execute(ctx.alan.actor, ctx.math, format);

    const lines = file.csv.replace('\uFEFF', '').split('\r\n');
    expect(lines[0]).toBe('Apellidos;Nombres;Examen 60/20;Promedio;Evaluado');
    expect(lines.slice(1, 3)).toEqual(['Prueba;Grace;15,5;77,5;60', 'Prueba;Linus;;;0']);
    // Drafts and feedback stay out of the file
    expect(file.csv).not.toContain('Borrador');
    expect(file.csv).not.toContain('Privado');
    expect(file.name).toContain('1ro A');
  });

  it('is only for the Teacher assigned to the course', async () => {
    const ctx = setup();

    await expect(ctx.exportCsv.execute(ctx.emmy.actor, ctx.math, format)).rejects.toBeInstanceOf(
      NotCourseTeacherException,
    );
    await expect(ctx.exportCsv.execute(ctx.grace.actor, ctx.math, format)).rejects.toBeInstanceOf(
      NotCourseTeacherException,
    );
    await expect(
      ctx.exportCsv.execute({ ...ctx.alan.actor, institutionId: B }, ctx.math, format),
    ).rejects.toBeInstanceOf(CourseNotFoundException);
  });
});
