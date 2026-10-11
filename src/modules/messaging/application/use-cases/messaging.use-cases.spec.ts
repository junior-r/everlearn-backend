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
  MessagesTooFastException,
  type Contact,
  type MessagingActor,
} from '../../domain/direct-message.js';
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

/** Institution A: Grace and Linus (Students), Alan (Teacher). Institution B: Emmy, and Alan again. */
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
  messages.members.set(B, [contact('emmy', 'Emmy', 'Noether', Role.TEACHER), contact('alan', 'Alan', 'Turing', Role.STUDENT)]);
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
