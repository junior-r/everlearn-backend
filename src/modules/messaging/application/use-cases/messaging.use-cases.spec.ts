import {
  FakeRealtime,
  InMemoryMessageRepository,
  RecordingNotifier,
} from '../../../../../test/support/communication.fakes.js';
import { InMemoryRateLimiter } from '../../../../../test/support/identity.fakes.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  ContactNotFoundException,
  conversationKey,
  CONVERSATION_PAGE_SIZE,
  InvalidMessageException,
  MAX_MESSAGE_LENGTH,
  MessageNotAllowedException,
  MessagesTooFastException,
  type Contact,
  type MessagingActor,
} from '../../domain/direct-message.js';
import { reachOf } from '../../domain/messaging-reach.js';
import {
  ListConversationsUseCase,
  OpenConversationUseCase,
  SearchContactsUseCase,
  SendDirectMessageUseCase,
} from './messaging.use-cases.js';

const A = 'institution-a';
const B = 'institution-b';
const contact = (userId: string, firstName: string, lastName: string, ...roles: Role[]): Contact => ({
  userId,
  firstName,
  lastName,
  roles,
});
const actor = (userId: string, institutionId = A): MessagingActor => ({ userId, institutionId });
const grace = actor('grace');
const alan = actor('alan');

/**
 * Institution A: Alan teaches 1ro A, where Grace and Linus are enrolled; Tim teaches 2do B, where Ada
 * is. Rosa is the Institution Admin, Sam is Staff, Gina a Guardian.
 * Institution B: Emmy teaches a group Alan is enrolled in as a Student.
 */
function setup(limits = { maxMessages: 30, windowSeconds: 60 }) {
  const messages = new InMemoryMessageRepository();
  const realtime = new FakeRealtime();
  const notifier = new RecordingNotifier();
  const limiter = new InMemoryRateLimiter();
  messages.members.set(A, [
    contact('grace', 'Grace', 'Hopper', Role.STUDENT),
    contact('linus', 'Linus', 'Pauling', Role.STUDENT),
    contact('alan', 'Alan', 'Turing', Role.TEACHER),
  ]);
  messages.members.get(A)?.push(
    contact('tim', 'Tim', 'Berners', Role.TEACHER),
    contact('ada', 'Ada', 'Lovelace', Role.STUDENT),
    contact('rosa', 'Rosa', 'Franklin', Role.ADMIN),
    contact('sam', 'Sam', 'Morse', Role.STAFF),
    contact('gina', 'Gina', 'Rometty', Role.GUARDIAN),
  );
  messages.groups.set(A, [
    { teacherUserIds: ['alan'], studentUserIds: ['grace', 'linus'] },
    { teacherUserIds: ['tim'], studentUserIds: ['ada'] },
  ]);
  messages.members.set(B, [contact('emmy', 'Emmy', 'Noether', Role.TEACHER), contact('alan', 'Alan', 'Turing', Role.STUDENT)]);
  messages.groups.set(B, [{ teacherUserIds: ['emmy'], studentUserIds: ['alan'] }]);
  return {
    messages,
    realtime,
    notifier,
    limiter,
    search: new SearchContactsUseCase(messages),
    list: new ListConversationsUseCase(messages),
    open: new OpenConversationUseCase(messages, notifier),
    send: new SendDirectMessageUseCase(messages, realtime, notifier, limiter, limits),
  };
}

describe('finding someone to write to', () => {
  it('finds members of the same institution by any part of their name, never oneself', async () => {
    const ctx = setup();

    expect((await ctx.search.execute(grace, 'tur')).map((found) => found.userId)).toEqual(['alan']);
    expect((await ctx.search.execute(grace, ' LINUS pau ')).map((found) => found.userId)).toEqual(['linus']);
    expect(await ctx.search.execute(grace, 'grace')).toEqual([]);
    expect((await ctx.search.execute(grace, 'tur'))[0].roles).toEqual([Role.TEACHER]);
  });

  it('finds nobody of another institution, nor for a query too short, nor for someone who is not a member', async () => {
    const ctx = setup();

    expect(await ctx.search.execute(grace, 'emmy')).toEqual([]);
    expect(await ctx.search.execute(grace, 'a')).toEqual([]);
    expect(await ctx.search.execute(actor('stranger'), 'alan')).toEqual([]);
    expect(await ctx.search.execute(actor('grace', B), 'emmy')).toEqual([]);
  });
});

