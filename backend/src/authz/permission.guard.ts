import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { CommunityContext } from './community-context';
import { CommunityContextResolver } from './community-context.resolver';
import { effectiveRole } from './effective-role';
import { isAllowed } from './permissions';
import {
  OwnAwarePermission,
  PERMISSION_KEY,
  PermissionRequirement,
} from './require-permission.decorator';

declare module 'express' {
  interface Request {
    communityContext?: CommunityContext;
  }
}

/**
 * Decides whether the authenticated (or anonymous) caller may perform the
 * declared action in the community the route addresses.
 *
 * Runs after JwtAuthGuard. Routes without @RequirePermission pass through —
 * they are not community-scoped.
 *
 * Decision order matters and is load-bearing:
 *
 *  1. Resolve the route's community (and resource). Nothing there -> 404.
 *  2. Load the caller's membership FROM THE DATABASE. Role claims never come
 *     from the token, so a demotion applies on the next request (rule 4).
 *  3. Visibility gate: a private community must look nonexistent to outsiders,
 *     so a NON_MEMBER gets 404 here — before any permission logic that could
 *     leak a 403 and confirm existence.
 *  4. Matrix check. For {any, own} requirements, `any` is tried first and
 *     `own` applies only when the caller authored the resolved resource.
 *  5. Anything still denied is a plain 403: the caller may know the community
 *     exists; they simply may not do this.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: CommunityContextResolver,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<
      PermissionRequirement | undefined
    >(PERMISSION_KEY, [context.getHandler(), context.getClass()]);

    if (requirement === undefined) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const { community, resource } = await this.resolver.resolve(
      request.params as Record<string, string>,
    );

    const user = request.user;

    const membership = user
      ? await this.prisma.membership.findUnique({
          where: {
            userId_communityId: {
              userId: user.id,
              communityId: community.id,
            },
          },
          select: { id: true, role: true, userId: true },
        })
      : null;

    const actorRole = effectiveRole(user?.globalRole, membership?.role);

    if (community.visibility === 'PRIVATE' && actorRole === 'NON_MEMBER') {
      throw new NotFoundException('Not found.');
    }

    if (!this.evaluate(requirement, actorRole, resource, user?.id)) {
      throw new ForbiddenException("You don't have permission to do that.");
    }

    request.communityContext = { community, membership, actorRole, resource };
    return true;
  }

  private evaluate(
    requirement: PermissionRequirement,
    actorRole: ReturnType<typeof effectiveRole>,
    resource: { [key: string]: unknown } | undefined,
    userId: string | undefined,
  ): boolean {
    if (typeof requirement === 'string') {
      return isAllowed(actorRole, requirement);
    }

    const ownAware: OwnAwarePermission = requirement;

    if (isAllowed(actorRole, ownAware.any)) return true;

    if (!isAllowed(actorRole, ownAware.own)) return false;

    // `own` only helps if the caller actually authored the loaded resource
    return (
      userId !== undefined &&
      resource !== undefined &&
      resource[ownAware.ownerField] === userId
    );
  }
}
