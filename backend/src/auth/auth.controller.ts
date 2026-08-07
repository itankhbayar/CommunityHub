import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
// `import type` is required for types used in decorated signatures while
// isolatedModules + emitDecoratorMetadata are both on.
import type { Request, Response } from 'express';
import { Throttle } from '../common/throttle/throttle.decorator';
import { AuthService, AuthSession } from './auth.service';
import type { AuthenticatedUser } from './auth.types';
import {
  clearAuthCookies,
  REFRESH_COOKIE,
  setAccessCookie,
  setRefreshCookie,
} from './cookies';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(await this.auth.register(dto), res);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(await this.auth.login(dto), res);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = this.readRefreshCookie(req);
    if (!token) {
      throw new UnauthorizedException('Your session is no longer valid.');
    }

    return this.respondWithSession(await this.auth.refresh(token), res);
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    // Public and idempotent on purpose: logging out with an already-expired
    // access token must still clear the session rather than 401.
    await this.auth.logout(this.readRefreshCookie(req));
    clearAuthCookies(res);
  }

  // Authenticated on purpose (no @Public): knowing the current password is
  // what makes this safe without a mailed link, so an unlocked but stolen
  // session cannot lock the real owner out. The signed-out route is
  // /auth/forgot-password below.
  //
  // Throttled because each attempt is a guess at the current password, and an
  // unlimited guessing endpoint is a slow brute force.
  @Throttle({ limit: 10, windowMs: 15 * 60 * 1000 })
  @HttpCode(HttpStatus.OK)
  @Post('password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // responds with a fresh cookie pair — the change revoked the old one
    return this.respondWithSession(
      await this.auth.changePassword(user.id, dto),
      res,
    );
  }

  // 202 for every address, known or not. Anything that distinguishes them —
  // a 404, a different message, even a materially faster reply — is an
  // account-enumeration oracle. See AuthService.requestPasswordReset.
  //
  // The only public endpoint that mails an attacker-chosen address, so it is
  // the one that most needs a cap. This limits a single sender; the per-account
  // cooldown in VerificationTokenService.issue limits what any number of
  // senders can do to one inbox.
  @Throttle({ limit: 5, windowMs: 15 * 60 * 1000 })
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.requestPasswordReset(dto);
  }

  // Guessing a 32-byte token is not a realistic attack, but the endpoint is
  // public and writes to the database, so it gets a ceiling anyway. Set well
  // above what a person fumbling a link could ever need.
  @Throttle({ limit: 20, windowMs: 15 * 60 * 1000 })
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    // deliberately issues no session: proving control of an inbox is not
    // reason enough to sign this browser in, so the UI sends them to login
    await this.auth.resetPassword(dto);
  }

  // Public because the link is clicked from a mail client, which is routinely
  // a different device with no session. The token is the whole authorisation,
  // and that is proportionate: confirming an address grants no ability beyond
  // becoming eligible for password reset.
  @Throttle({ limit: 20, windowMs: 15 * 60 * 1000 })
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.auth.verifyEmail(dto);
  }

  // Authenticated and takes no address — it always mails the caller's own,
  // which is what keeps this from being a second open relay alongside
  // forgot-password. 202 whether or not anything was sent: the account may
  // already be verified, or inside the per-account cooldown.
  @Throttle({ limit: 5, windowMs: 15 * 60 * 1000 })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('verify-email/resend')
  async resendVerification(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.auth.resendVerification(user.id);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user.id);
  }

  private respondWithSession(session: AuthSession, res: Response) {
    setAccessCookie(res, session.accessToken, this.tokens.accessTokenTtlMs);
    setRefreshCookie(res, session.refresh.token, session.refresh.expiresAt);

    // Tokens live in httpOnly cookies only — never in the response body,
    // where client JS could read and store them.
    return { user: session.user };
  }

  private readRefreshCookie(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, string> | undefined;
    return cookies?.[REFRESH_COOKIE];
  }
}
