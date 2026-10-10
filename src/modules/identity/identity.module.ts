import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ACCESS_TOKEN_VERIFIER } from '../../shared/domain/auth/access-token-verifier.js';
import { useCaseProvider } from '../../shared/infrastructure/nest/use-case.provider.js';
import { JwtAuthGuard } from '../../shared/presentation/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../shared/presentation/guards/roles.guard.js';
import { SessionIssuer } from './application/services/session-issuer.js';
import { EnsurePlatformAdminUseCase } from './application/use-cases/ensure-platform-admin.use-case.js';
import { GetCurrentUserUseCase } from './application/use-cases/get-current-user.use-case.js';
import { LoginWithGoogleUseCase } from './application/use-cases/login-with-google.use-case.js';
import { LoginWithPasswordUseCase } from './application/use-cases/login-with-password.use-case.js';
import { LogoutUseCase } from './application/use-cases/logout.use-case.js';
import {
  ListMembersUseCase,
  RegisterMemberUseCase,
} from './application/use-cases/member.use-cases.js';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case.js';
import { StartGoogleLoginUseCase } from './application/use-cases/start-google-login.use-case.js';
import { GOOGLE_OAUTH_GATEWAY } from './domain/ports/google-oauth.gateway.js';
import {
  MEMBER_REPOSITORY,
  type MemberRepository,
} from './domain/ports/member.repository.js';
import { PASSWORD_HASHER, type PasswordHasher } from './domain/ports/password-hasher.js';
import { REFRESH_TOKEN_REVOCATIONS } from './domain/ports/refresh-token-revocations.js';
import { TOKEN_ISSUER } from './domain/ports/token-issuer.js';
import { USER_REPOSITORY, type UserRepository } from './domain/ports/user.repository.js';
import { GoogleAuthLibraryGateway } from './infrastructure/google/google-oauth.gateway.js';
import { PlatformAdminBootstrap } from './infrastructure/platform-admin.bootstrap.js';
import { PrismaMemberRepository } from './infrastructure/repositories/prisma-member.repository.js';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.repository.js';
import { BcryptPasswordHasher } from './infrastructure/security/bcrypt-password-hasher.js';
import { JwtTokenService } from './infrastructure/security/jwt-token.service.js';
import { RedisRefreshTokenRevocations } from './infrastructure/security/redis-refresh-token-revocations.js';
import { AuthController } from './presentation/controllers/auth.controller.js';
import { MembersController } from './presentation/controllers/members.controller.js';

/**
 * Composition root of the identity module: binds each domain port to its
 * infrastructure adapter and builds the framework-free use cases.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, MembersController],
  providers: [
    JwtTokenService,
    PlatformAdminBootstrap,
    { provide: USER_REPOSITORY, useClass: PrismaUserRepository },
    { provide: MEMBER_REPOSITORY, useClass: PrismaMemberRepository },
    { provide: PASSWORD_HASHER, useClass: BcryptPasswordHasher },
    { provide: GOOGLE_OAUTH_GATEWAY, useClass: GoogleAuthLibraryGateway },
    { provide: REFRESH_TOKEN_REVOCATIONS, useClass: RedisRefreshTokenRevocations },
    { provide: TOKEN_ISSUER, useExisting: JwtTokenService },
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: JwtTokenService },
    useCaseProvider(SessionIssuer, [USER_REPOSITORY, TOKEN_ISSUER]),
    useCaseProvider(LoginWithPasswordUseCase, [USER_REPOSITORY, PASSWORD_HASHER, SessionIssuer]),
    useCaseProvider(RefreshSessionUseCase, [
      USER_REPOSITORY,
      TOKEN_ISSUER,
      REFRESH_TOKEN_REVOCATIONS,
      SessionIssuer,
    ]),
    useCaseProvider(LogoutUseCase, [TOKEN_ISSUER, REFRESH_TOKEN_REVOCATIONS]),
    useCaseProvider(StartGoogleLoginUseCase, [GOOGLE_OAUTH_GATEWAY]),
    useCaseProvider(LoginWithGoogleUseCase, [USER_REPOSITORY, GOOGLE_OAUTH_GATEWAY, SessionIssuer]),
    useCaseProvider(GetCurrentUserUseCase, [USER_REPOSITORY, SessionIssuer]),
    useCaseProvider(EnsurePlatformAdminUseCase, [USER_REPOSITORY, PASSWORD_HASHER]),
    useCaseProvider(ListMembersUseCase, [MEMBER_REPOSITORY]),
    {
      // Built by hand because its last constructor argument (the password generator) keeps its default
      provide: RegisterMemberUseCase,
      useFactory: (members: MemberRepository, users: UserRepository, hasher: PasswordHasher) =>
        new RegisterMemberUseCase(members, users, hasher),
      inject: [MEMBER_REPOSITORY, USER_REPOSITORY, PASSWORD_HASHER],
    },
    // Order matters: authentication must populate request.user before roles are checked
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class IdentityModule {}
