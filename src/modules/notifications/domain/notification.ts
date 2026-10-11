import type { Email } from '../../../shared/domain/email/email-provider.js';
import {
  NotificationType,
  type NotificationData,
} from '../../../shared/domain/notifications/notifier.js';

export { NotificationType };
export type { NotificationData };

/** How many notices the bell shows. */
export const NOTIFICATION_LIST_LIMIT = 20;

export interface Notification {
  id: string;
  userId: string;
  institutionId: string | null;
  type: NotificationType;
  data: NotificationData;
  read: boolean;
  createdAt: Date;
}

/** A notice ready to be stored, with its recipient already resolved to an account. */
export interface NewNotification {
  /** Chosen by the caller, so it can tell which of the notices it asked for were added. */
  id: string;
  userId: string;
  institutionId: string | null;
  type: NotificationType;
  data: NotificationData;
  dedupeKey?: string;
  collapseKey?: string;
}

const text = (data: NotificationData, key: string) => {
  const value = data[key];
  return value === null || value === undefined ? '' : String(value);
};

/** A date-time as an email can say it without knowing the reader's time zone. */
const utc = (iso: string) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '');

/**
 * The email that goes with a notice. Emails are written here, in Spanish (the
 * platform's first language), because nothing knows the reader's language yet.
 */
export function emailFor(type: NotificationType, data: NotificationData, firstName: string): Omit<Email, 'to'> {
  const greeting = `Hola, ${firstName}:`;
  const sign = 'Everlearn';
  const compose = (subject: string, ...lines: string[]) => ({
    subject,
    text: [greeting, '', ...lines, '', sign].join('\n'),
  });
  switch (type) {
    case NotificationType.WELCOME:
      return compose(
        'Tu cuenta de Everlearn está activa',
        'Tu documento de identidad fue aprobado y tu cuenta ya está activa.',
        'Ya puedes entrar a la plataforma con tu correo y tu contraseña.',
      );
    case NotificationType.EVALUATION_PUBLISHED:
      return compose(
        `Nueva evaluación en ${text(data, 'subjectName')}: ${text(data, 'evaluationTitle')}`,
        `Tu docente publicó la evaluación «${text(data, 'evaluationTitle')}» en ${text(data, 'subjectName')} (grupo ${text(data, 'groupName')}).`,
        text(data, 'dueAt') ? `Fecha de entrega: ${utc(text(data, 'dueAt'))}.` : 'No tiene fecha de entrega.',
      );
    case NotificationType.EVALUATION_DUE:
      return compose(
        `Mañana vence: ${text(data, 'evaluationTitle')}`,
        `La evaluación «${text(data, 'evaluationTitle')}» de ${text(data, 'subjectName')} vence en menos de 24 horas.`,
        `Fecha de entrega: ${utc(text(data, 'dueAt'))}.`,
      );
    case NotificationType.CLASS_STARTING:
      return compose(
        `Tu clase de ${text(data, 'subjectName')} está por empezar`,
        `La clase de ${text(data, 'subjectName')} del grupo ${text(data, 'groupName')} empieza en unos minutos (${utc(text(data, 'startsAt'))}).`,
      );
    case NotificationType.GRADE_POSTED:
      return compose(
        `Tienes una nota nueva en ${text(data, 'subjectName')}`,
        `Tu docente calificó «${text(data, 'evaluationTitle')}» de ${text(data, 'subjectName')}: ${text(data, 'score')} sobre ${text(data, 'maxScore')}.`,
        'Entra a la plataforma para ver el detalle y tu promedio.',
      );
    case NotificationType.WARD_EVALUATION_PUBLISHED:
      return compose(
        `Nueva evaluación para ${text(data, 'studentName')}: ${text(data, 'evaluationTitle')}`,
        `Se publicó la evaluación «${text(data, 'evaluationTitle')}» de ${text(data, 'subjectName')} (grupo ${text(data, 'groupName')}) para ${text(data, 'studentName')}.`,
        text(data, 'dueAt') ? `Fecha de entrega: ${utc(text(data, 'dueAt'))}.` : 'No tiene fecha de entrega.',
      );
    case NotificationType.WARD_GRADE_POSTED:
      return compose(
        `Nueva nota de ${text(data, 'studentName')} en ${text(data, 'subjectName')}`,
        `${text(data, 'studentName')} obtuvo ${text(data, 'score')} sobre ${text(data, 'maxScore')} en «${text(data, 'evaluationTitle')}» de ${text(data, 'subjectName')}.`,
        'Entra a la plataforma para ver su promedio.',
      );
    case NotificationType.WARD_ATTENDANCE:
      return compose(
        text(data, 'status') === 'LATE'
          ? `${text(data, 'studentName')} llegó tarde a ${text(data, 'subjectName')}`
          : `${text(data, 'studentName')} no asistió a ${text(data, 'subjectName')}`,
        text(data, 'status') === 'LATE'
          ? `${text(data, 'studentName')} estuvo conectado solo una parte de la clase de ${text(data, 'subjectName')} (${utc(text(data, 'date'))}).`
          : `${text(data, 'studentName')} no estuvo en la clase de ${text(data, 'subjectName')} (${utc(text(data, 'date'))}).`,
        'Si crees que es un error, escribe a su docente desde la plataforma.',
      );
    case NotificationType.DIRECT_MESSAGE:
      return compose(
        `Nuevo mensaje de ${text(data, 'senderName')}`,
        `${text(data, 'senderName')} te escribió en Everlearn. Entra a la plataforma para leer el mensaje.`,
      );
  }
}
