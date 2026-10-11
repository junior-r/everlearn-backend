import {
  FakeRealtime,
  InMemoryNotificationRepository,
  InMemoryReminderQueries,
  RecordingEmailProvider,
} from '../../../../../test/support/communication.fakes.js';
import { NotificationType, type NotificationRequest } from '../../../../shared/domain/notifications/notifier.js';
import { emailFor, NOTIFICATION_LIST_LIMIT } from '../../domain/notification.js';
import { localClock, startInstant } from '../../domain/reminders.js';
import {
  ListNotificationsUseCase,
  MarkNotificationsReadUseCase,
  SendNotificationsUseCase,
  SendRemindersUseCase,
} from './notification.use-cases.js';

const A = 'institution-a';

function setup() {
  const notifications = new InMemoryNotificationRepository();
  const emails = new RecordingEmailProvider();
  const realtime = new FakeRealtime();
  const queries = new InMemoryReminderQueries();
  const emailFailures: unknown[] = [];
  let ids = 0;
  for (const [userId, membershipId, firstName] of [
    ['grace', 'm-grace', 'Grace'],
    ['linus', 'm-linus', 'Linus'],
    ['alan', 'm-alan', 'Alan'],
  ]) {
    notifications.memberships.set(membershipId, userId);
    notifications.addressees.set(userId, { email: `${userId}@example.com`, firstName });
  }
  const send = new SendNotificationsUseCase(
    notifications,
    emails,
    realtime,
    () => `notice-${(ids += 1)}`,
    (error) => emailFailures.push(error),
  );
  return {
    notifications,
    emails,
    realtime,
    queries,
    emailFailures,
    send,
    list: new ListNotificationsUseCase(notifications),
    markRead: new MarkNotificationsReadUseCase(notifications),
    remind: new SendRemindersUseCase(queries, send),
  };
}

const published = (recipient: NotificationRequest['recipient'], extra: Partial<NotificationRequest> = {}) => ({
  recipient,
  institutionId: A,
  type: NotificationType.EVALUATION_PUBLISHED,
  data: { evaluationTitle: 'Examen parcial', subjectName: 'Matemática', groupName: '1ro A', dueAt: null },
  ...extra,
});

