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
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
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
