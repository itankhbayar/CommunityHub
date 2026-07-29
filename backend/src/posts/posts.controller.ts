import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
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
import { CreatePostDto } from './dto/create-post.dto';
import { FeedQuery } from './dto/feed.query';
import { UpdatePostDto } from './dto/update-post.dto';
import { PostsService } from './posts.service';

/**
 * Feed + create live under the community; single-post mutations address the
 * post directly and let the resolver derive its community. The paired
 * {any, own} declarations are the entire own-vs-any story — no authorship
 * check appears anywhere in the service.
 */
@Controller()
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  @Public()
  @RequirePermission('community:view')
  @Get('communities/:communityId/posts')
  feed(
    @Req() req: Request,
    @CommunityCtx() ctx: CommunityContext,
    @Query() query: FeedQuery,
  ) {
    // req.user is present whenever a valid cookie came along, even here on a
    // public route — likedByMe/isMine stay correct for any signed-in viewer
    return this.posts.feed(req.user, ctx, query);
  }

  @RequirePermission('post:create')
  @Post('communities/:communityId/posts')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CommunityCtx() ctx: CommunityContext,
    @Body() dto: CreatePostDto,
  ) {
    return this.posts.create(user, ctx, dto);
  }

  @RequirePermission({
    any: 'post:edit:any',
    own: 'post:edit:own',
    ownerField: 'authorId',
  })
  @Patch('posts/:postId')
  update(@CommunityCtx() ctx: CommunityContext, @Body() dto: UpdatePostDto) {
    return this.posts.update(ctx, dto);
  }

  @RequirePermission({
    any: 'post:delete:any',
    own: 'post:delete:own',
    ownerField: 'authorId',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('posts/:postId')
  async remove(@CommunityCtx() ctx: CommunityContext): Promise<void> {
    await this.posts.delete(ctx);
  }

  // PUT/DELETE pair, both idempotent: what an optimistic UI wants to retry
  @RequirePermission('post:like')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Put('posts/:postId/like')
  async like(
    @CurrentUser() user: AuthenticatedUser,
    @CommunityCtx() ctx: CommunityContext,
  ): Promise<void> {
    await this.posts.like(user, ctx);
  }

  @RequirePermission('post:like')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('posts/:postId/like')
  async unlike(
    @CurrentUser() user: AuthenticatedUser,
    @CommunityCtx() ctx: CommunityContext,
  ): Promise<void> {
    await this.posts.unlike(user, ctx);
  }
}
