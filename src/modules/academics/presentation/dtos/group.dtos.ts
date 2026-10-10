import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreatePeriodDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @Matches(ISO_DATE)
  startDate: string;

  @Matches(ISO_DATE)
  endDate: string;
}

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name: string;

  @IsInt()
  @Min(1)
  @Max(20)
  level: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  capacity?: number;

  @IsUUID()
  pensumId: string;

  @IsUUID()
  periodId: string;
}

export class AssignTeacherDto {
  // null clears the assignment; anything else must be a membership id
  @ValidateIf((dto: AssignTeacherDto) => dto.teacherMembershipId !== null)
  @IsUUID()
  teacherMembershipId: string | null;
}

export class EnrollStudentDto {
  @IsUUID()
  membershipId: string;
}
