import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsDate,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  EvaluationType,
  MAX_FEEDBACK_LENGTH,
  MAX_SCORE_LIMIT,
  MAX_TITLE_LENGTH,
  MAX_TOTAL_WEIGHT,
} from '../domain/evaluation.js';

const TWO_DECIMALS = { maxDecimalPlaces: 2 };
/** More scores than one request may carry; a group is far smaller. */
const MAX_GRADES_PER_REQUEST = 500;

export class CreateEvaluationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE_LENGTH)
  title: string;

  @IsEnum(EvaluationType)
  type: EvaluationType;

  @IsNumber(TWO_DECIMALS)
  @Min(0.01)
  @Max(MAX_TOTAL_WEIGHT)
  weight: number;

  @IsNumber(TWO_DECIMALS)
  @Min(0.01)
  @Max(MAX_SCORE_LIMIT)
  maxScore: number;

  // Null means the evaluation has no due date
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueAt?: Date | null;
}

export class UpdateEvaluationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TITLE_LENGTH)
  title?: string;

  @IsOptional()
  @IsEnum(EvaluationType)
  type?: EvaluationType;

  @IsOptional()
  @IsNumber(TWO_DECIMALS)
  @Min(0.01)
  @Max(MAX_TOTAL_WEIGHT)
  weight?: number;

  @IsOptional()
  @IsNumber(TWO_DECIMALS)
  @Min(0.01)
  @Max(MAX_SCORE_LIMIT)
  maxScore?: number;

  // Null removes the due date; leaving the field out keeps it
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueAt?: Date | null;
}

export class GradeEntryDto {
  @IsUUID()
  enrollmentId: string;

  // Null removes the grade
  @ValidateIf((_, value) => value !== null)
  @IsNumber(TWO_DECIMALS)
  @Min(0)
  score: number | null;

  // Left out keeps the feedback already given; null removes it
  @ValidateIf((_, value) => value !== null)
  @IsOptional()
  @IsString()
  @MaxLength(MAX_FEEDBACK_LENGTH)
  feedback?: string | null;
}

export class RecordGradesDto {
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_GRADES_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => GradeEntryDto)
  grades: GradeEntryDto[];
}

export class CalendarQueryDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class ExportQueryDto {
  // The language of the file's headings and number format; Spanish when left out
  @IsOptional()
  @IsIn(['es', 'en'])
  lang?: 'es' | 'en';
}
