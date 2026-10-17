import { randomUUID } from 'node:crypto';
import { createAdminFakes } from '../../../../../test/support/admin.fakes.js';
import { RecordingNotifier } from '../../../../../test/support/communication.fakes.js';
import {
  InMemoryGroupRepository,
  InMemoryMemberDirectory,
  InMemoryPeriodRepository,
} from '../../../../../test/support/group.fakes.js';
import {
  InMemoryLabAccessRepository,
  InMemoryLabAssignmentRepository,
  InMemoryLanguageExerciseRepository,
} from '../../../../../test/support/lab.fakes.js';
import type { MembershipClaim } from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import { BUILT_IN_EXERCISES } from '../../domain/built-in-exercises.js';
import {
  AttemptAlreadySubmittedException,
  InvalidAssignmentException,
  LabAssignmentNotFoundException,
  LabCourseNotFoundException,
  NotLabCourseTeacherException,
  type AssignmentData,
} from '../../domain/lab-assignment.js';
import { LabKey, LabNotFoundException } from '../../domain/lab-catalog.js';
import { Verdict } from '../../domain/language-exercise.js';
import type { Actor } from '../actor.js';
import {
  CreateLabAssignmentUseCase,
  DeleteLabAssignmentUseCase,
  GetLabAssignmentResultsUseCase,
  GetMyLabAssignmentUseCase,
  ListCourseLabAssignmentsUseCase,
  ListMyLabAssignmentsUseCase,
  SubmitLabAttemptUseCase,
} from './lab-assignment.use-cases.js';
import { CreateExerciseUseCase, SyncBuiltInExercisesUseCase } from './language-exercise.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';
const MATH = 'subject-math';
const SPANISH = 'subject-spanish';
const day = (date: number) => new Date(Date.UTC(2026, 10, date, 12));

const completions = BUILT_IN_EXERCISES.filter((exercise) => exercise.labKey === LabKey.COMPLETIONS);
const definition = BUILT_IN_EXERCISES.find((exercise) => exercise.labKey === LabKey.DEFINITIONS);

/** Institution A: Alan teaches Spanish and Emmy maths to 1ro A, where Grace and Linus are enrolled; Ada is not. */
async function setup() {
  const directory = new InMemoryMemberDirectory();
  const groups = new InMemoryGroupRepository(createAdminFakes().pensums, new InMemoryPeriodRepository(), directory);
  const access = new InMemoryLabAccessRepository();
  access.grantAll(A, [LabKey.GRAVITY, LabKey.COMPLETIONS, LabKey.DEFINITIONS]);
  const exercises = new InMemoryLanguageExerciseRepository();
  await new SyncBuiltInExercisesUseCase(exercises).execute();
  const assignments = new InMemoryLabAssignmentRepository(groups, directory);
  const notifier = new RecordingNotifier();
  let now = day(5);
  const member = (role: Role, firstName: string, institutionId = A) => {
    const claim: MembershipClaim = {
      id: directory.add(institutionId, role, firstName, 'Prueba').membershipId,
      institutionId,
      role,
    };
    return { id: claim.id, actor: { institutionId, memberships: [claim] } satisfies Actor };
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
      [SPANISH, alan.id],
      [MATH, emmy.id],
    ]),
    studentIds: [grace.id, linus.id],
  });
  return {
    access,
    exercises,
    assignments,
    notifier,
    groupId,
    alan,
    emmy,
    grace,
    linus,
    ada,
    spanish: { groupId, subjectId: SPANISH },
    math: { groupId, subjectId: MATH },
    setNow: (date: Date) => {
      now = date;
    },
    create: new CreateLabAssignmentUseCase(access, exercises, assignments, notifier),
    createExercise: new CreateExerciseUseCase(access, exercises),
    listCourse: new ListCourseLabAssignmentsUseCase(assignments),
    results: new GetLabAssignmentResultsUseCase(exercises, assignments),
    remove: new DeleteLabAssignmentUseCase(assignments),
    mine: new ListMyLabAssignmentsUseCase(access, assignments),
    detail: new GetMyLabAssignmentUseCase(access, exercises, assignments),
    submit: new SubmitLabAttemptUseCase(access, exercises, assignments, () => now),
  };
}

const activity = (overrides: Partial<AssignmentData> = {}): AssignmentData => ({
  labKey: LabKey.COMPLETIONS,
  title: 'Verbos en pasado',
  instructions: 'Completa cada oración.',
  dueAt: day(10),
  exerciseIds: completions.slice(0, 3).map(({ id }) => id),
  ...overrides,
});

