import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Role } from '../../../../shared/domain/auth/role.js';

export class RegisterMemberDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsIn(Object.values(Role))
  role: Role;
}

export class SearchMembersDto {
  @IsIn(Object.values(Role))
  role: Role;

  @IsString()
  @MaxLength(100)
  query: string;
}

export class PageMembersDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @IsOptional()
  @IsIn(Object.values(Role))
  role?: Role;
}
