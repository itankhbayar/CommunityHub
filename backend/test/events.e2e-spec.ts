import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { TokenService } from '../src/auth/token.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDatabase, TestApp } from './utils/app';

const PASSWORD = 'correct-horse-battery';

interface EventBody {
  id: string;
  title: string;
  capacity: number | null;
  goingCount: number;
  myStatus: string | null;
  createdBy: { displayName: string };
}

interface RsvpResult {
  status: string;
  goingCount: number;
}

describe('Events (e2e)', () => {
  let ctx: TestApp;
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;

  const agents = new Map<string, ReturnType<typeof request.agent>>();
  const userIds = new Map<string, string>();

  let communityId: string;
  let privateCommunityId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    tokens = app.get(TokenService);
    await resetDatabase(prisma);

    for (const name of ['owner', 'moderator', 'member', 'outsider']) {
      const agent = request.agent(app.getHttpServer());
      const res = await agent
        .post('/auth/register')
        .send({
          email: `${name}@example.com`,
          password: PASSWORD,
          displayName: name,
        })
        .expect(201);
      agents.set(name, agent);
      userIds.set(name, (res.body as { user: { id: string } }).user.id);
    }

    const pub = await agents
      .get('owner')!
      .post('/communities')
      .send({ name: 'Event Horizon' })
      .expect(201);
    communityId = (pub.body as { id: string }).id;

    await agents
      .get('moderator')!
      .post(`/communities/${communityId}/join`)
      .expect(204);
    await agents
      .get('member')!
      .post(`/communities/${communityId}/join`)
      .expect(204);
    await prisma.membership.update({
      where: {
        userId_communityId: {
          userId: userIds.get('moderator')!,
          communityId,
        },
      },
      data: { role: 'MODERATOR' },
    });

    const priv = await agents
      .get('owner')!
      .post('/communities')
      .send({ name: 'Private Events', visibility: 'PRIVATE' })
      .expect(201);
    privateCommunityId = (priv.body as { id: string }).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  const createEvent = async (
    payload: Record<string, unknown>,
    who = 'moderator',
  ): Promise<EventBody> => {
    const res = await agents
      .get(who)!
      .post(`/communities/${communityId}/events`)
      .send({
        title: 'Test Event',
        startsAt: '2026-09-01T18:00:00.000Z',
        ...payload,
      })
      .expect(201);
    return res.body as EventBody;
  };

  describe('event management permissions', () => {
    it('MEMBER cannot create an event (403)', async () => {
      await agents
        .get('member')!
        .post(`/communities/${communityId}/events`)
        .send({ title: 'Member Meetup', startsAt: '2026-09-01T18:00:00.000Z' })
        .expect(403);
    });

    it('MODERATOR creates, edits, and deletes an event', async () => {
      const event = await createEvent({ title: 'Mod Meetup' });

      const updated = await agents
        .get('moderator')!
        .patch(`/events/${event.id}`)
        .send({ title: 'Mod Meetup (moved)' })
        .expect(200);
      expect((updated.body as EventBody).title).toBe('Mod Meetup (moved)');

      await agents.get('moderator')!.delete(`/events/${event.id}`).expect(204);
    });

    it('MEMBER cannot edit or delete an event (403)', async () => {
      const event = await createEvent({ title: 'Untouchable' });
      await agents
        .get('member')!
        .patch(`/events/${event.id}`)
        .send({ title: 'renamed' })
        .expect(403);
      await agents.get('member')!.delete(`/events/${event.id}`).expect(403);
    });

    it('rejects an event window that ends before it starts', async () => {
      await agents
        .get('moderator')!
        .post(`/communities/${communityId}/events`)
        .send({
          title: 'Time Traveler',
          startsAt: '2026-09-01T18:00:00.000Z',
          endsAt: '2026-09-01T17:00:00.000Z',
        })
        .expect(400);
    });

    it('lists events with pagination metadata and myStatus', async () => {
      const event = await createEvent({ title: 'Listed Event' });
      await agents
        .get('member')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(200);

      const res = await agents
        .get('member')!
        .get(`/communities/${communityId}/events`)
        .expect(200);

      const body = res.body as { items: EventBody[]; meta: { total: number } };
      expect(body.meta.total).toBeGreaterThanOrEqual(1);
      const listed = body.items.find((e) => e.id === event.id)!;
      expect(listed.myStatus).toBe('GOING');
      expect(listed.goingCount).toBe(1);
    });

    it('private community events 404 for outsiders', async () => {
      const res = await agents
        .get('owner')!
        .post(`/communities/${privateCommunityId}/events`)
        .send({ title: 'Secret Gala', startsAt: '2026-09-01T18:00:00.000Z' })
        .expect(201);

      const eventId = (res.body as EventBody).id;
      await agents.get('outsider')!.get(`/events/${eventId}`).expect(404);
      await agents
        .get('outsider')!
        .put(`/events/${eventId}/rsvp`)
        .send({ status: 'GOING' })
        .expect(404);
    });
  });

  describe('rsvp basics', () => {
    it('member RSVPs GOING, flips to NOT_GOING, count follows', async () => {
      const event = await createEvent({ title: 'Flip Flop', capacity: 10 });

      const going = await agents
        .get('member')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(200);
      expect(going.body as RsvpResult).toEqual({
        status: 'GOING',
        goingCount: 1,
      });

      const notGoing = await agents
        .get('member')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'NOT_GOING' })
        .expect(200);
      expect(notGoing.body as RsvpResult).toEqual({
        status: 'NOT_GOING',
        goingCount: 0,
      });
    });

    it('repeating GOING is idempotent — one row, one seat', async () => {
      const event = await createEvent({
        title: 'Again And Again',
        capacity: 2,
      });

      await agents
        .get('member')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(200);
      const second = await agents
        .get('member')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(200);

      expect((second.body as RsvpResult).goingCount).toBe(1);
      expect(
        await prisma.eventRsvp.count({ where: { eventId: event.id } }),
      ).toBe(1);
    });

    it('WAITLIST cannot be set by clients (400)', async () => {
      const event = await createEvent({ title: 'No Waitlist Yet' });
      await agents
        .get('member')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'WAITLIST' })
        .expect(400);
    });

    it('outsider cannot RSVP (403); anonymous is 401', async () => {
      const event = await createEvent({ title: 'Members Only' });
      await agents
        .get('outsider')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(403);
      await request(app.getHttpServer())
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(401);
    });

    it('unlimited capacity never fills', async () => {
      const event = await createEvent({ title: 'Infinite Room' }); // no capacity
      for (const who of ['owner', 'moderator', 'member']) {
        await agents
          .get(who)!
          .put(`/events/${event.id}/rsvp`)
          .send({ status: 'GOING' })
          .expect(200);
      }
      const detail = await agents
        .get('member')!
        .get(`/events/${event.id}`)
        .expect(200);
      expect((detail.body as EventBody).goingCount).toBe(3);
    });

    it('a full event answers 409, and a freed seat can be retaken', async () => {
      const event = await createEvent({ title: 'One Seat', capacity: 1 });

      await agents
        .get('member')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(200);

      // full for the next person
      const refused = await agents
        .get('moderator')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(409);
      expect((refused.body as { message: string }).message).toMatch(/full/i);

      // ...but an existing attendee flipping to GOING again is fine
      await agents
        .get('member')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(200);

      // seat freed -> retaken
      await agents
        .get('member')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'NOT_GOING' })
        .expect(200);
      await agents
        .get('moderator')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(200);
    });

    it('attendee list shows GOING users with pagination', async () => {
      const event = await createEvent({ title: 'Roll Call' });
      await agents
        .get('member')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'GOING' })
        .expect(200);
      await agents
        .get('owner')!
        .put(`/events/${event.id}/rsvp`)
        .send({ status: 'NOT_GOING' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/events/${event.id}/rsvps`)
        .expect(200);

      const body = res.body as {
        items: { displayName: string }[];
        meta: { total: number };
      };
      expect(body.meta.total).toBe(1);
      expect(body.items[0].displayName).toBe('member');
    });
  });

  describe('capacity under concurrency — the race test', () => {
    it('50 simultaneous RSVPs against capacity 5 admit exactly 5', async () => {
      // Fifty members created directly (argon2-ing 50 registrations proves
      // nothing about RSVPs); their sessions are real signed access cookies.
      const crowd = Array.from({ length: 50 }, (_, i) => ({
        id: randomUUID(),
        email: `racer${i}@example.com`,
        passwordHash: 'x',
        displayName: `racer${i}`,
      }));
      await prisma.user.createMany({ data: crowd });
      await prisma.membership.createMany({
        data: crowd.map((u) => ({
          userId: u.id,
          communityId,
          role: 'MEMBER' as const,
        })),
      });

      const event = await createEvent({ title: 'The Stampede', capacity: 5 });

      const results = await Promise.all(
        crowd.map((u) =>
          request(app.getHttpServer())
            .put(`/events/${event.id}/rsvp`)
            .set('Cookie', `ch_access=${tokens.signAccessToken(u.id)}`)
            .send({ status: 'GOING' }),
        ),
      );

      const byStatus = results.reduce<Record<number, number>>((acc, res) => {
        acc[res.status] = (acc[res.status] ?? 0) + 1;
        return acc;
      }, {});

      expect(byStatus[200] ?? 0).toBe(5);
      expect(byStatus[409] ?? 0).toBe(45);

      // the database agrees with the responses
      const going = await prisma.eventRsvp.count({
        where: { eventId: event.id, status: 'GOING' },
      });
      expect(going).toBe(5);

      // and nobody got double-booked
      const total = await prisma.eventRsvp.count({
        where: { eventId: event.id },
      });
      expect(total).toBe(5); // only successful writers left a row
    }, 60_000);

    it('concurrent flips between GOING and NOT_GOING never exceed capacity', async () => {
      const event = await createEvent({ title: 'Churn', capacity: 3 });

      const crowd = await prisma.user.findMany({
        where: { email: { startsWith: 'racer' } },
        select: { id: true },
        take: 20,
      });

      // everyone hammers the endpoint alternating GOING / NOT_GOING
      const waves = 3;
      for (let wave = 0; wave < waves; wave += 1) {
        await Promise.all(
          crowd.map((u, i) =>
            request(app.getHttpServer())
              .put(`/events/${event.id}/rsvp`)
              .set('Cookie', `ch_access=${tokens.signAccessToken(u.id)}`)
              .send({ status: (i + wave) % 2 === 0 ? 'GOING' : 'NOT_GOING' }),
          ),
        );

        const going = await prisma.eventRsvp.count({
          where: { eventId: event.id, status: 'GOING' },
        });
        expect(going).toBeLessThanOrEqual(3);
      }
    }, 60_000);
  });
});
