import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import type { CommunityContext } from '../authz/community-context';
import { CommunityCtx } from '../authz/community-context.decorator';
import { RequirePermission } from '../authz/require-permission.decorator';
import { ChangeRoleDto } from './dto/change-role.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ListMembersQuery } from './dto/list-members.query';
import { MembersService } from './members.service';

/**
 * The matrix covers who may act ('member:invite' etc.); the target-aware
 * rules — last owner, moderator-vs-owner, self — live in
 * MembershipPolicyService, invoked by the service inside a locked transaction.
 */
@Controller('communities/:communityId/members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  // the member list is community content: public for PUBLIC communities,
  // 404-gated by the guard for private ones
  @Public()
  @RequirePermission('community:view')
  @Get()
  list(
    @CommunityCtx() ctx: CommunityContext,
    @Query() query: ListMembersQuery,
  ) {
    return this.members.list(ctx, query);
  }

  @RequirePermission('member:invite')
  @Post()
  invite(@CommunityCtx() ctx: CommunityContext, @Body() dto: InviteMemberDto) {
    return this.members.invite(ctx, dto);
  }

  @RequirePermission('member:remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':userId')
  async remove(
    @CurrentUser() actor: AuthenticatedUser,
    @CommunityCtx() ctx: CommunityContext,
    @Param('userId') targetUserId: string,
  ): Promise<void> {
    await this.members.remove(actor, ctx, targetUserId);
  }

  @RequirePermission('member:role:change')
  @Patch(':userId')
  changeRole(
    @CurrentUser() actor: AuthenticatedUser,
    @CommunityCtx() ctx: CommunityContext,
    @Param('userId') targetUserId: string,
    @Body() dto: ChangeRoleDto,
  ) {
    return this.members.changeRole(actor, ctx, targetUserId, dto);
  }
}
