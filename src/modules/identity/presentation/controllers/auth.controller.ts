import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../../../../config/app-config.js';
import type { AuthenticatedUser } from '../../../../shared/domain/auth/authenticated-user.js';
import { DomainException } from '../../../../shared/domain/domain.exception.js';
import { CurrentUser, Public } from '../../../../shared/presentation/decorators/auth.decorators.js';
import {
  RateLimit,
  RateLimitGuard,
} from '../../../../shared/presentation/guards/rate-limit.guard.js';
import type { AuthSession, AuthUserView } from '../../application/auth-session.js';
import { GetCurrentUserUseCase } from '../../application/use-cases/get-current-user.use-case.js';
import { LoginWithGoogleUseCase } from '../../application/use-cases/login-with-google.use-case.js';
import { LogoutUseCase } from '../../application/use-cases/logout.use-case.js';
import { LoginWithPasswordUseCase } from '../../application/use-cases/login-with-password.use-case.js';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case.js';
import { RegisterUserUseCase } from '../../application/use-cases/register-user.use-case.js';
import { StartGoogleLoginUseCase } from '../../application/use-cases/start-google-login.use-case.js';
import { AuthCookies } from '../auth-cookies.js';
import { LoginDto, RegisterDto, type AuthResponse } from '../dtos/auth.dtos.js';

@Controller('auth')
export class AuthController {
  private readonly cookies: AuthCookies;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RegisterUserUseCase) private readonly registerUser: RegisterUserUseCase,
    @Inject(LoginWithPasswordUseCase) private readonly loginWithPassword: LoginWithPasswordUseCase,
    @Inject(RefreshSessionUseCase) private readonly refreshSession: RefreshSessionUseCase,
    @Inject(LogoutUseCase) private readonly logoutSession: LogoutUseCase,
    @Inject(StartGoogleLoginUseCase) private readonly startGoogleLogin: StartGoogleLoginUseCase,
    @Inject(LoginWithGoogleUseCase) private readonly loginWithGoogle: LoginWithGoogleUseCase,
    @Inject(GetCurrentUserUseCase) private readonly getCurrentUser: GetCurrentUserUseCase,
  ) {
    this.cookies = new AuthCookies(config);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'auth-register' })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.respondWith(await this.registerUser.execute(dto), response);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'auth-login', bodyField: 'email' })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.respondWith(await this.loginWithPassword.execute(dto), response);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request): Promise<AuthResponse> {
    const session = await this.refreshSession.execute(this.cookies.readRefreshToken(request));
    return { accessToken: session.accessToken, user: session.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    // Clear the cookie first, so the browser is signed out even if revocation fails
    this.cookies.clearRefreshToken(response);
    await this.logoutSession.execute(this.cookies.readRefreshToken(request));
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUserView> {
    return this.getCurrentUser.execute(user.userId);
  }

  @Public()
  @Get('google')
  google(@Res() response: Response): void {
    try {
      const { url, state } = this.startGoogleLogin.execute();
      this.cookies.setOAuthState(response, state);
      response.redirect(url);
    } catch (error) {
      this.redirectToLoginWithError(response, error);
    }
  }

  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const expectedState = this.cookies.readOAuthState(request);
    this.cookies.clearOAuthState(response);
    try {
      const session = await this.loginWithGoogle.execute({ code, state, expectedState });
      this.cookies.setRefreshToken(response, session.refreshToken);
      // The browser only carries the httpOnly cookie; the SPA trades it for an access token on arrival
      response.redirect(`${this.config.frontendUrl}/auth/callback`);
    } catch (error) {
      this.redirectToLoginWithError(response, error);
    }
  }

  private respondWith(session: AuthSession, response: Response): AuthResponse {
    this.cookies.setRefreshToken(response, session.refreshToken);
    return { accessToken: session.accessToken, user: session.user };
  }

  // These routes are reached by browser navigation, so failures go back to the login page instead of returning JSON
  private redirectToLoginWithError(response: Response, error: unknown): void {
    if (!(error instanceof DomainException)) {
      throw error;
    }
    response.redirect(`${this.config.frontendUrl}/login?error=${error.code}`);
  }
}