describe('sending a message', () => {
  it('stores it trimmed and delivers it to both ends at once', async () => {
    const ctx = setup();

    const message = await ctx.send.execute(grace, 'alan', '  Profesor, ¿puede revisar mi nota?  ');

    expect(message).toMatchObject({
      institutionId: A,
      senderId: 'grace',
      recipientId: 'alan',
      body: 'Profesor, ¿puede revisar mi nota?',
      readAt: null,
    });
    expect(ctx.realtime.published).toEqual([
      { userId: 'alan', event: 'message', payload: message },
      { userId: 'grace', event: 'message', payload: message },
    ]);
  });

  it('notifies a recipient who is away, by email too, with one notice per sender', async () => {
    const ctx = setup();

    await ctx.send.execute(grace, 'alan', 'Hola');

    expect(ctx.notifier.requests).toEqual([
      {
        recipient: { userId: 'alan' },
        institutionId: A,
        type: 'DIRECT_MESSAGE',
        data: { senderId: 'grace', senderName: 'Grace Hopper' },
        collapseKey: conversationKey(A, 'grace'),
        email: true,
      },
    ]);
  });

  it('notifies without email a recipient who is connected but looking elsewhere', async () => {
    const ctx = setup();
    ctx.realtime.online.add('alan');
    ctx.realtime.viewing.add(`alan|${conversationKey(A, 'linus')}`);

    await ctx.send.execute(grace, 'alan', 'Hola');

    expect(ctx.notifier.requests).toHaveLength(1);
    expect(ctx.notifier.requests[0].email).toBe(false);
  });

  it('does not notify a recipient who has the conversation open', async () => {
    const ctx = setup();
    ctx.realtime.online.add('alan');
    ctx.realtime.viewing.add(`alan|${conversationKey(A, 'grace')}`);

    await ctx.send.execute(grace, 'alan', 'Hola');

    expect(ctx.notifier.requests).toEqual([]);
    expect(ctx.realtime.published).toHaveLength(2);
  });

  it('refuses a stranger, oneself, and a member of another institution, all alike', async () => {
    const ctx = setup();

    for (const [who, to] of [
      [grace, 'stranger'],
      [grace, 'grace'],
      [grace, 'emmy'],
      [actor('stranger'), 'alan'],
      // Grace is not a member of B, even though Alan is
      [actor('grace', B), 'alan'],
    ] as const) {
      await expect(ctx.send.execute(who, to, 'Hola')).rejects.toBeInstanceOf(ContactNotFoundException);
    }
    expect(ctx.messages.messages).toEqual([]);
    expect(ctx.realtime.published).toEqual([]);
  });

  it('refuses an empty or oversized message', async () => {
    const ctx = setup();

    await expect(ctx.send.execute(grace, 'alan', '   ')).rejects.toBeInstanceOf(InvalidMessageException);
    await expect(ctx.send.execute(grace, 'alan', 'x'.repeat(MAX_MESSAGE_LENGTH + 1))).rejects.toBeInstanceOf(
      InvalidMessageException,
    );
    await expect(ctx.send.execute(grace, 'alan', 'x'.repeat(MAX_MESSAGE_LENGTH))).resolves.toBeDefined();
  });

  it('limits how fast one member may write, without holding back the others', async () => {
    const ctx = setup({ maxMessages: 2, windowSeconds: 60 });

    await ctx.send.execute(grace, 'alan', 'Uno');
    await ctx.send.execute(grace, 'alan', 'Dos');

    await expect(ctx.send.execute(grace, 'alan', 'Tres')).rejects.toMatchObject({
      constructor: MessagesTooFastException,
      retryAfterSeconds: 60,
    });
    await expect(ctx.send.execute(alan, 'grace', 'Hola')).resolves.toBeDefined();
    expect(ctx.messages.messages).toHaveLength(3);
  });

  it('keeps messages flowing when the rate limiter is down', async () => {
    const ctx = setup();
    ctx.limiter.failWith = new Error('redis down');

    await expect(ctx.send.execute(grace, 'alan', 'Hola')).resolves.toBeDefined();
  });
});

