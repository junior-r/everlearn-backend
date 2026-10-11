export const NOTIFIER = Symbol('Notifier');

export const NotificationType = {
  WELCOME: 'WELCOME',
  EVALUATION_PUBLISHED: 'EVALUATION_PUBLISHED',
  EVALUATION_DUE: 'EVALUATION_DUE',
  CLASS_STARTING: 'CLASS_STARTING',
  DIRECT_MESSAGE: 'DIRECT_MESSAGE',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** What a notice is about. The client words it from this, in its own language. */
export type NotificationData = Record<string, string | number | null>;

/** A notice for one person, named by their account or by one of their memberships. */
export interface NotificationRequest {
  recipient: { userId: string } | { membershipId: string };
  /** The institution the notice comes from; null when it belongs to none. */
  institutionId: string | null;
  type: NotificationType;
  data: NotificationData;
  /** A notice with a key reaches a user once, however many times it is requested. */
  dedupeKey?: string;
  /** Notices that pile up share a key: while one is unread, no other is added. */
  collapseKey?: string;
  /** Whether to also send it by email. Defaults to true. */
  email?: boolean;
}

/**
 * Tells people that something happened, in the app and by email. It never
 * rejects: a notice that cannot be delivered must not undo what it announces.
 */
export interface Notifier {
  notify(requests: NotificationRequest[]): Promise<void>;
  /** Marks as read the unread notices of a user that share a collapse key. */
  dismiss(userId: string, collapseKey: string): Promise<void>;
}
