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
import {
  AllowDuringPasswordChange,
  CurrentUser,
  Public,
} from '../../../../shared/presentation/decorators/auth.decorators.js';
import {
  RateLimit,
  RateLimitGuard,
} from '../../../../shared/presentation/guards/rate-limit.guard.js';
import type { AuthSession, AuthUserView } from '../../application/auth-session.js';
import {
  ChangePasswordUseCase,
  CompleteGoogleLinkUseCase,
  StartGoogleLinkUseCase,
} from '../../application/use-cases/account-security.use-cases.js';
import { GetCurrentUserUseCase } from '../../application/use-cases/get-current-user.use-case.js';
import { LoginWithGoogleUseCase } from '../../application/use-cases/login-with-google.use-case.js';
import { LoginWithPasswordUseCase } from '../../application/use-cases/login-with-password.use-case.js';
import { LogoutUseCase } from '../../application/use-cases/logout.use-case.js';
import {
  RequestPasswordResetUseCase,
  ResetPasswordUseCase,
} from '../../application/use-cases/password-reset.use-cases.js';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case.js';
import { StartGoogleLoginUseCase } from '../../application/use-cases/start-google-login.use-case.js';
import { AuthCookies } from '../auth-cookies.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  type AuthResponse,
} from '../dtos/auth.dtos.js';

@Controller('auth')
export class AuthController {
  private readonly cookies: AuthCookies;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LoginWithPasswordUseCase) private readonly loginWithPassword: LoginWithPasswordUseCase,
    @Inject(RefreshSessionUseCase) private readonly refreshSession: RefreshSessionUseCase,
    @Inject(LogoutUseCase) private readonly logoutSession: LogoutUseCase,
    @Inject(StartGoogleLoginUseCase) private readonly startGoogleLogin: StartGoogleLoginUseCase,
    @Inject(LoginWithGoogleUseCase) private readonly loginWithGoogle: LoginWithGoogleUseCase,
    @Inject(GetCurrentUserUseCase) private readonly getCurrentUser: GetCurrentUserUseCase,
    @Inject(ChangePasswordUseCase) private readonly changeUserPassword: ChangePasswordUseCase,
    @Inject(RequestPasswordResetUseCase) private readonly requestPasswordReset: RequestPasswordResetUseCase,
    @Inject(ResetPasswordUseCase) private readonly resetUserPassword: ResetPasswordUseCase,
    @Inject(StartGoogleLinkUseCase) private readonly startGoogleLink: StartGoogleLinkUseCase,
    @Inject(CompleteGoogleLinkUseCase)
    private readonly completeGoogleLink: CompleteGoogleLinkUseCase,
  ) {
    this.cookies = new AuthCookies(config);
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

  /** Always answers the same way, whether or not the address belongs to an account. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'auth-forgot-password', bodyField: 'email' })
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.requestPasswordReset.execute(dto.email, dto.locale);
  }

  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'auth-reset-password' })
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.resetUserPassword.execute(dto.token, dto.newPassword);
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
  @AllowDuringPasswordChange()
  me(@CurrentUser() user: AuthenticatedUser): Promise<AuthUserView> {
    return this.getCurrentUser.execute(user.userId);
  }

  @Post('change-password')
  @AllowDuringPasswordChange()
  // Limited like sign-in, since it also checks a password
  @UseGuards(RateLimitGuard)
  @RateLimit({ scope: 'auth-change-password' })
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<AuthResponse> {
    return this.changeUserPassword.execute({
      userId: user.userId,
      currentPassword: dto.currentPassword,
      newPassword: dto.newPassword,
    });
  }

  @Public()
  @Get('google')
  google(@Res() response: Response): void {
    try {
      const { url, state } = this.startGoogleLogin.execute();
      this.cookies.setOAuthState(response, state);
      response.redirect(url);
    } catch (error) {
      this.redirectWithError(response, '/login', error);
    }
  }

  /**
   * Starts linking Google to the signed-in account. Called with the access
   * token (a redirect could not carry it), so it returns the consent URL for
   * the browser to open instead of redirecting.
   */
  @Post('google/link')
  @HttpCode(HttpStatus.OK)
  async linkGoogle(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ url: string }> {
    const { url, ticket } = await this.startGoogleLink.execute(user.userId);
    this.cookies.setGoogleLinkTicket(response, ticket);
    return { url };
  }

  /** One redirect URI serves both flows; the cookie set when the flow started tells them apart. */
  @Public()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const ticket = this.cookies.readGoogleLinkTicket(request);
    const expectedState = this.cookies.readOAuthState(request);
    this.cookies.clearOAuthCookies(response);
    if (ticket) {
      await this.finishLink(response, { code, state, ticket });
      return;
    }
    try {
      const session = await this.loginWithGoogle.execute({ code, state, expectedState });
      this.cookies.setRefreshToken(response, session.refreshToken);
      // The browser only carries the httpOnly cookie; the SPA trades it for an access token on arrival
      response.redirect(`${this.config.frontendUrl}/auth/callback`);
    } catch (error) {
      this.redirectWithError(response, '/login', error);
    }
  }

  private async finishLink(
    response: Response,
    input: { code: string | undefined; state: string | undefined; ticket: string },
  ): Promise<void> {
    try {
      await this.completeGoogleLink.execute(input);
      response.redirect(`${this.config.frontendUrl}/settings?google=linked`);
    } catch (error) {
      this.redirectWithError(response, '/settings', error);
    }
  }

  private respondWith(session: AuthSession, response: Response): AuthResponse {
    this.cookies.setRefreshToken(response, session.refreshToken);
    return { accessToken: session.accessToken, user: session.user };
  }

  // These routes are reached by browser navigation, so failures go back to a page instead of returning JSON
  private redirectWithError(response: Response, path: string, error: unknown): void {
    if (!(error instanceof DomainException)) {
      throw error;
    }
    response.redirect(`${this.config.frontendUrl}${path}?error=${error.code}`);
  }
}
