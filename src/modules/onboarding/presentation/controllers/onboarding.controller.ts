import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type {
  AuthenticatedUser,
  MembershipClaim,
} from '../../../../shared/domain/auth/authenticated-user.js';
import { Role } from '../../../../shared/domain/auth/role.js';
import {
  CurrentInstitutionId,
  CurrentMembership,
  CurrentUser,
  Roles,
} from '../../../../shared/presentation/decorators/auth.decorators.js';
import type { OnboardingApplicationView } from '../../application/onboarding-application.view.js';
import {
  CaptureIdentityDocumentUseCase,
  ConfirmIdentityUseCase,
} from '../../application/use-cases/identity-check.use-cases.js';
import { MAX_DOCUMENT_IMAGE_BYTES } from '../../domain/document-image.js';
import { ConfirmIdentityDto, SubmitDocumentDto } from '../dtos/onboarding.dtos.js';

// The only part of the multer file this controller relies on
interface UploadedImage {
  buffer: Buffer;
}

interface ApplicationResponse {
  application: OnboardingApplicationView;
}

/**
 * The enrolment desk: members show their ID in person, and whoever registers
 * them photographs it and confirms what was read. The use cases decide whom each desk may check.
 */
@Controller('onboarding/members/:membershipId')
@Roles(Role.ADMIN, Role.STAFF, Role.COORDINATOR)
export class OnboardingController {
  constructor(
    @Inject(CaptureIdentityDocumentUseCase)
    private readonly captureDocument: CaptureIdentityDocumentUseCase,
    @Inject(ConfirmIdentityUseCase) private readonly confirmIdentity: ConfirmIdentityUseCase,
  ) {}

  @Post('document')
  @HttpCode(HttpStatus.OK)
  // The size cap makes multer reject oversized uploads before they are buffered in memory
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_IMAGE_BYTES, files: 1 } }))
  async document(
    @CurrentUser() actor: AuthenticatedUser,
    @CurrentInstitutionId() institutionId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: SubmitDocumentDto,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<ApplicationResponse> {
    const application = await this.captureDocument.execute({
      actor,
      institutionId,
      membershipId,
      documentType: dto.documentType,
      content: file?.buffer,
    });
    return { application };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentUser() actor: AuthenticatedUser,
    @CurrentInstitutionId() institutionId: string,
    @CurrentMembership() membership: MembershipClaim | undefined,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body() dto: ConfirmIdentityDto,
  ): Promise<ApplicationResponse> {
    const application = await this.confirmIdentity.execute({
      actor,
      institutionId,
      membershipId,
      verifierMembershipId: membership?.id ?? null,
      firstName: dto.firstName,
      lastName: dto.lastName,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      birthDate: dto.birthDate,
    });
    return { application };
  }
}
