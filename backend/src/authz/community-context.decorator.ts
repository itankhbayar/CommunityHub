import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';
import { CommunityContext } from './community-context';

/**
 * Hands a handler the context the PermissionGuard already resolved — community,
 * fresh membership, actor role, and (for :postId/:eventId routes) the resource
 * row. Using it means the service layer does not re-query what the guard just
 * loaded.
 *
 * Only meaningful on routes that declare @RequirePermission; anywhere else the
 * guard never ran, so this throws instead of silently yielding undefined.
 */
export const CommunityCtx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CommunityContext => {
    const request = ctx.switchToHttp().getRequest<Request>();

    if (!request.communityContext) {
      throw new InternalServerErrorException(
        '@CommunityCtx() used on a route without @RequirePermission',
      );
    }

    return request.communityContext;
  },
);
