import { ResendEmailProvider, type ResendMessage, type ResendSend } from './resend-email.provider.js';

const email = { to: 'grace@example.com', subject: 'Tu cuenta está activa', text: 'Hola, Grace:\n\nYa puedes entrar.' };

function fakeResend(answer: Awaited<ReturnType<ResendSend>> | Error) {
  const sent: ResendMessage[] = [];
  const send: ResendSend = (message) => {
    sent.push(message);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  };
  return { sent, send };
}

describe('ResendEmailProvider', () => {
  it('hands Resend our email as plain text, from the configured sender', async () => {
    const resend = fakeResend({ data: { id: 'email-1' }, error: null });

    await new ResendEmailProvider(resend.send, 'Everlearn <no-reply@everlearn.test>').send(email);

    expect(resend.sent).toEqual([
      {
        from: 'Everlearn <no-reply@everlearn.test>',
        to: 'grace@example.com',
        subject: 'Tu cuenta está activa',
        text: 'Hola, Grace:\n\nYa puedes entrar.',
      },
    ]);
  });

  it('rejects when Resend answers with an error, without repeating its message', async () => {
    const resend = fakeResend({
      data: null,
      error: { name: 'validation_error', message: 'The grace@example.com address is not allowed' },
    });

    const failure = await new ResendEmailProvider(resend.send, 'Everlearn <no-reply@everlearn.test>')
      .send(email)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Resend refused the email (validation_error)');
  });

  it('lets a network failure through', async () => {
    const resend = fakeResend(new Error('fetch failed'));

    await expect(
      new ResendEmailProvider(resend.send, 'Everlearn <no-reply@everlearn.test>').send(email),
    ).rejects.toThrow('fetch failed');
  });
});
