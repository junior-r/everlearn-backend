import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { RESET_LOCALES, type ResetLocale } from '../../application/use-cases/password-reset.use-cases.js';
import type { AuthUserView } from '../../application/auth-session.js';

// bcrypt ignores everything past 72 bytes, so longer passwords are rejected instead of silently truncated
const PASSWORD_MAX_LENGTH = 72;
const PASSWORD_MIN_LENGTH = 8;

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  currentPassword: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  // The language of the screen the reset link opens; Spanish when left out
  @IsOptional()
  @IsIn(RESET_LOCALES)
  locale?: ResetLocale;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  token: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(PASSWORD_MAX_LENGTH)
  newPassword: string;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUserView;
}
