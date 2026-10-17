import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  MAX_ASSIGNMENT_EXERCISES,
  MAX_ASSIGNMENT_TITLE_LENGTH,
  MAX_INSTRUCTIONS_LENGTH,
  MAX_NOTE_LENGTH,
} from '../domain/lab-assignment.js';
import { LAB_CATALOG, type LabKey } from '../domain/lab-catalog.js';
import {
  MAX_ANSWER_LENGTH,
  MAX_ANSWERS,
  MAX_HINT_LENGTH,
  MAX_PROMPT_LENGTH,
} from '../domain/language-exercise.js';

const LAB_KEYS = LAB_CATALOG.map((lab) => lab.key);
/** More answers than a request may carry; a set is far smaller. */
const MAX_ANSWERS_PER_REQUEST = 50;

export class SetLabGrantDto {
  @IsBoolean()
  granted: boolean;
}

export class SetLabEnabledDto {
  @IsBoolean()
  enabled: boolean;
}

export class ExerciseDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_PROMPT_LENGTH)
  prompt: string;

  @IsArray()
  @ArrayMaxSize(MAX_ANSWERS)
  @IsString({ each: true })
  @MaxLength(MAX_ANSWER_LENGTH, { each: true })
  answers: string[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_HINT_LENGTH)
  hint?: string | null;
}

export class GivenAnswerDto {
  @IsUUID()
  exerciseId: string;

  @IsString()
  @MaxLength(MAX_ANSWER_LENGTH * 2)
  answer: string;
}

export class PracticeAnswersDto {
  @IsArray()
  @ArrayMaxSize(MAX_ANSWERS_PER_REQUEST)
  @ValidateNested({ each: true })
  @Type(() => GivenAnswerDto)
  answers: GivenAnswerDto[];
}

export class CreateLabAssignmentDto {
  @IsIn(LAB_KEYS)
  labKey: LabKey;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ASSIGNMENT_TITLE_LENGTH)
  title: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_INSTRUCTIONS_LENGTH)
  instructions?: string | null;

  // Null means the activity has no due date
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Type(() => Date)
  @IsDate()
  dueAt?: Date | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ASSIGNMENT_EXERCISES)
  @IsUUID('all', { each: true })
  exerciseIds?: string[];
}

export class SubmitLabAttemptDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ASSIGNMENT_EXERCISES)
  @ValidateNested({ each: true })
  @Type(() => GivenAnswerDto)
  answers?: GivenAnswerDto[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  note?: string | null;
}