describe('sending notices', () => {
  it('stores a notice for each recipient, nudges their browsers and emails them', async () => {
    const ctx = setup();

    const sent = await ctx.send.execute([published({ userId: 'grace' }), published({ membershipId: 'm-linus' })]);

    expect(sent).toBe(2);
    expect(ctx.notifications.rows.map(({ userId, type, read }) => ({ userId, type, read }))).toEqual([
      { userId: 'grace', type: 'EVALUATION_PUBLISHED', read: false },
      { userId: 'linus', type: 'EVALUATION_PUBLISHED', read: false },
    ]);
    expect(ctx.realtime.published).toEqual([
      { userId: 'grace', event: 'notification', payload: null },
      { userId: 'linus', event: 'notification', payload: null },
    ]);
    expect(ctx.emails.sent.map(({ to, subject }) => ({ to, subject }))).toEqual([
      { to: 'grace@example.com', subject: 'Nueva evaluación en Matemática: Examen parcial' },
      { to: 'linus@example.com', subject: 'Nueva evaluación en Matemática: Examen parcial' },
    ]);
    expect(ctx.emails.sent[0].text).toContain('Hola, Grace:');
  });

  it('skips a membership that does not exist, and does nothing for an empty list', async () => {
    const ctx = setup();

    expect(await ctx.send.execute([published({ membershipId: 'm-nobody' })])).toBe(0);
    expect(await ctx.send.execute([])).toBe(0);
    expect(ctx.notifications.rows).toEqual([]);
    expect(ctx.emails.sent).toEqual([]);
  });

  it('lets a notice with a dedupe key through once per person, however often it is asked for', async () => {
    const ctx = setup();
    const reminder = (userId: string) => published({ userId }, { dedupeKey: 'evaluation-due:e1' });

    expect(await ctx.send.execute([reminder('grace'), reminder('linus')])).toBe(2);
    expect(await ctx.send.execute([reminder('grace'), reminder('linus'), reminder('alan')])).toBe(1);
    // Reading it does not let it through again
    await ctx.markRead.execute('grace', null);
    expect(await ctx.send.execute([reminder('grace')])).toBe(0);

    expect(ctx.emails.sent.map((email) => email.to)).toEqual([
      'grace@example.com',
      'linus@example.com',
      'alan@example.com',
    ]);
  });

  it('keeps a single unread notice per collapse key, and adds another once it was read', async () => {
    const ctx = setup();
    const message = published({ userId: 'grace' }, { type: NotificationType.DIRECT_MESSAGE, collapseKey: 'dm:a:alan' });

    expect(await ctx.send.execute([message])).toBe(1);
    expect(await ctx.send.execute([message])).toBe(0);
    expect(await ctx.send.execute([{ ...message, collapseKey: 'dm:a:linus' }])).toBe(1);
    await ctx.markRead.execute('grace', null);
    expect(await ctx.send.execute([message])).toBe(1);

    expect(ctx.notifications.rows.filter((row) => row.collapseKey === 'dm:a:alan')).toHaveLength(2);
  });

  it('sends no email when the request says so, but still stores and nudges', async () => {
    const ctx = setup();

    await ctx.send.execute([published({ userId: 'grace' }, { email: false }), published({ userId: 'linus' })]);

    expect(ctx.notifications.rows).toHaveLength(2);
    expect(ctx.emails.sent.map((email) => email.to)).toEqual(['linus@example.com']);
    expect(ctx.realtime.published).toHaveLength(2);
  });

  it('keeps the notice, and emails the others, when one mailbox refuses', async () => {
    const ctx = setup();
    ctx.emails.refused.add('grace@example.com');

    const sent = await ctx.send.execute([published({ userId: 'grace' }), published({ userId: 'linus' })]);

    expect(sent).toBe(2);
    expect(ctx.emails.sent.map((email) => email.to)).toEqual(['linus@example.com']);
    expect(ctx.emailFailures).toHaveLength(1);
  });
});

describe('reading notices', () => {
  it('lists a user\'s own latest notices, newest first, with how many are unread', async () => {
    const ctx = setup();
    await ctx.send.execute([published({ userId: 'grace' }), published({ userId: 'linus' })]);
    await ctx.send.execute([published({ userId: 'grace' }, { type: NotificationType.WELCOME, data: {} })]);

    const mine = await ctx.list.execute('grace');

    expect(mine.unread).toBe(2);
    expect(mine.items.map((notice) => notice.type)).toEqual(['WELCOME', 'EVALUATION_PUBLISHED']);
    expect(mine.items[0]).not.toHaveProperty('userId');
    expect((await ctx.list.execute('alan')).items).toEqual([]);
  });

  it('shows only the latest ones, and still counts every unread one', async () => {
    const ctx = setup();
    for (let index = 0; index < NOTIFICATION_LIST_LIMIT + 5; index += 1) {
      await ctx.send.execute([published({ userId: 'grace' })]);
    }

    const mine = await ctx.list.execute('grace');

    expect(mine.items).toHaveLength(NOTIFICATION_LIST_LIMIT);
    expect(mine.unread).toBe(NOTIFICATION_LIST_LIMIT + 5);
  });

  it('marks the given notices, or all of them, as read, and never another user\'s', async () => {
    const ctx = setup();
    await ctx.send.execute([published({ userId: 'grace' }), published({ userId: 'grace' }), published({ userId: 'linus' })]);
    const [first] = (await ctx.list.execute('grace')).items;
    const [linusNotice] = (await ctx.list.execute('linus')).items;

    await ctx.markRead.execute('grace', [first.id, linusNotice.id]);
    expect((await ctx.list.execute('grace')).unread).toBe(1);
    expect((await ctx.list.execute('linus')).unread).toBe(1);

    await ctx.markRead.execute('grace', null);
    expect((await ctx.list.execute('grace')).unread).toBe(0);
    expect((await ctx.list.execute('linus')).unread).toBe(1);
  });
});

