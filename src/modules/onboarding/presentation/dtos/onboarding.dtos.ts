import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ReviewDecision } from '../../application/use-cases/review.use-cases.js';
import { DocumentType } from '../../domain/entities/onboarding-application.entity.js';

const DOCUMENT_TYPES = Object.values(DocumentType);

export class SubmitDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  documentType: DocumentType;
}

export class ReviewApplicationDto {
  @IsIn(Object.values(ReviewDecision))
  decision: ReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class ConfirmOnboardingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsIn(DOCUMENT_TYPES)
  documentType: DocumentType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  documentNumber: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  birthDate: string;
}
