import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { CommunityContext } from '../authz/community-context';
import { CommunityCtx } from '../authz/community-context.decorator';
import { RequirePermission } from '../authz/require-permission.decorator';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { ListCommunitiesQuery } from './dto/list-communities.query';
import { UpdateCommunityDto } from './dto/update-community.dto';

/**
 * Authorization posture, route by route:
 *  - create/list have no single community context, so the PermissionGuard
 *    does not apply; create needs only authentication, list scopes visibility
 *    in its WHERE clause.
 *  - everything else declares a matrix key and lets the guard decide,
 *    including the private -> 404 gate.
 */
@Controller('communities')
export class CommunitiesController {
  constructor(private readonly communities: CommunitiesService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCommunityDto,
  ) {
    return this.communities.create(user, dto);
  }

  @Public()
  @Get()
  list(@Req() req: Request, @Query() query: ListCommunitiesQuery) {
    // req.user is set when a valid cookie accompanied this public request
    return this.communities.list(req.user, query);
  }

  @Public()
  @RequirePermission('community:view')
  @Get(':slug')
  get(@CommunityCtx() ctx: CommunityContext) {
    return this.communities.get(ctx);
  }

  @RequirePermission('community:update')
  @Patch(':communityId')
  update(
    @CommunityCtx() ctx: CommunityContext,
    @Body() dto: UpdateCommunityDto,
  ) {
    return this.communities.update(ctx, dto);
  }

  @RequirePermission('community:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':communityId')
  async remove(@CommunityCtx() ctx: CommunityContext): Promise<void> {
    await this.communities.delete(ctx);
  }

  // 'community:view' resolves context and applies the private->404 gate; the
  // absence of @Public() makes authentication mandatory. Joining a private
  // community is therefore impossible for outsiders — it does not exist.
  @RequirePermission('community:view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':communityId/join')
  async join(
    @CurrentUser() user: AuthenticatedUser,
    @CommunityCtx() ctx: CommunityContext,
  ): Promise<void> {
    await this.communities.join(user, ctx);
  }

  @RequirePermission('community:view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':communityId/leave')
  async leave(@CommunityCtx() ctx: CommunityContext): Promise<void> {
    await this.communities.leave(ctx);
  }
}