describe('localClock', () => {
  it('reads an instant as the wall clock of a time zone', () => {
    // 01:30 UTC on Monday is still Sunday evening in Caracas (UTC-4)
    const instant = new Date('2026-10-12T01:30:00Z');

    expect(localClock(instant, 'America/Caracas')).toEqual({ weekday: 'SUNDAY', date: '2026-10-11', minute: 21 * 60 + 30 });
    expect(localClock(instant, 'UTC')).toEqual({ weekday: 'MONDAY', date: '2026-10-12', minute: 90 });
    expect(localClock(instant, 'Europe/Madrid')).toEqual({ weekday: 'MONDAY', date: '2026-10-12', minute: 3 * 60 + 30 });
  });

  it('is null for a time zone that does not exist', () => {
    expect(localClock(new Date(), 'Mars/Olympus')).toBeNull();
  });

  it('turns a start time of the timetable back into an instant', () => {
    const now = new Date('2026-10-12T11:52:40Z');
    const clock = localClock(now, 'America/Caracas');

    // 08:00 in Caracas is 12:00 UTC
    expect(clock && startInstant(now, clock, 8 * 60)).toEqual(new Date('2026-10-12T12:00:00Z'));
  });
});

describe('telling Guardians', () => {
  const absence = (guardiansOf: string) => ({
    recipient: { guardiansOf },
    institutionId: 'institution-a',
    type: NotificationType.WARD_ATTENDANCE,
    data: { studentName: 'Grace Hopper', subjectName: 'Matemática', groupName: '1ro A', status: 'ABSENT', date: '2026-10-12T08:00:00.000Z' },
    dedupeKey: `attendance:session:${guardiansOf}`,
  });

  it('gives every Guardian linked to the Student a notice and an email, once', async () => {
    const ctx = setup();
    ctx.notifications.guardians.set('m-grace', ['alan', 'linus']);

    await ctx.send.execute([absence('m-grace')]);
    await ctx.send.execute([absence('m-grace')]);

    expect(ctx.notifications.rows.map((row) => [row.userId, row.type])).toEqual([
      ['alan', 'WARD_ATTENDANCE'],
      ['linus', 'WARD_ATTENDANCE'],
    ]);
    expect(ctx.emails.sent.map((email) => email.to)).toEqual(['alan@example.com', 'linus@example.com']);
    expect(ctx.emails.sent[0].subject).toBe('Grace Hopper no asistió a Matemática');
  });

  it('tells nobody when the Student has no Guardian', async () => {
    const ctx = setup();

    await ctx.send.execute([absence('m-grace')]);

    expect(ctx.notifications.rows).toEqual([]);
    expect(ctx.emails.sent).toEqual([]);
  });
});

