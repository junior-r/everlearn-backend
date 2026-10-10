import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import type { AuthUserView } from '../../application/auth-session.js';

// bcrypt ignores everything past 72 bytes, so longer passwords are rejected instead of silently truncated
const PASSWORD_MAX_LENGTH = 72;

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PASSWORD_MAX_LENGTH)
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUserView;
}
