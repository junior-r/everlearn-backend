import type { EmailProvider } from '../../../../shared/domain/email/email-provider.js';
import { InvalidResetTokenException } from '../../domain/exceptions/identity.exceptions.js';
import type { PasswordHasher } from '../../domain/ports/password-hasher.js';
import { PASSWORD_RESET_TTL_SECONDS, type PasswordResetTokens } from '../../domain/ports/password-reset-tokens.js';
import type { RefreshTokenRevocations } from '../../domain/ports/refresh-token-revocations.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';

export const RESET_LOCALES = ['es', 'en'] as const;
export type ResetLocale = (typeof RESET_LOCALES)[number];

export interface ResetLinkOptions {
  /** Where the app is served, without a trailing slash. */
  frontendUrl: string;
  /** Runs work the caller must not wait for; the default lets it finish on its own. */
  defer?: (work: Promise<void>) => void;
  onFailure?: (error: unknown) => void;
}

/**
 * The link an email carries. The token goes after `#`: that part of an address
 * is never sent to a server, so it stays out of access logs and referrers.
 */
export const resetLink = (frontendUrl: string, locale: ResetLocale, token: string) =>
  `${frontendUrl}/${locale}/reset-password#token=${token}`;

export class RequestPasswordResetUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: PasswordResetTokens,
    private readonly emails: EmailProvider,
    private readonly options: ResetLinkOptions,
  ) {}

  /**
   * Emails a reset link to the owner of the address, if there is one. It always
   * resolves the same way and without waiting for the email, so neither the
   * answer nor how long it takes says whether an account exists.
   */
  async execute(email: string, locale: ResetLocale = 'es'): Promise<void> {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    // A suspended account stays closed; resetting its password must not reopen it
    if (!user || user.isSuspended()) {
      return;
    }
    const work = this.send(user.id, user.email, user.firstName, locale).catch(
      this.options.onFailure ?? (() => undefined),
    );
    (this.options.defer ?? (() => undefined))(work);
  }

  private async send(userId: string, email: string, firstName: string, locale: ResetLocale): Promise<void> {
    const token = await this.tokens.issue(userId, PASSWORD_RESET_TTL_SECONDS);
    await this.emails.send({
      to: email,
      subject: 'Restablece tu contraseña de Everlearn',
      text: [
        `Hola, ${firstName}:`,
        '',
        'Recibimos una solicitud para restablecer la contraseña de tu cuenta. Abre este enlace para elegir una nueva:',
        '',
        resetLink(this.options.frontendUrl, locale, token),
        '',
        `El enlace funciona una sola vez y vence en ${PASSWORD_RESET_TTL_SECONDS / 60} minutos.`,
        'Si no pediste este cambio, ignora este mensaje: tu contraseña sigue siendo la misma.',
        '',
        'Everlearn',
      ].join('\n'),
    });
  }
}

export class ResetPasswordUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: PasswordResetTokens,
    private readonly hasher: PasswordHasher,
    private readonly revocations: RefreshTokenRevocations,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Sets a new password for the account a reset token was issued for. The token
   * is spent, and every session the account had open is closed: whoever asked
   * for the reset may have done so because someone else was signed in.
   */
  async execute(token: string, newPassword: string): Promise<void> {
    const userId = await this.tokens.consume(token);
    const user = userId ? await this.users.findById(userId) : null;
    if (!user || user.isSuspended()) {
      throw new InvalidResetTokenException();
    }
    await this.users.setPassword(user.id, await this.hasher.hash(newPassword));
    await this.revocations.revokeAllFor(user.id, this.now());
  }
}
