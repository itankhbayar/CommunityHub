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

  // Authenticated on purpose (no @Public): there is no email delivery in this
  // build, so proving you know the current password is the only ownership
  // check available. A signed-out "forgot password" flow cannot be made safe
  // here and is therefore absent rather than fake.
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
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    await this.auth.requestPasswordReset(dto);
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    // deliberately issues no session: proving control of an inbox is not
    // reason enough to sign this browser in, so the UI sends them to login
    await this.auth.resetPassword(dto);
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
