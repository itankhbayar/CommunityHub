import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth.types';

/**
 * The authenticated caller. Only valid on routes the JwtAuthGuard protects —
 * on a @Public() route it throws rather than handing back undefined, because
 * a silently-undefined user is how authorization bugs start.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();

    if (!request.user) {
      throw new InternalServerErrorException(
        '@CurrentUser() used on a route that is not authenticated',
      );
    }

    return request.user;
  },
);
