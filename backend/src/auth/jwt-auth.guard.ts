import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ACCESS_COOKIE } from './cookies';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { TokenService } from './token.service';

/**
 * Establishes *who* the caller is. It deliberately says nothing about what
 * they may do — that is the PermissionGuard's job.
 *
 * The user record is re-read from the database on every request rather than
 * trusted from the token, so a deleted account or a changed PLATFORM_ADMIN
 * flag takes effect immediately instead of at token expiry.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      // Public routes still resolve the caller when a token is present, so
      // that a listing can show "you are a member" without forcing a login.
      if (isPublic) return true;
      throw new UnauthorizedException('You need to be signed in.');
    }

    let userId: string;
    try {
      userId = this.tokens.verifyAccessToken(token).sub;
    } catch (error) {
      if (isPublic) return true;
      throw error;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, globalRole: true },
    });

    if (!user) {
      if (isPublic) return true;
      throw new UnauthorizedException('Your session is no longer valid.');
    }

    request.user = user;
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const cookies = request.cookies as Record<string, string> | undefined;
    return cookies?.[ACCESS_COOKIE];
  }
}
