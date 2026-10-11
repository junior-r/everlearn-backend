import { Logger, type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Makes Socket.io work across several backend servers: what one of them emits
 * reaches the browsers connected to the others, and questions about who is
 * connected are answered by all of them, through Redis pub/sub.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly log = new Logger(RedisIoAdapter.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor(app: INestApplicationContext, redis: Redis) {
    super(app);
    // A subscribed connection can do nothing else, so each direction gets its own
    this.publisher = redis.duplicate();
    this.subscriber = redis.duplicate();
    for (const client of [this.publisher, this.subscriber]) {
      // Without a listener an unreachable Redis would crash the process; with one, it reconnects
      client.on('error', (error: Error) => this.log.warn(`Realtime Redis: ${error.message}`));
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;
    server.adapter(createAdapter(this.publisher, this.subscriber));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    this.publisher.disconnect();
    this.subscriber.disconnect();
  }
}
