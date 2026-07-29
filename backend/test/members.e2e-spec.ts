import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDatabase, TestApp } from './utils/app';

const PASSWORD = 'correct-horse-battery';

interface MemberBody {
  userId: string;
  displayName: string;
  role: string;
  joinedAt: string;
}

interface MemberListBody {
  items: MemberBody[];
  meta: { total: number };
}

describe('Members (e2e)', () => {
  let ctx: TestApp;
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const agents = new Map<string, ReturnType<typeof request.agent>>();
  const userIds = new Map<string, string>();

  let communityId: string;
  let privateCommunityId: string;

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
  }

  const setRole = (persona: string, cid: string, role: string) =>
    prisma.membership.update({
      where: {
        userId_communityId: { userId: userIds.get(persona)!, communityId: cid },
      },
      data: { role: role as never },
    });

  const roleOf = async (persona: string, cid: string) =>
    (
      await prisma.membership.findUnique({
        where: {
          userId_communityId: {
            userId: userIds.get(persona)!,
            communityId: cid,
          },
        },
      })
    )?.role;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
    await resetDatabase(prisma);

    for (const name of [
      'owner',
      'moderator',
      'member',
      'outsider',
      'admin',
      'loner',
    ]) {
      await persona(name);
    }
    await prisma.user.update({
      where: { id: userIds.get('admin')! },
      data: { globalRole: 'PLATFORM_ADMIN' },
    });

    const pub = await agents
      .get('owner')!
      .post('/communities')
      .send({ name: 'Member Governance' })
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
    await setRole('moderator', communityId, 'MODERATOR');

    const priv = await agents
      .get('owner')!
      .post('/communities')
      .send({ name: 'Private Governance', visibility: 'PRIVATE' })
      .expect(201);
    privateCommunityId = (priv.body as { id: string }).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('member list', () => {
    it('lists members with roles, owners first, no email addresses', async () => {
      const res = await request(app.getHttpServer())
        .get(`/communities/${communityId}/members`)
        .expect(200);

      const body = res.body as MemberListBody;
      expect(body.meta.total).toBe(3);
      expect(body.items[0].role).toBe('OWNER');
      expect(body.items.map((m) => m.role)).toEqual([
        'OWNER',
        'MODERATOR',
        'MEMBER',
      ]);
      expect(JSON.stringify(body)).not.toMatch(/@example\.com/);
    });

    it('private member list 404s for outsiders, works for members', async () => {
      await agents
        .get('outsider')!
        .get(`/communities/${privateCommunityId}/members`)
        .expect(404);
      await agents
        .get('owner')!
        .get(`/communities/${privateCommunityId}/members`)
        .expect(200);
    });
  });

  describe('invite', () => {
    it('MEMBER cannot invite (403)', async () => {
      await agents
        .get('member')!
        .post(`/communities/${communityId}/members`)
        .send({ email: 'loner@example.com' })
        .expect(403);
    });

    it('MODERATOR invites an existing account by email (201, joins as MEMBER)', async () => {
      const res = await agents
        .get('moderator')!
        .post(`/communities/${communityId}/members`)
        .send({ email: 'Loner@Example.com ' }) // case + whitespace normalized
        .expect(201);

      expect((res.body as MemberBody).role).toBe('MEMBER');
      expect(await roleOf('loner', communityId)).toBe('MEMBER');
    });

    it('inviting an unknown email is 404', async () => {
      await agents
        .get('moderator')!
        .post(`/communities/${communityId}/members`)
        .send({ email: 'ghost@example.com' })
        .expect(404);
    });

    it('inviting an existing member is 409', async () => {
      await agents
        .get('moderator')!
        .post(`/communities/${communityId}/members`)
        .send({ email: 'loner@example.com' })
        .expect(409);
    });

    it('outsiders cannot invite into a private community they cannot see (404)', async () => {
      await agents
        .get('outsider')!
        .post(`/communities/${privateCommunityId}/members`)
        .send({ email: 'loner@example.com' })
        .expect(404);
    });

    it('OWNER invites into a private community (201)', async () => {
      await agents
        .get('owner')!
        .post(`/communities/${privateCommunityId}/members`)
        .send({ email: 'member@example.com' })
        .expect(201);
    });
  });

  describe('remove', () => {
    it('MEMBER cannot remove anyone (403)', async () => {
      await agents
        .get('member')!
        .delete(`/communities/${communityId}/members/${userIds.get('loner')!}`)
        .expect(403);
    });

    it('MODERATOR removes a MEMBER (204)', async () => {
      await agents
        .get('moderator')!
        .delete(`/communities/${communityId}/members/${userIds.get('loner')!}`)
        .expect(204);
      expect(await roleOf('loner', communityId)).toBeUndefined();
    });

    it('MODERATOR cannot remove an OWNER — rule 2 (403)', async () => {
      await agents
        .get('moderator')!
        .delete(`/communities/${communityId}/members/${userIds.get('owner')!}`)
        .expect(403);
      expect(await roleOf('owner', communityId)).toBe('OWNER');
    });

    it('nobody removes themselves — leave exists for that (403)', async () => {
      await agents
        .get('moderator')!
        .delete(
          `/communities/${communityId}/members/${userIds.get('moderator')!}`,
        )
        .expect(403);
    });

    it('removing a non-member is 404', async () => {
      await agents
        .get('owner')!
        .delete(`/communities/${communityId}/members/${userIds.get('loner')!}`)
        .expect(404);
    });

    it('OWNER cannot be removed when they are the last owner — rule 1 (409)', async () => {
      // platform admin tries to remove the sole owner
      await agents
        .get('admin')!
        .delete(`/communities/${communityId}/members/${userIds.get('owner')!}`)
        .expect(409);
      expect(await roleOf('owner', communityId)).toBe('OWNER');
    });

    it('an OWNER can be removed once another owner exists', async () => {
      await setRole('moderator', communityId, 'OWNER');
      await agents
        .get('admin')!
        .delete(`/communities/${communityId}/members/${userIds.get('owner')!}`)
        .expect(204);

      // restore the original arrangement
      await prisma.membership.create({
        data: {
          userId: userIds.get('owner')!,
          communityId,
          role: 'OWNER',
        },
      });
      await setRole('moderator', communityId, 'MODERATOR');
    });
  });

  describe('change role', () => {
    it('MODERATOR cannot change roles at all (403)', async () => {
      await agents
        .get('moderator')!
        .patch(`/communities/${communityId}/members/${userIds.get('member')!}`)
        .send({ role: 'MODERATOR' })
        .expect(403);
    });

    it('MEMBER cannot change roles (403)', async () => {
      await agents
        .get('member')!
        .patch(
          `/communities/${communityId}/members/${userIds.get('moderator')!}`,
        )
        .send({ role: 'MEMBER' })
        .expect(403);
    });

    it('OWNER promotes a MEMBER to MODERATOR (200)', async () => {
      const res = await agents
        .get('owner')!
        .patch(`/communities/${communityId}/members/${userIds.get('member')!}`)
        .send({ role: 'MODERATOR' })
        .expect(200);

      expect((res.body as MemberBody).role).toBe('MODERATOR');
      expect(await roleOf('member', communityId)).toBe('MODERATOR');

      await setRole('member', communityId, 'MEMBER'); // restore
    });

    it('nobody changes their own role — rule 3, not even an OWNER (403)', async () => {
      await agents
        .get('owner')!
        .patch(`/communities/${communityId}/members/${userIds.get('owner')!}`)
        .send({ role: 'MEMBER' })
        .expect(403);
      expect(await roleOf('owner', communityId)).toBe('OWNER');
    });

    it('rule 3 binds PLATFORM_ADMIN too', async () => {
      // admin joins as a member, then tries to promote themselves
      await agents
        .get('admin')!
        .post(`/communities/${communityId}/join`)
        .expect(204);
      await agents
        .get('admin')!
        .patch(`/communities/${communityId}/members/${userIds.get('admin')!}`)
        .send({ role: 'OWNER' })
        .expect(403);
      expect(await roleOf('admin', communityId)).toBe('MEMBER');
    });

    it('the last OWNER cannot be demoted — rule 1 (409)', async () => {
      await agents
        .get('admin')!
        .patch(`/communities/${communityId}/members/${userIds.get('owner')!}`)
        .send({ role: 'MEMBER' })
        .expect(409);
      expect(await roleOf('owner', communityId)).toBe('OWNER');
    });

    it('demoting an OWNER works once another owner exists', async () => {
      await agents
        .get('owner')!
        .patch(
          `/communities/${communityId}/members/${userIds.get('moderator')!}`,
        )
        .send({ role: 'OWNER' })
        .expect(200);

      // now two owners; the new one demotes the founder
      await agents
        .get('moderator')!
        .patch(`/communities/${communityId}/members/${userIds.get('owner')!}`)
        .send({ role: 'MEMBER' })
        .expect(200);

      expect(await roleOf('owner', communityId)).toBe('MEMBER');

      // the demotion is effective immediately: the ex-owner can no longer
      // change roles with the same cookie
      await agents
        .get('owner')!
        .patch(
          `/communities/${communityId}/members/${userIds.get('moderator')!}`,
        )
        .send({ role: 'MEMBER' })
        .expect(403);

      // restore
      await setRole('owner', communityId, 'OWNER');
      await setRole('moderator', communityId, 'MODERATOR');
    });

    it('no-op role change is 409', async () => {
      await agents
        .get('owner')!
        .patch(`/communities/${communityId}/members/${userIds.get('member')!}`)
        .send({ role: 'MEMBER' })
        .expect(409);
    });

    it('changing the role of a non-member is 404', async () => {
      await agents
        .get('owner')!
        .patch(`/communities/${communityId}/members/${userIds.get('loner')!}`)
        .send({ role: 'MODERATOR' })
        .expect(404);
    });

    it('rejects an invalid role value (400)', async () => {
      await agents
        .get('owner')!
        .patch(`/communities/${communityId}/members/${userIds.get('member')!}`)
        .send({ role: 'SUPREME_LEADER' })
        .expect(400);
    });
  });

  describe('scoping', () => {
    it('an OWNER of community A has no member powers in community B', async () => {
      // 'loner' creates their own community — OWNER there
      const res = await agents
        .get('loner')!
        .post('/communities')
        .send({ name: 'Loners Palace' })
        .expect(201);
      const lonersCommunityId = (res.body as { id: string }).id;

      // owner-of-A cannot invite into B (not even a member there)
      await agents
        .get('owner')!
        .post(`/communities/${lonersCommunityId}/members`)
        .send({ email: 'member@example.com' })
        .expect(403);

      // and loner, OWNER of B, cannot change roles in A
      await agents
        .get('loner')!
        .patch(`/communities/${communityId}/members/${userIds.get('member')!}`)
        .send({ role: 'MODERATOR' })
        .expect(403);
    });
  });
});