describe('reminders', () => {
  const NOW = new Date('2026-10-12T11:50:00Z');

  function seeded() {
    const ctx = setup();
    ctx.queries.evaluations = [
      {
        evaluationId: 'e-soon',
        institutionId: A,
        title: 'Examen parcial',
        subjectName: 'Matemática',
        groupName: '1ro A',
        dueAt: new Date('2026-10-13T10:00:00Z'),
        studentMembershipIds: ['m-grace', 'm-linus'],
      },
      {
        evaluationId: 'e-later',
        institutionId: A,
        title: 'Proyecto',
        subjectName: 'Matemática',
        groupName: '1ro A',
        dueAt: new Date('2026-10-14T10:00:00Z'),
        studentMembershipIds: ['m-grace'],
      },
      {
        evaluationId: 'e-past',
        institutionId: A,
        title: 'Tarea',
        subjectName: 'Matemática',
        groupName: '1ro A',
        dueAt: new Date('2026-10-12T09:00:00Z'),
        studentMembershipIds: ['m-grace'],
      },
    ];
    const slot = (slotId: string, weekday: string, startMinute: number) => ({
      slotId,
      weekday,
      institutionId: A,
      subjectName: 'Matemática',
      groupName: '1ro A',
      startMinute,
      membershipIds: ['m-alan', 'm-grace'],
    });
    // 11:50 UTC is 07:50 in Caracas, a Monday
    ctx.queries.classes.set('America/Caracas', [
      slot('s-8', 'MONDAY', 8 * 60),
      slot('s-9', 'MONDAY', 9 * 60),
      slot('s-tuesday', 'TUESDAY', 8 * 60),
      slot('s-now', 'MONDAY', 7 * 60 + 50),
    ]);
    return ctx;
  }

  it('reminds Students of evaluations due within a day, and everyone of a class about to start', async () => {
    const ctx = seeded();

    const sent = await ctx.remind.execute(NOW);

    expect(sent).toBe(4);
    expect(ctx.notifications.rows.map(({ userId, type, dedupeKey }) => ({ userId, type, dedupeKey }))).toEqual([
      { userId: 'grace', type: 'EVALUATION_DUE', dedupeKey: 'evaluation-due:e-soon' },
      { userId: 'linus', type: 'EVALUATION_DUE', dedupeKey: 'evaluation-due:e-soon' },
      { userId: 'alan', type: 'CLASS_STARTING', dedupeKey: 'class-starting:s-8:2026-10-12' },
      { userId: 'grace', type: 'CLASS_STARTING', dedupeKey: 'class-starting:s-8:2026-10-12' },
    ]);
    const classNotice = ctx.notifications.rows[2];
    expect(classNotice.data).toEqual({ subjectName: 'Matemática', groupName: '1ro A', startsAt: '2026-10-12T12:00:00.000Z' });
    // The timetable is asked in the institution's own time, for the next quarter of an hour
    expect(ctx.queries.asked).toEqual([
      {
        timezone: 'America/Caracas',
        clock: { weekday: 'MONDAY', date: '2026-10-12', minute: 7 * 60 + 50 },
        untilMinute: 8 * 60 + 5,
      },
    ]);
  });

  it('sends each reminder once, however often the job runs', async () => {
    const ctx = seeded();

    await ctx.remind.execute(NOW);
    const again = await ctx.remind.execute(new Date(NOW.getTime() + 5 * 60_000));

    expect(again).toBe(0);
    expect(ctx.emails.sent).toHaveLength(4);
  });

  it('reminds of the same class again the following week', async () => {
    const ctx = seeded();

    await ctx.remind.execute(NOW);
    const nextWeek = await ctx.remind.execute(new Date(NOW.getTime() + 7 * 24 * 3_600_000));

    // The class again; the evaluation is long past
    expect(nextWeek).toBe(2);
    expect(ctx.notifications.rows.at(-1)?.dedupeKey).toBe('class-starting:s-8:2026-10-19');
  });

  it('skips an institution whose time zone is not known, and does nothing when nothing is near', async () => {
    const ctx = setup();
    ctx.queries.classes.set('Mars/Olympus', []);

    expect(await ctx.remind.execute(NOW)).toBe(0);
    expect(ctx.queries.asked).toEqual([]);
  });
});

describe('emailFor', () => {
  it('writes an email for every kind of notice', () => {
    for (const type of Object.values(NotificationType)) {
      const email = emailFor(type, { senderName: 'Alan Turing', subjectName: 'Matemática', evaluationTitle: 'Examen' }, 'Grace');

      expect(email.subject.length).toBeGreaterThan(5);
      expect(email.text).toContain('Hola, Grace:');
      expect(email.text).not.toContain('undefined');
    }
  });

  it('never puts the text of a direct message in the email', () => {
    const email = emailFor(NotificationType.DIRECT_MESSAGE, { senderName: 'Alan Turing', senderId: 'u1' }, 'Grace');

    expect(email.subject).toBe('Nuevo mensaje de Alan Turing');
    expect(email.text).toContain('Entra a la plataforma para leer el mensaje.');
  });
});
