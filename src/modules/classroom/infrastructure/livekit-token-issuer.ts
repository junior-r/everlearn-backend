import type { JwtService } from '@nestjs/jwt';
import type { LiveKitConfig } from '../../../config/app-config.js';
import { ClassroomRole, VideoUnavailableException } from '../domain/classroom.js';
import type { VideoGrant, VideoTokenIssuer } from '../domain/ports/classroom.ports.js';

// Long enough for a class; the same token authorizes the participant's chat messages
const TOKEN_TTL_SECONDS = 4 * 60 * 60;

/**
 * Signs LiveKit access tokens: a JWT issued by the API key, whose subject is
 * the participant identity and whose `video` claim holds the room permissions.
 */
export class LiveKitTokenIssuer implements VideoTokenIssuer {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: LiveKitConfig | null,
  ) {}

  issue(grant: VideoGrant): Promise<string> {
    if (!this.config) {
      return Promise.reject(new VideoUnavailableException());
    }
    const video = {
      room: grant.roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      // Chat and captions reach the room through the video-server, never straight from a browser
      canPublishData: false,
    };
    // Seen by the room and read by the video-server, which is the only one that moderates and shares labs
    const attributes = {
      role: grant.canModerate ? ClassroomRole.TEACHER : ClassroomRole.STUDENT,
      // LiveKit attributes are strings: the keys are joined with commas
      labs: grant.shareableLabs.join(','),
      record: grant.canRecord ? 'true' : '',
    };
    return this.jwt.signAsync(
      { name: grant.displayName, video, attributes },
      {
        issuer: this.config.apiKey,
        subject: grant.identity,
        secret: this.config.apiSecret,
        expiresIn: TOKEN_TTL_SECONDS,
        algorithm: 'HS256',
      },
    );
  }
}
