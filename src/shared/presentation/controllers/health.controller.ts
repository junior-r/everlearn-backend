import { Controller, Get } from '@nestjs/common';
import { Public } from '../decorators/auth.decorators.js';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
