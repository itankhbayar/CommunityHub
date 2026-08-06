import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CommunityContext } from '../authz/community-context';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsQuery } from './dto/list-events.query';
import { RsvpDto } from './dto/rsvp.dto';
import { UpdateEventDto } from './dto/update-event.dto';

const EVENT_SELECT = {
  id: true,
  title: true,
  description: true,
  location: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  createdAt: true,
  createdBy: { select: { id: true, displayName: true } },
  // filtered relation count: GOING only, computed in the same query
  _count: { select: { rsvps: { where: { status: 'GOING' } } } },
} satisfies Prisma.EventSelect;

type EventRow = Prisma.EventGetPayload<{ select: typeof EVENT_SELECT }>;

export interface EventView {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: Date;
  endsAt: Date | null;
  /** null = unlimited */
  capacity: number | null;
  goingCount: number;
  /** the caller's RSVP, or null */
  myStatus: string | null;
  createdBy: { id: string; displayName: string };
  createdAt: Date;
  /** lets the standalone event page link back and resolve role context */
  community: { id: string; slug: string; name: string };
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    user: AuthenticatedUser,
    ctx: CommunityContext,
    dto: CreateEventDto,
  ): Promise<EventView> {
    const { startsAt, endsAt } = parseWindow(dto.startsAt, dto.endsAt);

    const event = await this.prisma.event.create({
      data: {
        communityId: ctx.community.id,
        createdById: user.id,
        title: dto.title,
        description: dto.description ?? null,
        location: dto.location ?? null,
        startsAt,
        endsAt,
        capacity: dto.capacity ?? null,
      },
      select: EVENT_SELECT,
    });

    return toView(event, null, summaryOf(ctx));
  }

  async list(
    user: AuthenticatedUser | undefined,
    ctx: CommunityContext,
    query: ListEventsQuery,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { communityId: ctx.community.id };

    const [total, rows] = await Promise.all([
      this.prisma.event.count({ where }),
      this.prisma.event.findMany({
        where,
        select: EVENT_SELECT,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // caller's own RSVPs for the page, batched — same no-N+1 rule as the feed
    const myStatuses = user
      ? new Map(
          (
            await this.prisma.eventRsvp.findMany({
              where: {
                userId: user.id,
                eventId: { in: rows.map((r) => r.id) },
              },
              select: { eventId: true, status: true },
            })
          ).map((r) => [r.eventId, r.status]),
        )
      : new Map<string, string>();

    return {
      items: rows.map((row) =>
        toView(row, myStatuses.get(row.id) ?? null, summaryOf(ctx)),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async get(
    user: AuthenticatedUser | undefined,
    ctx: CommunityContext,
  ): Promise<EventView> {
    const eventId = ctx.resource!.id;

    const [event, mine] = await Promise.all([
      this.prisma.event.findUniqueOrThrow({
        where: { id: eventId },
        select: EVENT_SELECT,
      }),
      user
        ? this.prisma.eventRsvp.findUnique({
            where: { eventId_userId: { eventId, userId: user.id } },
            select: { status: true },
          })
        : Promise.resolve(null),
    ]);

    return toView(event, mine?.status ?? null, summaryOf(ctx));
  }

  async update(ctx: CommunityContext, dto: UpdateEventDto): Promise<EventView> {
    const eventId = ctx.resource!.id;

    const current = await this.prisma.event.findUniqueOrThrow({
      where: { id: eventId },
      select: { startsAt: true, endsAt: true },
    });

    // validate the merged time window, not just the patched fields
    const { startsAt, endsAt } = parseWindow(
      dto.startsAt ?? current.startsAt.toISOString(),
      dto.endsAt === undefined
        ? (current.endsAt?.toISOString() ?? undefined)
        : dto.endsAt,
    );

    // Lowering capacity below the current GOING count is allowed and does not
    // evict anyone: existing attendees keep their seat, and new GOING RSVPs
    // stay blocked until attrition brings the count back under the cap. The
    // single UPDATE naturally queues behind any in-flight RSVP transaction
    // holding the row lock, so the two paths cannot interleave.
    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.location !== undefined ? { location: dto.location } : {}),
        ...(dto.startsAt !== undefined ? { startsAt } : {}),
        ...(dto.endsAt !== undefined ? { endsAt } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
      },
      select: EVENT_SELECT,
    });

    return toView(event, null, summaryOf(ctx));
  }

  async delete(ctx: CommunityContext): Promise<void> {
    await this.prisma.event.delete({ where: { id: ctx.resource!.id } });
  }

  /**
   * The race-safe capacity check.
   *
   * Counting GOING rows and then inserting cannot be made safe by locking the
   * rows that were counted — the competing write is an INSERT of a row that
   * did not exist at count time (a phantom). Locking the parent event row
   * with SELECT ... FOR UPDATE instead makes every RSVP writer for THIS event
   * mutually exclusive for the whole read-count-write sequence, while RSVPs
   * for other events proceed untouched. The UNIQUE(eventId, userId)
   * constraint remains as the backstop for the one-rsvp-per-user invariant.
   *
   * Idempotent: GOING -> GOING consumes nothing new; GOING -> NOT_GOING frees
   * a seat inside the same lock; NULL capacity skips counting entirely.
   */
  async rsvp(
    user: AuthenticatedUser,
    ctx: CommunityContext,
    dto: RsvpDto,
  ): Promise<{ status: string; goingCount: number }> {
    const eventId = ctx.resource!.id;

    return this.prisma.$transaction(
      async (tx) => {
        // serialize all concurrent RSVP writers for this event
        const [event] = await tx.$queryRaw<
          { id: string; capacity: number | null }[]
        >`SELECT id, capacity FROM "Event" WHERE id = ${eventId}::uuid FOR UPDATE`;

        if (!event) {
          // deleted between guard resolution and here
          throw new NotFoundException('Not found.');
        }

        const existing = await tx.eventRsvp.findUnique({
          where: { eventId_userId: { eventId, userId: user.id } },
          select: { status: true },
        });

        const takesSeat =
          dto.status === 'GOING' &&
          existing?.status !== 'GOING' &&
          event.capacity !== null;

        if (takesSeat) {
          const going = await tx.eventRsvp.count({
            where: { eventId, status: 'GOING' },
          });
          if (going >= event.capacity!) {
            throw new ConflictException('This event is full.');
          }
        }

        await tx.eventRsvp.upsert({
          where: { eventId_userId: { eventId, userId: user.id } },
          create: { eventId, userId: user.id, status: dto.status },
          update: { status: dto.status },
        });

        const goingCount = await tx.eventRsvp.count({
          where: { eventId, status: 'GOING' },
        });

        return { status: dto.status, goingCount };
      },
      // generous ceiling: under contention, writers queue on the row lock
      { timeout: 15_000 },
    );
  }

  /** GOING attendees, for the event page. */
  async attendees(ctx: CommunityContext, query: ListEventsQuery) {
    const eventId = ctx.resource!.id;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { eventId, status: 'GOING' as const };

    const [total, rows] = await Promise.all([
      this.prisma.eventRsvp.count({ where }),
      this.prisma.eventRsvp.findMany({
        where,
        select: {
          userId: true,
          createdAt: true,
          user: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: rows.map((row) => ({
        userId: row.userId,
        displayName: row.user.displayName,
        rsvpedAt: row.createdAt,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}

function summaryOf(ctx: CommunityContext): {
  id: string;
  slug: string;
  name: string;
} {
  return {
    id: ctx.community.id,
    slug: ctx.community.slug,
    name: ctx.community.name,
  };
}

function toView(
  row: EventRow,
  myStatus: string | null,
  community: { id: string; slug: string; name: string },
): EventView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    location: row.location,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    capacity: row.capacity,
    goingCount: row._count.rsvps,
    myStatus,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    community,
  };
}

function parseWindow(
  startsAtIso: string,
  endsAtIso: string | undefined,
): { startsAt: Date; endsAt: Date | null } {
  const startsAt = new Date(startsAtIso);
  const endsAt = endsAtIso !== undefined ? new Date(endsAtIso) : null;

  if (endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    throw new BadRequestException('endsAt must be after startsAt.');
  }

  return { startsAt, endsAt };
}
