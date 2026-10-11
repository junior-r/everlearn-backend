import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Socket } from 'socket.io';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../../domain/auth/access-token-verifier.js';
import type { Realtime, RealtimeEvent } from '../../domain/realtime/realtime.js';

const MAX_VIEWING_KEY_LENGTH = 200;

interface SocketData {
  userId?: string;
  /** What the browser says it is showing; see `Realtime.isViewing`. */
  viewing?: string | null;
}

type UserSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

/**
 * The Socket.io endpoint (`/realtime`) browsers keep open to receive direct
 * messages and notices as they happen. A connection is accepted only with a
 * valid access token, sent in the handshake; the server pushes, and the only
 * thing a client may say is what it is looking at.
 */
// Any origin may connect: access depends on the token in the handshake, never on a cookie
@WebSocketGateway({ namespace: 'realtime', cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect, Realtime {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly sockets = new Map<string, Set<UserSocket>>();

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
    const sockets = this.sockets.get(user.userId) ?? new Set<UserSocket>();
    sockets.add(client);
    this.sockets.set(user.userId, sockets);
  }

  handleDisconnect(client: UserSocket): void {
    const { userId } = client.data;
    const sockets = userId ? this.sockets.get(userId) : undefined;
    if (userId && sockets) {
      sockets.delete(client);
      if (sockets.size === 0) {
        this.sockets.delete(userId);
      }
    }
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
    for (const socket of this.sockets.get(userId) ?? []) {
      try {
        socket.emit(event, payload);
      } catch (error) {
        this.logger.warn(error instanceof Error ? error.message : String(error));
      }
    }
  }

  isOnline(userId: string): boolean {
    return (this.sockets.get(userId)?.size ?? 0) > 0;
  }

  isViewing(userId: string, key: string): boolean {
    return [...(this.sockets.get(userId) ?? [])].some((socket) => socket.data.viewing === key);
  }
}