describe('giving a lab activity', () => {
  it("lets the course's Teacher give one, and tells every Student of the group", async () => {
    const ctx = await setup();

    const assignment = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity({ title: '  Verbos  ' }));

    expect(assignment).toMatchObject({ labKey: LabKey.COMPLETIONS, title: 'Verbos', dueAt: day(10) });
    expect(ctx.notifier.requests.map((request) => request.recipient)).toEqual([
      { membershipId: ctx.grace.id },
      { membershipId: ctx.linus.id },
    ]);
    expect(ctx.notifier.requests[0]).toMatchObject({
      type: 'LAB_ASSIGNED',
      institutionId: A,
      data: { assignmentId: assignment.id, labKey: LabKey.COMPLETIONS, title: 'Verbos', groupName: '1ro A' },
      dedupeKey: `lab-assigned:${assignment.id}:${ctx.grace.id}`,
    });
  });

  it("refuses anyone but the course's Teacher, and a course of another institution", async () => {
    const ctx = await setup();

    await expect(ctx.create.execute(ctx.emmy.actor, ctx.spanish, activity())).rejects.toBeInstanceOf(
      NotLabCourseTeacherException,
    );
    await expect(
      ctx.create.execute({ ...ctx.alan.actor, institutionId: B }, ctx.spanish, activity()),
    ).rejects.toBeInstanceOf(LabCourseNotFoundException);
  });

  it('accepts only a lab the institution may use', async () => {
    const ctx = await setup();

    await expect(
      ctx.create.execute(ctx.emmy.actor, ctx.math, activity({ labKey: LabKey.FUNCTION_GRAPHER, exerciseIds: [] })),
    ).rejects.toBeInstanceOf(LabNotFoundException);
  });

  it('gives a simulation no exercises, and a language activity between 1 and 20 of its own lab', async () => {
    const ctx = await setup();
    const give = (data: Partial<AssignmentData>) => ctx.create.execute(ctx.alan.actor, ctx.spanish, activity(data));

    await expect(give({ labKey: LabKey.GRAVITY, exerciseIds: [completions[0].id] })).rejects.toBeInstanceOf(
      InvalidAssignmentException,
    );
    await expect(give({ exerciseIds: [] })).rejects.toBeInstanceOf(InvalidAssignmentException);
    await expect(give({ exerciseIds: [definition?.id ?? ''] })).rejects.toBeInstanceOf(InvalidAssignmentException);
    await expect(give({ exerciseIds: [randomUUID()] })).rejects.toBeInstanceOf(InvalidAssignmentException);
    await expect(give({ labKey: LabKey.GRAVITY, exerciseIds: [] })).resolves.toMatchObject({ exerciseIds: [] });
  });

  it("uses the Teacher's own exercises, but not another Teacher's", async () => {
    const ctx = await setup();
    const sentence = { prompt: 'Nosotros ___ ayer.', answers: ['llegamos'], hint: null };
    const alans = await ctx.createExercise.execute(ctx.alan.actor, LabKey.COMPLETIONS, sentence);
    const emmys = await ctx.createExercise.execute(ctx.emmy.actor, LabKey.COMPLETIONS, sentence);

    await expect(
      ctx.create.execute(ctx.alan.actor, ctx.spanish, activity({ exerciseIds: [alans.id] })),
    ).resolves.toMatchObject({ exerciseIds: [alans.id] });
    await expect(
      ctx.create.execute(ctx.alan.actor, ctx.spanish, activity({ exerciseIds: [emmys.id] })),
    ).rejects.toBeInstanceOf(InvalidAssignmentException);
  });

  it('lists the activities of a course with how many were handed in, to its Teacher only', async () => {
    const ctx = await setup();
    const assignment = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity());
    await ctx.submit.execute(ctx.grace.actor, assignment.id, { answers: [], note: null });

    expect(await ctx.listCourse.execute(ctx.alan.actor, ctx.spanish)).toEqual([
      expect.objectContaining({ id: assignment.id, submittedCount: 1, studentCount: 2 }),
    ]);
    await expect(ctx.listCourse.execute(ctx.emmy.actor, ctx.spanish)).rejects.toBeInstanceOf(
      NotLabCourseTeacherException,
    );
  });
});