describe('reading conversations', () => {
  it('opens a conversation in order, reads what the peer sent, and clears the notice about it', async () => {
    const ctx = setup();
    await ctx.send.execute(grace, 'alan', 'Hola');
    await ctx.send.execute(alan, 'grace', '¿Qué necesitas?');
    await ctx.send.execute(grace, 'alan', 'Una duda');

    const opened = await ctx.open.execute(alan, 'grace');

    expect(opened.peer).toMatchObject({ userId: 'grace', firstName: 'Grace' });
    expect(opened.messages.map((message) => message.body)).toEqual(['Hola', '¿Qué necesitas?', 'Una duda']);
    // Only what Grace sent is read; what Alan sent waits for her
    expect(ctx.messages.messages.map((message) => message.readAt !== null)).toEqual([true, false, true]);
    expect(ctx.notifier.dismissed).toEqual([{ userId: 'alan', collapseKey: conversationKey(A, 'grace') }]);
  });

  it('returns the latest page, and older messages when asked for those before a date', async () => {
    const ctx = setup({ maxMessages: 1000, windowSeconds: 60 });
    for (let index = 1; index <= CONVERSATION_PAGE_SIZE + 3; index += 1) {
      await ctx.send.execute(grace, 'alan', `Mensaje ${index}`);
    }

    const latest = await ctx.open.execute(alan, 'grace');
    const older = await ctx.open.execute(alan, 'grace', latest.messages[0].createdAt);

    expect(latest.messages).toHaveLength(CONVERSATION_PAGE_SIZE);
    expect(latest.messages[0].body).toBe('Mensaje 4');
    expect(older.messages.map((message) => message.body)).toEqual(['Mensaje 1', 'Mensaje 2', 'Mensaje 3']);
  });

  it('keeps the conversations of each institution, and of each pair, apart', async () => {
    const ctx = setup();
    await ctx.send.execute(grace, 'alan', 'En A');
    await ctx.send.execute(actor('emmy', B), 'alan', 'En B');
    await ctx.send.execute(actor('linus'), 'alan', 'De Linus');

    expect((await ctx.open.execute(alan, 'grace')).messages.map((message) => message.body)).toEqual(['En A']);
    expect((await ctx.open.execute(actor('alan', B), 'emmy')).messages.map((message) => message.body)).toEqual(['En B']);
    await expect(ctx.open.execute(alan, 'emmy')).rejects.toBeInstanceOf(ContactNotFoundException);
    await expect(ctx.open.execute(actor('linus'), 'stranger')).rejects.toBeInstanceOf(ContactNotFoundException);
  });

  it('lists conversations with their last message and unread count, most recent first', async () => {
    const ctx = setup();
    await ctx.send.execute(grace, 'alan', 'Hola profesor');
    await ctx.send.execute(actor('linus'), 'alan', 'Buenos días');
    await ctx.send.execute(actor('linus'), 'alan', '¿Hay clase?');

    const list = await ctx.list.execute(alan);

    expect(list.map(({ peer, lastMessage, unread }) => ({ peer: peer.userId, last: lastMessage.body, unread }))).toEqual([
      { peer: 'linus', last: '¿Hay clase?', unread: 2 },
      { peer: 'grace', last: 'Hola profesor', unread: 1 },
    ]);
    await ctx.open.execute(alan, 'linus');
    expect((await ctx.list.execute(alan))[0].unread).toBe(0);
    // In B, Alan has no conversations
    expect(await ctx.list.execute(actor('alan', B))).toEqual([]);
  });
});

