import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  StreamableFile,
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
import type {
  ApplicationReviewView,
  OnboardingApplicationView,
} from '../../application/onboarding-application.view.js';
import { ConfirmOnboardingDataUseCase } from '../../application/use-cases/confirm-onboarding-data.use-case.js';
import { GetOnboardingApplicationUseCase } from '../../application/use-cases/get-onboarding-application.use-case.js';
import {
  GetApplicationDocumentUseCase,
  ListPendingReviewsUseCase,
  ReviewApplicationUseCase,
} from '../../application/use-cases/review.use-cases.js';
import { SubmitIdentityDocumentUseCase } from '../../application/use-cases/submit-identity-document.use-case.js';
import { MAX_DOCUMENT_IMAGE_BYTES } from '../../domain/document-image.js';
import {
  ConfirmOnboardingDto,
  ReviewApplicationDto,
  SubmitDocumentDto,
} from '../dtos/onboarding.dtos.js';

// The only part of the multer file this controller relies on
interface UploadedImage {
  buffer: Buffer;
}

interface ApplicationResponse {
  application: OnboardingApplicationView | null;
}

@Controller('onboarding')
export class OnboardingController {
  constructor(
    @Inject(GetOnboardingApplicationUseCase)
    private readonly getApplication: GetOnboardingApplicationUseCase,
    @Inject(SubmitIdentityDocumentUseCase)
    private readonly submitDocument: SubmitIdentityDocumentUseCase,
    @Inject(ConfirmOnboardingDataUseCase)
    private readonly confirmData: ConfirmOnboardingDataUseCase,
    @Inject(ListPendingReviewsUseCase) private readonly listPending: ListPendingReviewsUseCase,
    @Inject(ReviewApplicationUseCase) private readonly reviewApplication: ReviewApplicationUseCase,
    @Inject(GetApplicationDocumentUseCase)
    private readonly getDocument: GetApplicationDocumentUseCase,
  ) {}

  @Get('application')
  async current(@CurrentUser() user: AuthenticatedUser): Promise<ApplicationResponse> {
    return { application: await this.getApplication.execute(user.userId) };
  }

  @Post('document')
  @HttpCode(HttpStatus.OK)
  // The size cap makes multer reject oversized uploads before they are buffered in memory
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_IMAGE_BYTES, files: 1 } }))
  async document(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitDocumentDto,
    @UploadedFile() file: UploadedImage | undefined,
  ): Promise<ApplicationResponse> {
    const application = await this.submitDocument.execute({
      userId: user.userId,
      documentType: dto.documentType,
      content: file?.buffer,
    });
    return { application };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmOnboardingDto,
  ): Promise<ApplicationResponse> {
    const application = await this.confirmData.execute({
      userId: user.userId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      birthDate: dto.birthDate,
    });
    return { application };
  }

  @Get('applications/pending')
  @Roles(Role.ADMIN)
  pending(@CurrentInstitutionId() institutionId: string): Promise<ApplicationReviewView[]> {
    return this.listPending.execute(institutionId);
  }

  @Post('application/:id/review')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async review(
    @CurrentInstitutionId() institutionId: string,
    @CurrentMembership() membership: MembershipClaim | undefined,
    @Param('id', ParseUUIDPipe) applicationId: string,
    @Body() dto: ReviewApplicationDto,
  ): Promise<ApplicationResponse> {
    const application = await this.reviewApplication.execute({
      applicationId,
      institutionId,
      reviewerMembershipId: membership?.id ?? null,
      decision: dto.decision,
      reason: dto.reason,
    });
    return { application };
  }

  @Get('application/:id/document')
  @Roles(Role.ADMIN)
  // An identity document must never be kept by a browser or shared cache
  @Header('Cache-Control', 'private, no-store')
  async documentPhoto(
    @CurrentInstitutionId() institutionId: string,
    @Param('id', ParseUUIDPipe) applicationId: string,
  ): Promise<StreamableFile> {
    const image = await this.getDocument.execute(applicationId, institutionId);
    return new StreamableFile(image.content, { type: `image/${image.format}` });
  }
}