describe('handing an activity in', () => {
  it('scores a language activity on the backend, an accent mistake earning no point', async () => {
    const ctx = await setup();
    const [first, second, third] = completions;
    const assignment = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity());

    const attempt = await ctx.submit.execute(ctx.grace.actor, assignment.id, {
      answers: [
        { exerciseId: first.id, answer: first.answers[0].toUpperCase() },
        { exerciseId: second.id, answer: 'leeria' },
        { exerciseId: third.id, answer: 'nada' },
      ],
      note: null,
    });

    expect(attempt).toMatchObject({ studentId: ctx.grace.id, score: 1, total: 3, submittedAt: day(5) });
    expect(attempt.answers.map((answer) => answer.verdict)).toEqual([
      Verdict.CORRECT,
      Verdict.ACCENTS,
      Verdict.INCORRECT,
    ]);
  });

  it('marks a simulation done, keeping the note the Student left', async () => {
    const ctx = await setup();
    const assignment = await ctx.create.execute(
      ctx.alan.actor,
      ctx.spanish,
      activity({ labKey: LabKey.GRAVITY, exerciseIds: [] }),
    );

    const attempt = await ctx.submit.execute(ctx.grace.actor, assignment.id, {
      answers: [],
      note: '  En Marte cae más lento. ',
    });

    expect(attempt).toMatchObject({ score: null, total: null, note: 'En Marte cae más lento.', answers: [] });
  });

  it('takes one attempt per Student', async () => {
    const ctx = await setup();
    const assignment = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity());
    await ctx.submit.execute(ctx.grace.actor, assignment.id, { answers: [], note: null });

    await expect(
      ctx.submit.execute(ctx.grace.actor, assignment.id, { answers: [], note: null }),
    ).rejects.toBeInstanceOf(AttemptAlreadySubmittedException);
  });

  it('hides the activity from anyone outside the group, and once its lab is switched off', async () => {
    const ctx = await setup();
    const assignment = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity());

    await expect(ctx.detail.execute(ctx.ada.actor, assignment.id)).rejects.toBeInstanceOf(
      LabAssignmentNotFoundException,
    );
    await expect(
      ctx.submit.execute(ctx.ada.actor, assignment.id, { answers: [], note: null }),
    ).rejects.toBeInstanceOf(LabAssignmentNotFoundException);

    await ctx.access.setEnabled(A, LabKey.COMPLETIONS, false);
    await expect(ctx.detail.execute(ctx.grace.actor, assignment.id)).rejects.toBeInstanceOf(
      LabAssignmentNotFoundException,
    );
    expect(await ctx.mine.execute(ctx.grace.actor)).toEqual([]);
  });

  it('shows the questions without answers, and the answers only once handed in', async () => {
    const ctx = await setup();
    const assignment = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity());

    const before = await ctx.detail.execute(ctx.grace.actor, assignment.id);
    expect(before.questions.map((question) => question.id)).toEqual(assignment.exerciseIds);
    expect(before.questions[0]).not.toHaveProperty('answers');
    expect(before.solutions).toBeNull();

    await ctx.submit.execute(ctx.grace.actor, assignment.id, { answers: [], note: null });
    const after = await ctx.detail.execute(ctx.grace.actor, assignment.id);
    expect(after.solutions?.[0]).toEqual({ exerciseId: completions[0].id, answers: completions[0].answers });
    expect(after.attempt).toMatchObject({ score: 0, total: 3 });
  });

  it("lists a Student's activities, the soonest due first, with what they handed in and whether it was late", async () => {
    const ctx = await setup();
    const later = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity({ title: 'Después', dueAt: day(20) }));
    const sooner = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity({ title: 'Antes', dueAt: day(8) }));
    const open = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity({ title: 'Sin fecha', dueAt: null }));
    ctx.setNow(day(9));
    await ctx.submit.execute(ctx.grace.actor, sooner.id, { answers: [], note: null });

    const mine = await ctx.mine.execute(ctx.grace.actor);

    expect(mine.map((assignment) => assignment.id)).toEqual([sooner.id, later.id, open.id]);
    expect(mine[0]).toMatchObject({ late: true, attempt: expect.objectContaining({ score: 0 }) });
    expect(mine[1]).toMatchObject({ late: false, attempt: null });
  });
});

describe('results', () => {
  it('lists every Student with their attempt, to the Teacher only, with the answers', async () => {
    const ctx = await setup();
    const assignment = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity());
    await ctx.submit.execute(ctx.linus.actor, assignment.id, {
      answers: [{ exerciseId: completions[0].id, answer: completions[0].answers[0] }],
      note: null,
    });

    const results = await ctx.results.execute(ctx.alan.actor, assignment.id);

    expect(results.exercises.map((exercise) => exercise.answers)).toEqual(
      completions.slice(0, 3).map((exercise) => exercise.answers),
    );
    expect(results.rows.map((row) => [row.student.firstName, row.attempt?.score ?? null])).toEqual([
      ['Grace', null],
      ['Linus', 1],
    ]);
    await expect(ctx.results.execute(ctx.emmy.actor, assignment.id)).rejects.toBeInstanceOf(
      NotLabCourseTeacherException,
    );
    await expect(
      ctx.results.execute({ ...ctx.alan.actor, institutionId: B }, assignment.id),
    ).rejects.toBeInstanceOf(LabAssignmentNotFoundException);
  });

  it('removes an activity with what was handed in, by its Teacher only', async () => {
    const ctx = await setup();
    const assignment = await ctx.create.execute(ctx.alan.actor, ctx.spanish, activity());

    await expect(ctx.remove.execute(ctx.emmy.actor, assignment.id)).rejects.toBeInstanceOf(
      NotLabCourseTeacherException,
    );
    await ctx.remove.execute(ctx.alan.actor, assignment.id);

    await expect(ctx.detail.execute(ctx.grace.actor, assignment.id)).rejects.toBeInstanceOf(
      LabAssignmentNotFoundException,
    );
  });
});
