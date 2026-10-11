import type { Email } from '../../../../shared/domain/email/email-provider.js';

/**
 * What the owner of an account is told after its password changes, however it
 * was changed. It never carries the password.
 */
export const passwordChangedEmail = (user: { email: string; firstName: string }): Email => ({
  to: user.email,
  subject: 'Tu contraseña de Everlearn fue cambiada',
  text: [
    `Hola, ${user.firstName}:`,
    '',
    'La contraseña de tu cuenta acaba de cambiarse y se cerraron todas tus sesiones abiertas.',
    'Si fuiste tú, no tienes que hacer nada más.',
    'Si no fuiste tú, restablece tu contraseña de inmediato desde la pantalla de inicio de sesión y avisa a tu institución.',
    '',
    'Everlearn',
  ].join('\n'),
});
