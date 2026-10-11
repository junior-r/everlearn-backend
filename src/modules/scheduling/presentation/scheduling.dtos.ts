import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DayOfWeek } from '../domain/schedule.js';

const MINUTES_PER_DAY = 1440;

export class TimeRangeDto {
  @IsIn(Object.values(DayOfWeek))
  dayOfWeek: DayOfWeek;

  @IsInt()
  @Min(0)
  @Max(MINUTES_PER_DAY)
  startMinute: number;

  @IsInt()
  @Min(0)
  @Max(MINUTES_PER_DAY)
  endMinute: number;
}

export class SetAvailabilityDto {
  @IsUUID()
  periodId: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TimeRangeDto)
  windows: TimeRangeDto[];
}

export class AvailabilityQueryDto {
  @IsUUID()
  periodId: string;
}

export class ScheduleCourseDto extends TimeRangeDto {
  @IsUUID()
  subjectId: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  room?: string;
}
