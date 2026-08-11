import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDatabase, TestApp } from './utils/app';

const PASSWORD = 'correct-horse-battery';

interface CommunityBody {
  id: string;
  slug: string;
  name: string;
  visibility: string;
  memberCount: number;
  callerRole: string | null;
}

interface ListBody {
  items: CommunityBody[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

describe('Communities (e2e)', () => {
  let ctx: TestApp;
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const agents = new Map<string, ReturnType<typeof request.agent>>();
  const userIds = new Map<string, string>();

  async function persona(name: string) {
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
    return agent;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    await resetDatabase(prisma);

    for (const name of ['owner', 'moderator', 'member', 'outsider', 'admin']) {
      await persona(name);
    }
    await prisma.user.update({
      where: { id: userIds.get('admin')! },
      data: { globalRole: 'PLATFORM_ADMIN' },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('create', () => {
    it('creates a community and makes the creator OWNER', async () => {
      const res = await agents
        .get('owner')!
        .post('/communities')
        .send({ name: 'Trail Runners', description: 'Weekend long runs' })
        .expect(201);

      const body = res.body as CommunityBody;
      expect(body.slug).toBe('trail-runners');
      expect(body.callerRole).toBe('OWNER');
      expect(body.memberCount).toBe(1);

      const membership = await prisma.membership.findUniqueOrThrow({
        where: {
          userId_communityId: {
            userId: userIds.get('owner')!,
            communityId: body.id,
          },
        },
      });
      expect(membership.role).toBe('OWNER');
    });

    it('resolves slug collisions with a numeric suffix', async () => {
      const res = await agents
        .get('member')!
        .post('/communities')
        .send({ name: 'Trail Runners' })
        .expect(201);

      expect((res.body as CommunityBody).slug).toBe('trail-runners-2');
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/communities')
        .send({ name: 'Nope' })
        .expect(401);
    });

    it('rejects unknown fields and bad names', async () => {
      await agents
        .get('owner')!
        .post('/communities')
        .send({ name: 'Valid Name', ownerId: 'sneaky' })
        .expect(400);
      await agents
        .get('owner')!
        .post('/communities')
        .send({ name: 'ab' })
        .expect(400);
    });
  });

  describe('permission matrix on update/delete', () => {
    let communityId: string;

    beforeAll(async () => {
      const res = await agents
        .get('owner')!
        .post('/communities')
        .send({ name: 'Governance Test' })
        .expect(201);
      communityId = (res.body as CommunityBody).id;

      // moderator + member join, then get their roles set directly
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
    });

    it('MODERATOR cannot update settings (403)', async () => {
      await agents
        .get('moderator')!
        .patch(`/communities/${communityId}`)
        .send({ description: 'mod was here' })
        .expect(403);
    });

    it('MEMBER cannot update settings (403)', async () => {
      await agents
        .get('member')!
        .patch(`/communities/${communityId}`)
        .send({ description: 'member was here' })
        .expect(403);
    });

    it('OWNER updates settings (200)', async () => {
      const res = await agents
        .get('owner')!
        .patch(`/communities/${communityId}`)
        .send({ description: 'owner-approved' })
        .expect(200);
      expect((res.body as { description: string }).description).toBe(
        'owner-approved',
      );
    });

    it('PLATFORM_ADMIN updates settings without membership (200)', async () => {
      await agents
        .get('admin')!
        .patch(`/communities/${communityId}`)
        .send({ description: 'admin-approved' })
        .expect(200);
    });

    it('MODERATOR cannot delete the community (403)', async () => {
      await agents
        .get('moderator')!
        .delete(`/communities/${communityId}`)
        .expect(403);
    });

    it('OWNER deletes the community (204) and the cascade cleans up', async () => {
      await agents
        .get('owner')!
        .delete(`/communities/${communityId}`)
        .expect(204);

      expect(await prisma.membership.count({ where: { communityId } })).toBe(0);
      await agents
        .get('owner')!
        .get('/communities/governance-test')
        .expect(404);
    });
  });

  describe('visibility', () => {
    let privateSlug: string;
    let privateId: string;

    beforeAll(async () => {
      const res = await agents
        .get('owner')!
        .post('/communities')
        .send({ name: 'Secret Society', visibility: 'PRIVATE' })
        .expect(201);
      privateSlug = (res.body as CommunityBody).slug;
      privateId = (res.body as CommunityBody).id;

      await prisma.membership.create({
        data: {
          userId: userIds.get('member')!,
          communityId: privateId,
          role: 'MEMBER',
        },
      });
    });

    it('non-member GET private -> 404 (never 403)', async () => {
      await agents
        .get('outsider')!
        .get(`/communities/${privateSlug}`)
        .expect(404);
    });

    it('anonymous GET private -> 404', async () => {
      await request(app.getHttpServer())
        .get(`/communities/${privateSlug}`)
        .expect(404);
    });

    it('member GET private -> 200', async () => {
      const res = await agents
        .get('member')!
        .get(`/communities/${privateSlug}`)
        .expect(200);
      expect((res.body as CommunityBody).callerRole).toBe('MEMBER');
    });

    it('platform admin GET private -> 200 without membership', async () => {
      await agents.get('admin')!.get(`/communities/${privateSlug}`).expect(200);
    });

    it('anonymous GET public -> 200 with callerRole null', async () => {
      const res = await request(app.getHttpServer())
        .get('/communities/trail-runners')
        .expect(200);
      expect((res.body as CommunityBody).callerRole).toBeNull();
    });

    it('listing hides private communities from outsiders and guests', async () => {
      const anonymous = await request(app.getHttpServer())
        .get('/communities')
        .expect(200);
      const anonSlugs = (anonymous.body as ListBody).items.map((i) => i.slug);
      expect(anonSlugs).not.toContain(privateSlug);

      const outsider = await agents
        .get('outsider')!
        .get('/communities')
        .expect(200);
      const outsiderSlugs = (outsider.body as ListBody).items.map(
        (i) => i.slug,
      );
      expect(outsiderSlugs).not.toContain(privateSlug);
    });

    it('listing shows members their private communities, with role', async () => {
      const res = await agents.get('member')!.get('/communities').expect(200);
      const body = res.body as ListBody;
      const secret = body.items.find((i) => i.slug === privateSlug);
      expect(secret).toBeDefined();
      expect(secret!.callerRole).toBe('MEMBER');
    });

    it('platform admin lists everything', async () => {
      const res = await agents.get('admin')!.get('/communities').expect(200);
      expect((res.body as ListBody).items.map((i) => i.slug)).toContain(
        privateSlug,
      );
    });

    it('flipping a community to PRIVATE hides it mid-session', async () => {
      const created = await agents
        .get('owner')!
        .post('/communities')
        .send({ name: 'Soon Hidden' })
        .expect(201);
      const slug = (created.body as CommunityBody).slug;

      await agents.get('outsider')!.get(`/communities/${slug}`).expect(200);

      await agents
        .get('owner')!
        .patch(`/communities/${(created.body as CommunityBody).id}`)
        .send({ visibility: 'PRIVATE' })
        .expect(200);

      // same outsider cookie, next request: gone
      await agents.get('outsider')!.get(`/communities/${slug}`).expect(404);
    });
  });

  describe('list pagination and search', () => {
    it('search filters by name, case-insensitively', async () => {
      const res = await request(app.getHttpServer())
        .get('/communities')
        .query({ search: 'trail' })
        .expect(200);

      const body = res.body as ListBody;
      expect(body.items.length).toBeGreaterThanOrEqual(2);
      for (const item of body.items) {
        expect(item.name.toLowerCase()).toContain('trail');
      }
    });

    it('paginates with metadata', async () => {
      const res = await request(app.getHttpServer())
        .get('/communities')
        .query({ page: 1, limit: 2 })
        .expect(200);

      const body = res.body as ListBody;
      expect(body.items.length).toBeLessThanOrEqual(2);
      expect(body.meta).toMatchObject({ page: 1, limit: 2 });
      expect(body.meta.total).toBeGreaterThanOrEqual(body.items.length);
    });

    it('rejects out-of-range limits', async () => {
      await request(app.getHttpServer())
        .get('/communities')
        .query({ limit: 500 })
        .expect(400);
    });
  });

  // The three sorts behind the home page's filter. Fixtures share a name
  // prefix so every assertion can scope itself with ?search= and stay immune
  // to the communities other describes leave behind in the shared database.
  describe('list sorting', () => {
    const ids = new Map<string, string>();

    async function makeCommunity(name: string, visibility = 'PUBLIC') {
      const res = await agents
        .get('owner')!
        .post('/communities')
        .send({ name, visibility })
        .expect(201);
      const body = res.body as CommunityBody;
      ids.set(name, body.id);
      return body.id;
    }

    async function addMembers(communityId: string, names: string[]) {
      for (const name of names) {
        await prisma.membership.create({
          data: { userId: userIds.get(name)!, communityId, role: 'MEMBER' },
        });
      }
    }

    async function addPosts(communityId: string, count: number) {
      for (let i = 0; i < count; i += 1) {
        await prisma.post.create({
          data: {
            communityId,
            authorId: userIds.get('owner')!,
            body: `activity ${i}`,
          },
        });
      }
    }

    async function slugsFor(sort: string, agent?: string) {
      const req = agent
        ? agents.get(agent)!.get('/communities')
        : request(app.getHttpServer()).get('/communities');
      const res = await req.query({ search: 'sortfix', sort }).expect(200);
      return (res.body as ListBody).items.map((i) => i.name);
    }

    beforeAll(async () => {
      // created oldest -> newest, which is the reverse of the `new` ordering
      const quiet = await makeCommunity('Sortfix Quiet');
      const busy = await makeCommunity('Sortfix Busy');
      const middling = await makeCommunity('Sortfix Middling');

      // popular: Quiet(3) > Middling(2) > Busy(1)
      await addMembers(quiet, ['member', 'moderator']);
      await addMembers(middling, ['member']);

      // active: Busy(3) > Middling(2) > Quiet(0)
      await addPosts(busy, 3);
      await addPosts(middling, 1);
      await prisma.event.create({
        data: {
          communityId: middling,
          createdById: userIds.get('owner')!,
          title: 'Sortfix meetup',
          startsAt: new Date(Date.now() + 86_400_000),
        },
      });
    });

    it('defaults to newest first when no sort is given', async () => {
      expect(await slugsFor('new')).toEqual([
        'Sortfix Middling',
        'Sortfix Busy',
        'Sortfix Quiet',
      ]);

      const res = await request(app.getHttpServer())
        .get('/communities')
        .query({ search: 'sortfix' })
        .expect(200);
      expect((res.body as ListBody).items.map((i) => i.name)).toEqual([
        'Sortfix Middling',
        'Sortfix Busy',
        'Sortfix Quiet',
      ]);
    });

    it('popular orders by member count, most members first', async () => {
      expect(await slugsFor('popular')).toEqual([
        'Sortfix Quiet',
        'Sortfix Middling',
        'Sortfix Busy',
      ]);
    });

    it('active counts recent posts and events, busiest first', async () => {
      expect(await slugsFor('active')).toEqual([
        'Sortfix Busy',
        'Sortfix Middling',
        'Sortfix Quiet',
      ]);
    });

    it('active ranks silent communities last rather than dropping them', async () => {
      // Quiet has no posts and no events at all, and must still be returned —
      // the sort reorders the set, it never filters it
      const names = await slugsFor('active');
      expect(names).toContain('Sortfix Quiet');
      expect(names).toHaveLength(3);
    });

    it('activity older than the window does not count', async () => {
      const stale = await makeCommunity('Sortfix Stale');
      await prisma.post.create({
        data: {
          communityId: stale,
          authorId: userIds.get('owner')!,
          body: 'ancient history',
          // 60 days old, well outside the 30-day window
          createdAt: new Date(Date.now() - 60 * 86_400_000),
        },
      });

      const names = await slugsFor('active');
      // ranked below every community with recent activity, despite having a post
      expect(names.indexOf('Sortfix Stale')).toBeGreaterThan(
        names.indexOf('Sortfix Middling'),
      );

      await prisma.community.delete({ where: { id: stale } });
    });

    it('a private community never enters the ranking for an outsider', async () => {
      const secret = await makeCommunity('Sortfix Hidden', 'PRIVATE');
      // busier than anything public, so a leak would put it first
      await addPosts(secret, 10);

      expect(await slugsFor('active')).not.toContain('Sortfix Hidden');
      expect(await slugsFor('active', 'outsider')).not.toContain(
        'Sortfix Hidden',
      );
      expect(await slugsFor('popular', 'outsider')).not.toContain(
        'Sortfix Hidden',
      );

      // ...but its own owner still sees it ranked first
      expect((await slugsFor('active', 'owner'))[0]).toBe('Sortfix Hidden');

      await prisma.community.delete({ where: { id: secret } });
    });

    it('paginates a sorted list without repeating or skipping rows', async () => {
      const all = await slugsFor('active');

      const pages: string[] = [];
      for (const page of [1, 2, 3]) {
        const res = await request(app.getHttpServer())
          .get('/communities')
          .query({ search: 'sortfix', sort: 'active', page, limit: 1 })
          .expect(200);
        pages.push(...(res.body as ListBody).items.map((i) => i.name));
      }

      expect(pages).toEqual(all);
    });

    it('rejects an unknown sort', async () => {
      await request(app.getHttpServer())
        .get('/communities')
        .query({ sort: 'trending' })
        .expect(400);
    });
  });

  describe('join and leave', () => {
    let communityId: string;

    beforeAll(async () => {
      const res = await agents
        .get('owner')!
        .post('/communities')
        .send({ name: 'Joiners Club' })
        .expect(201);
      communityId = (res.body as CommunityBody).id;
    });

    it('outsider joins a public community as MEMBER', async () => {
      await agents
        .get('outsider')!
        .post(`/communities/${communityId}/join`)
        .expect(204);

      const membership = await prisma.membership.findUniqueOrThrow({
        where: {
          userId_communityId: {
            userId: userIds.get('outsider')!,
            communityId,
          },
        },
      });
      expect(membership.role).toBe('MEMBER');
    });

    it('joining twice is a 409', async () => {
      await agents
        .get('outsider')!
        .post(`/communities/${communityId}/join`)
        .expect(409);
    });

    it('anonymous join is 401', async () => {
      await request(app.getHttpServer())
        .post(`/communities/${communityId}/join`)
        .expect(401);
    });

    it('joining a private community you cannot see is 404', async () => {
      const secret = await prisma.community.findUniqueOrThrow({
        where: { slug: 'secret-society' },
        select: { id: true },
      });
      await agents
        .get('outsider')!
        .post(`/communities/${secret.id}/join`)
        .expect(404);
    });

    it('a member leaves cleanly', async () => {
      await agents
        .get('outsider')!
        .post(`/communities/${communityId}/leave`)
        .expect(204);

      expect(
        await prisma.membership.findUnique({
          where: {
            userId_communityId: {
              userId: userIds.get('outsider')!,
              communityId,
            },
          },
        }),
      ).toBeNull();
    });

    it('leaving without being a member is a 409', async () => {
      await agents
        .get('outsider')!
        .post(`/communities/${communityId}/leave`)
        .expect(409);
    });

    it('the last OWNER cannot leave (rule 1)', async () => {
      const res = await agents
        .get('owner')!
        .post(`/communities/${communityId}/leave`)
        .expect(409);
      expect((res.body as { message: string }).message).toMatch(
        /at least one owner/i,
      );

      // still owner, community intact
      const membership = await prisma.membership.findUnique({
        where: {
          userId_communityId: {
            userId: userIds.get('owner')!,
            communityId,
          },
        },
      });
      expect(membership?.role).toBe('OWNER');
    });

    it('an OWNER can leave once another OWNER exists', async () => {
      // promote member to co-owner directly (role-change endpoint is phase 5)
      await agents
        .get('member')!
        .post(`/communities/${communityId}/join`)
        .expect(204);
      await prisma.membership.update({
        where: {
          userId_communityId: {
            userId: userIds.get('member')!,
            communityId,
          },
        },
        data: { role: 'OWNER' },
      });

      await agents
        .get('owner')!
        .post(`/communities/${communityId}/leave`)
        .expect(204);
    });
  });
});
