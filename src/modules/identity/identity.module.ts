import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ACCESS_TOKEN_VERIFIER } from '../../shared/domain/auth/access-token-verifier.js';
import { JwtAuthGuard } from '../../shared/presentation/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../shared/presentation/guards/roles.guard.js';
import { SessionIssuer } from './application/services/session-issuer.js';
import { GetCurrentUserUseCase } from './application/use-cases/get-current-user.use-case.js';
import { LoginWithGoogleUseCase } from './application/use-cases/login-with-google.use-case.js';
import { LogoutUseCase } from './application/use-cases/logout.use-case.js';
import { LoginWithPasswordUseCase } from './application/use-cases/login-with-password.use-case.js';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case.js';
import { RegisterUserUseCase } from './application/use-cases/register-user.use-case.js';
import { StartGoogleLoginUseCase } from './application/use-cases/start-google-login.use-case.js';
import {
  GOOGLE_OAUTH_GATEWAY,
  type GoogleOAuthGateway,
} from './domain/ports/google-oauth.gateway.js';
import { PASSWORD_HASHER, type PasswordHasher } from './domain/ports/password-hasher.js';
import {
  REFRESH_TOKEN_REVOCATIONS,
  type RefreshTokenRevocations,
} from './domain/ports/refresh-token-revocations.js';
import { TOKEN_ISSUER, type TokenIssuer } from './domain/ports/token-issuer.js';
import { USER_REPOSITORY, type UserRepository } from './domain/ports/user.repository.js';
import { GoogleAuthLibraryGateway } from './infrastructure/google/google-oauth.gateway.js';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.repository.js';
import { BcryptPasswordHasher } from './infrastructure/security/bcrypt-password-hasher.js';
import { JwtTokenService } from './infrastructure/security/jwt-token.service.js';
import { RedisRefreshTokenRevocations } from './infrastructure/security/redis-refresh-token-revocations.js';
import { AuthController } from './presentation/controllers/auth.controller.js';

/**
 * Composition root of the identity module: binds each domain port to its
 * infrastructure adapter and builds the framework-free use cases.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    JwtTokenService,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
    { provide: GOOGLE_OAUTH_GATEWAY, useClass: GoogleAuthLibraryGateway },
    { provide: REFRESH_TOKEN_REVOCATIONS, useClass: RedisRefreshTokenRevocations },
    { provide: TOKEN_ISSUER, useExisting: JwtTokenService },
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: JwtTokenService },
    {
      provide: SessionIssuer,
      useFactory: (users: UserRepository, tokens: TokenIssuer) => new SessionIssuer(users, tokens),
      inject: [USER_REPOSITORY, TOKEN_ISSUER],
    },
    {
      provide: RegisterUserUseCase,
      useFactory: (users: UserRepository, hasher: PasswordHasher, sessions: SessionIssuer) =>
        new RegisterUserUseCase(users, hasher, sessions),
      inject: [USER_REPOSITORY, PASSWORD_HASHER, SessionIssuer],
    },
    {
      provide: LoginWithPasswordUseCase,
      useFactory: (users: UserRepository, hasher: PasswordHasher, sessions: SessionIssuer) =>
        new LoginWithPasswordUseCase(users, hasher, sessions),
      inject: [USER_REPOSITORY, PASSWORD_HASHER, SessionIssuer],
    },
    {
      provide: RefreshSessionUseCase,
      useFactory: (
        users: UserRepository,
        tokens: TokenIssuer,
        revocations: RefreshTokenRevocations,
        sessions: SessionIssuer,
      ) => new RefreshSessionUseCase(users, tokens, revocations, sessions),
      inject: [USER_REPOSITORY, TOKEN_ISSUER, REFRESH_TOKEN_REVOCATIONS, SessionIssuer],
    },
    {
      provide: LogoutUseCase,
      useFactory: (tokens: TokenIssuer, revocations: RefreshTokenRevocations) =>
        new LogoutUseCase(tokens, revocations),
      inject: [TOKEN_ISSUER, REFRESH_TOKEN_REVOCATIONS],
    },
    {
      provide: StartGoogleLoginUseCase,
      useFactory: (google: GoogleOAuthGateway) => new StartGoogleLoginUseCase(google),
      inject: [GOOGLE_OAUTH_GATEWAY],
    },
    {
      provide: LoginWithGoogleUseCase,
      useFactory: (users: UserRepository, google: GoogleOAuthGateway, sessions: SessionIssuer) =>
        new LoginWithGoogleUseCase(users, google, sessions),
      inject: [USER_REPOSITORY, GOOGLE_OAUTH_GATEWAY, SessionIssuer],
    },
    {
      provide: GetCurrentUserUseCase,
      useFactory: (users: UserRepository, sessions: SessionIssuer) =>
        new GetCurrentUserUseCase(users, sessions),
      inject: [USER_REPOSITORY, SessionIssuer],
    },
    // Order matters: authentication must populate request.user before roles are checked
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class IdentityModule {}
