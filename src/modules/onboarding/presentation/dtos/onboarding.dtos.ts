import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { DocumentType } from '../../domain/entities/onboarding-application.entity.js';

const DOCUMENT_TYPES = Object.values(DocumentType);

export class SubmitDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  documentType: DocumentType;
}

export class ConfirmIdentityDto {
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
