export const REALTIME = Symbol('Realtime');

/** The events the server pushes to a connected browser. */
export const RealtimeEvent = {
  /** A direct message was sent or received; the payload is the message. */
  MESSAGE: 'message',
  /** The user has a new notice; the client fetches them again. */
  NOTIFICATION: 'notification',
} as const;
export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

/**
 * Live delivery to the browsers a user has open, and what is known about them.
 * Nothing here is guaranteed: a user without a connection simply gets nothing.
 */
export interface Realtime {
  publish(userId: string, event: RealtimeEvent, payload: unknown): void;
  /** Whether the user has at least one browser connected, to any server. */
  isOnline(userId: string): Promise<boolean>;
  /** Whether one of the user's browsers says it is showing `key` right now (an open conversation). */
  isViewing(userId: string, key: string): Promise<boolean>;
}
