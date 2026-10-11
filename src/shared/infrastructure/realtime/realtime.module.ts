import { Global, Module } from '@nestjs/common';
import { IdentityModule } from '../../../modules/identity/identity.module.js';
import { REALTIME } from '../../domain/realtime/realtime.js';
import { RealtimeGateway } from './realtime.gateway.js';

/** Live delivery to connected browsers, for any module that has something to push. */
@Global()
@Module({
  imports: [IdentityModule],
  providers: [RealtimeGateway, { provide: REALTIME, useExisting: RealtimeGateway }],
  exports: [REALTIME],
})
export class RealtimeModule {}