describe('who may write to whom', () => {
  const found = async (ctx: ReturnType<typeof setup>, who: MessagingActor, query: string) =>
    (await ctx.search.execute(who, query)).map((person) => person.userId).sort();
  const NAMES = ['grace', 'linus', 'alan', 'tim', 'ada', 'rosa', 'sam', 'gina'];
  /** Everyone of institution A the actor can find, looked up one name at a time. */
  const everyone = async (ctx: ReturnType<typeof setup>, who: MessagingActor) =>
    (await Promise.all(NAMES.map((name) => found(ctx, who, name)))).flat().sort();

  it('derives the reach of each role, and adds them up for someone who holds several', () => {
    expect(reachOf([Role.ADMIN]).anyone).toBe(true);
    expect(reachOf([Role.STAFF]).anyone).toBe(true);
    expect(reachOf([Role.COORDINATOR]).anyone).toBe(true);
    expect(reachOf([Role.STUDENT])).toEqual({
      anyone: false,
      roles: [],
      ownStudents: false,
      ownTeachers: true,
      groupMates: true,
    });
    expect(reachOf([Role.TEACHER])).toEqual({
      anyone: false,
      roles: [Role.TEACHER, Role.ADMIN, Role.COORDINATOR, Role.STAFF],
      ownStudents: true,
      ownTeachers: false,
      groupMates: false,
    });
    expect(reachOf([Role.GUARDIAN]).roles).toEqual([Role.ADMIN, Role.COORDINATOR, Role.STAFF]);
    expect(reachOf([Role.TEACHER, Role.STUDENT])).toMatchObject({ ownStudents: true, ownTeachers: true, groupMates: true });
    expect(reachOf([])).toEqual({ anyone: false, roles: [], ownStudents: false, ownTeachers: false, groupMates: false });
  });

  it('lets a Student find only their own Teachers and the Students of their groups', async () => {
    const ctx = setup();

    expect(await everyone(ctx, grace)).toEqual(['alan', 'linus']);
    expect(await found(ctx, grace, 'tim')).toEqual([]);
    expect(await found(ctx, grace, 'ada')).toEqual([]);
    expect(await found(ctx, grace, 'rosa')).toEqual([]);
    expect(await found(ctx, grace, 'gina')).toEqual([]);
  });

  it('lets a Teacher find their own Students, other Teachers and the office, but no other Students or Guardians', async () => {
    const ctx = setup();

    expect(await everyone(ctx, alan)).toEqual(['grace', 'linus', 'rosa', 'sam', 'tim']);
    expect(await found(ctx, alan, 'ada')).toEqual([]);
    expect(await found(ctx, alan, 'gina')).toEqual([]);
  });

  it('lets the office find anyone, and a Guardian only the office', async () => {
    const ctx = setup();

    expect(await everyone(ctx, actor('rosa'))).toEqual(['ada', 'alan', 'gina', 'grace', 'linus', 'sam', 'tim']);
    expect(await everyone(ctx, actor('sam'))).toContain('grace');
    expect(await everyone(ctx, actor('gina'))).toEqual(['rosa', 'sam']);
  });

  it('refuses a message to someone out of reach as if they did not exist', async () => {
    const ctx = setup();

    for (const [who, to] of [
      [grace, 'tim'],
      [grace, 'ada'],
      [grace, 'rosa'],
      [grace, 'sam'],
      [alan, 'ada'],
      [alan, 'gina'],
      [actor('gina'), 'alan'],
      [actor('gina'), 'grace'],
    ] as const) {
      await expect(ctx.send.execute(who, to, 'Hola'), `${who.userId} → ${to}`).rejects.toBeInstanceOf(
        ContactNotFoundException,
      );
      await expect(ctx.open.execute(who, to), `${who.userId} opens ${to}`).rejects.toBeInstanceOf(
        ContactNotFoundException,
      );
    }
    expect(ctx.messages.messages).toEqual([]);
  });

  it('delivers within reach in both directions', async () => {
    const ctx = setup();

    for (const [who, to] of [
      [grace, 'alan'],
      [grace, 'linus'],
      [alan, 'grace'],
      [alan, 'tim'],
      [alan, 'rosa'],
      [actor('rosa'), 'ada'],
      [actor('sam'), 'gina'],
      [actor('gina'), 'sam'],
    ] as const) {
      await expect(ctx.send.execute(who, to, 'Hola'), `${who.userId} → ${to}`).resolves.toBeDefined();
    }
  });

  it('lets a Student answer the office that wrote to them, but never write first', async () => {
    const ctx = setup();
    await expect(ctx.send.execute(grace, 'rosa', 'Hola')).rejects.toBeInstanceOf(ContactNotFoundException);

    await ctx.send.execute(actor('rosa'), 'grace', 'Pasa por la oficina, por favor.');

    const opened = await ctx.open.execute(grace, 'rosa');
    expect(opened.canWrite).toBe(true);
    await expect(ctx.send.execute(grace, 'rosa', 'Voy enseguida.')).resolves.toBeDefined();
    // Being written to by one member of the office opens no door to the others
    await expect(ctx.send.execute(grace, 'sam', 'Hola')).rejects.toBeInstanceOf(ContactNotFoundException);
    // And a Student cannot use a Teacher who is not theirs the same way
    await expect(ctx.send.execute(actor('ada'), 'alan', 'Hola')).rejects.toBeInstanceOf(ContactNotFoundException);
  });

  it('keeps a conversation readable, but closed, once the two are no longer within reach', async () => {
    const ctx = setup();
    await ctx.send.execute(grace, 'linus', '¿Hiciste la tarea?');
    // Linus leaves the group
    ctx.messages.groups.set(A, [
      { teacherUserIds: ['alan'], studentUserIds: ['grace'] },
      { teacherUserIds: ['tim'], studentUserIds: ['ada', 'linus'] },
    ]);

    const opened = await ctx.open.execute(grace, 'linus');

    expect(opened.canWrite).toBe(false);
    expect(opened.messages.map((message) => message.body)).toEqual(['¿Hiciste la tarea?']);
    await expect(ctx.send.execute(grace, 'linus', '¿Sigues ahí?')).rejects.toBeInstanceOf(MessageNotAllowedException);
    await expect(ctx.send.execute(actor('linus'), 'grace', 'Sí')).rejects.toBeInstanceOf(MessageNotAllowedException);
    expect(await found(ctx, grace, 'linus')).toEqual([]);
    expect(ctx.messages.messages).toHaveLength(1);
  });

  it('applies the rule of each institution to the role held there', async () => {
    const ctx = setup();

    // In B Alan is a Student of Emmy's: he reaches her, and nobody else there
    expect(await found(ctx, actor('alan', B), 'emmy')).toEqual(['emmy']);
    await expect(ctx.send.execute(actor('alan', B), 'emmy', 'Hola')).resolves.toBeDefined();
    // His being a Teacher in A gives him nothing in B, and Emmy is no colleague of his in A
    await expect(ctx.send.execute(alan, 'emmy', 'Hola')).rejects.toBeInstanceOf(ContactNotFoundException);
  });
});
