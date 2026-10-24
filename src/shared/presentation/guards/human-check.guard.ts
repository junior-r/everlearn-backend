import {
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  HUMAN_CHECK,
  HumanCheckFailedException,
  type HumanCheck,
} from '../../domain/human-check/human-check.js';

const HUMAN_CHECK_KEY = 'human-check:action';
/** The request header that carries the token of the challenge solved in the browser. */
export const HUMAN_CHECK_HEADER = 'x-human-check';

/**
 * Requires a solved bot challenge for `action` (the form's name, as the browser
 * widget declares it). Requires `@UseGuards(HumanCheckGuard)`.
 */
export const RequireHumanCheck = (action: string) => SetMetadata(HUMAN_CHECK_KEY, action);

@Injectable()
export class HumanCheckGuard implements CanActivate {
  private readonly logger = new Logger(HumanCheckGuard.name);

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(HUMAN_CHECK) private readonly humanCheck: HumanCheck,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.get<string | undefined>(HUMAN_CHECK_KEY, context.getHandler());
    if (!action) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers[HUMAN_CHECK_HEADER];
    const outcome = await this.humanCheck.verify({
      token: typeof token === 'string' ? token : '',
      action,
      remoteIp: request.ip ?? null,
    });
    if (outcome === 'failed') {
      throw new HumanCheckFailedException();
    }
    if (outcome === 'unavailable') {
      // Fail open, like the rate limit that still guards these routes: an outage at the provider must not lock everyone out
      this.logger.warn(`Bot check unavailable; let "${action}" through`);
    }
    return true;
  }
}
