import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedUser } from '../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentUser,
  Public,
  Roles,
} from '../../../shared/presentation/decorators/auth.decorators.js';
import {
  GetRecordingLinkUseCase,
  ListCourseRecordingsUseCase,
} from '../application/use-cases/recording.use-cases.js';
import { RECORDING_MEDIA_FILES, type RecordingMediaFiles } from '../domain/ports/recording.ports.js';
import type { CourseRecordings, RecordingLink } from '../domain/recording.js';
import { RecordingLinkQueryDto } from './classroom.dtos.js';

/** Recordings of past classes, for the Teacher of each course and the Students of its group. */
@Controller()
export class RecordingsController {
  constructor(
    @Inject(ListCourseRecordingsUseCase) private readonly listRecordings: ListCourseRecordingsUseCase,
    @Inject(GetRecordingLinkUseCase) private readonly recordingLink: GetRecordingLinkUseCase,
    // Null when recordings are kept somewhere that serves its own links
    @Inject(RECORDING_MEDIA_FILES) private readonly mediaFiles: RecordingMediaFiles | null,
  ) {}

  @Get('groups/:groupId/courses/:subjectId/recordings')
  @Roles(Role.TEACHER, Role.STUDENT)
  recordings(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
  ): Promise<CourseRecordings> {
    return this.listRecordings.execute({ institutionId, memberships: user.memberships, groupId, subjectId });
  }

  /** A short-lived link to play the recording, or to download it with `?download=true`. */
  @Get('class-recordings/:recordingId/link')
  @Roles(Role.TEACHER, Role.STUDENT)
  link(
    @CurrentInstitutionId() institutionId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('recordingId', ParseUUIDPipe) recordingId: string,
    @Query() query: RecordingLinkQueryDto,
  ): Promise<RecordingLink> {
    return this.recordingLink.execute(institutionId, user.memberships, recordingId, query.download === 'true');
  }

  /**
   * The file behind a link of the local storage. Public because a `<video>` cannot
   * send the member's session: the signed, expiring link is the permission.
   */
  @Get('recordings/media/:token')
  @Public()
  async media(@Param('token') token: string, @Res() response: Response): Promise<void> {
    const file = this.mediaFiles ? await this.mediaFiles.resolve(token) : null;
    if (!file) {
      throw new NotFoundException();
    }
    // Byte ranges let the player seek without downloading the whole class
    response.sendFile(file.path, {
      acceptRanges: true,
      dotfiles: 'deny',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `${file.download ? 'attachment' : 'inline'}; filename="${file.fileName}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    }, (error) => {
      // A viewer who seeks or closes the player aborts the request: only a file that vanished is answered
      if (error && !response.headersSent) {
        response.status(404).end();
      }
    });
  }
}
