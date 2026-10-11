import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../../domain/auth/access-token-verifier.js';
import type { Realtime, RealtimeEvent } from '../../domain/realtime/realtime.js';

const MAX_VIEWING_KEY_LENGTH = 200;

interface SocketData {
  userId?: string;
  /** What the browser says it is showing; see `Realtime.isViewing`. */
  viewing?: string | null;
}

type UserSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/** Every browser of a user is in this room, on whichever server it is connected to. */
const roomOf = (userId: string) => `user:${userId}`;

/**
 * The Socket.io endpoint (`/realtime`) browsers keep open to receive direct
 * messages and notices as they happen. A connection is accepted only with a
 * valid access token, sent in the handshake; the server pushes, and the only
 * thing a client may say is what it is looking at. Nothing is kept in this
 * server's memory: rooms and socket data go through the Socket.io adapter, so
 * with the Redis adapter every server sees every connection.
 */
// Any origin may connect: access depends on the token in the handshake, never on a cookie
@WebSocketGateway({ namespace: 'realtime', cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection, Realtime {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private readonly server!: Namespace<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

  constructor(@Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier) {}

  async handleConnection(client: UserSocket): Promise<void> {
    const token: unknown = client.handshake.auth.token;
    const user = typeof token === 'string' ? await this.verifier.verifyAccessToken(token).catch(() => null) : null;
    // A temporary password opens nothing but the screen that replaces it
    if (!user || user.mustChangePassword) {
      client.disconnect(true);
      return;
    }
    // The browser may have gone while the token was being checked
    if (client.disconnected) {
      return;
    }
    client.data.userId = user.userId;
    await client.join(roomOf(user.userId));
  }

  @SubscribeMessage('viewing')
  viewing(@ConnectedSocket() client: UserSocket, @MessageBody() key: unknown): void {
    // The HTTP guards do not cover websocket events: only a connection that passed the handshake counts
    if (!client.data.userId) {
      return;
    }
    client.data.viewing = typeof key === 'string' && key.length <= MAX_VIEWING_KEY_LENGTH ? key : null;
  }

  publish(userId: string, event: RealtimeEvent, payload: unknown): void {
    try {
      this.server.to(roomOf(userId)).emit(event, payload);
    } catch (error) {
      this.logger.warn(error instanceof Error ? error.message : String(error));
    }
  }

  async isOnline(userId: string): Promise<boolean> {
    return (await this.socketsOf(userId)).length > 0;
  }

  async isViewing(userId: string, key: string): Promise<boolean> {
    return (await this.socketsOf(userId)).some((data) => data.viewing === key);
  }

  /**
   * The user's connections on every server. If the other servers cannot be
   * asked, the user counts as away: an extra notice is better than a missed one.
   */
  private async socketsOf(userId: string): Promise<SocketData[]> {
    try {
      return (await this.server.in(roomOf(userId)).fetchSockets()).map((socket) => socket.data);
    } catch (error) {
      this.logger.warn(`Presence unknown: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}
