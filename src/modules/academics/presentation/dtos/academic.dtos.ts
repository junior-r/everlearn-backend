import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class CreateSubjectDto {
  @Matches(CODE)
  @MaxLength(30)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateSubjectDto {
  @IsOptional()
  @Matches(CODE)
  @MaxLength(30)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class CreatePensumDto {
  @Matches(CODE)
  @MaxLength(30)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  version?: number;
}

export class UpdatePensumDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PlaceSubjectDto {
  @IsInt()
  @Min(1)
  @Max(20)
  level: number;

  @IsInt()
  @Min(1)
  @Max(60)
  weeklyHours: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  credits?: number;
}
