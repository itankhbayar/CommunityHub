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
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsQuery } from './dto/list-events.query';
import { RsvpDto } from './dto/rsvp.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { EventsService } from './events.service';

/**
 * 'event:manage' covers create/edit/delete (one matrix row, mods and up);
 * 'event:rsvp' is any member. Reads ride 'community:view' like the feed.
 */
@Controller()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Public()
  @RequirePermission('community:view')
  @Get('communities/:communityId/events')
  list(
    @Req() req: Request,
    @CommunityCtx() ctx: CommunityContext,
    @Query() query: ListEventsQuery,
  ) {
    return this.events.list(req.user, ctx, query);
  }

  @RequirePermission('event:manage')
  @Post('communities/:communityId/events')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @CommunityCtx() ctx: CommunityContext,
    @Body() dto: CreateEventDto,
  ) {
    return this.events.create(user, ctx, dto);
  }

  @Public()
  @RequirePermission('community:view')
  @Get('events/:eventId')
  get(@Req() req: Request, @CommunityCtx() ctx: CommunityContext) {
    return this.events.get(req.user, ctx);
  }

  @RequirePermission('event:manage')
  @Patch('events/:eventId')
  update(@CommunityCtx() ctx: CommunityContext, @Body() dto: UpdateEventDto) {
    return this.events.update(ctx, dto);
  }

  @RequirePermission('event:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('events/:eventId')
  async remove(@CommunityCtx() ctx: CommunityContext): Promise<void> {
    await this.events.delete(ctx);
  }

  // PUT: setting your RSVP is idempotent state, not an append
  @RequirePermission('event:rsvp')
  @Put('events/:eventId/rsvp')
  rsvp(
    @CurrentUser() user: AuthenticatedUser,
    @CommunityCtx() ctx: CommunityContext,
    @Body() dto: RsvpDto,
  ) {
    return this.events.rsvp(user, ctx, dto);
  }

  @Public()
  @RequirePermission('community:view')
  @Get('events/:eventId/rsvps')
  attendees(
    @CommunityCtx() ctx: CommunityContext,
    @Query() query: ListEventsQuery,
  ) {
    return this.events.attendees(ctx, query);
  }
}
