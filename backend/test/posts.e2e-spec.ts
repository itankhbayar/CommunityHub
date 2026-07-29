import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, resetDatabase, TestApp } from './utils/app';

const PASSWORD = 'correct-horse-battery';

interface PostBody {
  id: string;
  body: string;
  likeCount: number;
  likedByMe: boolean;
  isMine: boolean;
  author: { id: string; displayName: string };
}

interface FeedBody {
  items: PostBody[];
  nextCursor: string | null;
}

describe('Posts (e2e)', () => {
  let ctx: TestApp;
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const agents = new Map<string, ReturnType<typeof request.agent>>();
  const userIds = new Map<string, string>();

  let communityId: string;
  let privateCommunityId: string;
  let privatePostId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    prisma = ctx.prisma;
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
      .send({ name: 'Posting Grounds' })
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
      .send({ name: 'Private Posting', visibility: 'PRIVATE' })
      .expect(201);
    privateCommunityId = (priv.body as { id: string }).id;
    const privPost = await agents
      .get('owner')!
      .post(`/communities/${privateCommunityId}/posts`)
      .send({ body: 'secret post' })
      .expect(201);
    privatePostId = (privPost.body as PostBody).id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('create', () => {
    it('member creates a post; response marks it theirs', async () => {
      const res = await agents
        .get('member')!
        .post(`/communities/${communityId}/posts`)
        .send({ body: 'First!' })
        .expect(201);

      const body = res.body as PostBody;
      expect(body.isMine).toBe(true);
      expect(body.author.displayName).toBe('member');
      expect(body.likeCount).toBe(0);
    });

    it('outsider cannot post (403 public / 404 private)', async () => {
      await agents
        .get('outsider')!
        .post(`/communities/${communityId}/posts`)
        .send({ body: 'let me in' })
        .expect(403);
      await agents
        .get('outsider')!
        .post(`/communities/${privateCommunityId}/posts`)
        .send({ body: 'let me in' })
        .expect(404);
    });

    it('validates the body', async () => {
      await agents
        .get('member')!
        .post(`/communities/${communityId}/posts`)
        .send({ body: '' })
        .expect(400);
      await agents
        .get('member')!
        .post(`/communities/${communityId}/posts`)
        .send({ body: 'ok', extra: 'field' })
        .expect(400);
    });
  });

  describe('feed', () => {
    beforeAll(async () => {
      // 30 posts from mixed authors, insertion order = chronological order
      for (let i = 1; i <= 30; i += 1) {
        const who =
          i % 3 === 0 ? 'owner' : i % 2 === 0 ? 'moderator' : 'member';
        await agents
          .get(who)!
          .post(`/communities/${communityId}/posts`)
          .send({ body: `post number ${i}` })
          .expect(201);
      }
    });

    it('pages newest-first with a working cursor and end-of-list', async () => {
      const first = await agents
        .get('member')!
        .get(`/communities/${communityId}/posts`)
        .query({ limit: 10 })
        .expect(200);

      const page1 = first.body as FeedBody;
      expect(page1.items).toHaveLength(10);
      expect(page1.items[0].body).toBe('post number 30');
      expect(page1.nextCursor).not.toBeNull();

      const second = await agents
        .get('member')!
        .get(`/communities/${communityId}/posts`)
        .query({ limit: 10, cursor: page1.nextCursor })
        .expect(200);

      const page2 = second.body as FeedBody;
      expect(page2.items[0].body).toBe('post number 20');

      // no overlap, no gap
      const ids1 = new Set(page1.items.map((p) => p.id));
      expect(page2.items.some((p) => ids1.has(p.id))).toBe(false);

      // walk to the end: nextCursor goes null exactly when items run out
      let cursor = page2.nextCursor;
      let seen = page1.items.length + page2.items.length;
      while (cursor !== null) {
        const res = await agents
          .get('member')!
          .get(`/communities/${communityId}/posts`)
          .query({ limit: 10, cursor })
          .expect(200);
        const page = res.body as FeedBody;
        seen += page.items.length;
        cursor = page.nextCursor;
      }
      // 30 numbered + "First!" from the create suite
      expect(seen).toBe(31);
    });

    it('feed includes authors without any per-row queries (10-post and 30-post pages cost the same)', async () => {
      const queries: string[] = [];
      const listener = (event: { query: string }) => {
        queries.push(event.query);
      };
      // log config guarantees query events; the generic default hides $on's type
      (
        prisma as unknown as {
          $on: (e: 'query', cb: (ev: { query: string }) => void) => void;
        }
      ).$on('query', listener);

      const count = async (limit: number) => {
        queries.length = 0;
        await agents
          .get('member')!
          .get(`/communities/${communityId}/posts`)
          .query({ limit })
          .expect(200);
        return queries.length;
      };

      const smallPage = await count(10);
      const largePage = await count(30);

      // identical query count regardless of page size = no N+1
      expect(largePage).toBe(smallPage);
      // and the whole request stays lean: auth + guard + page + likes
      expect(smallPage).toBeLessThanOrEqual(6);
    });

    it('anonymous viewers get the public feed with likedByMe/isMine false', async () => {
      const res = await request(app.getHttpServer())
        .get(`/communities/${communityId}/posts`)
        .query({ limit: 5 })
        .expect(200);

      const body = res.body as FeedBody;
      expect(body.items).toHaveLength(5);
      for (const item of body.items) {
        expect(item.likedByMe).toBe(false);
        expect(item.isMine).toBe(false);
      }
    });

    it('private feeds 404 for outsiders and guests', async () => {
      await agents
        .get('outsider')!
        .get(`/communities/${privateCommunityId}/posts`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/communities/${privateCommunityId}/posts`)
        .expect(404);
    });

    it('rejects a malformed cursor with 400, not a 500', async () => {
      await agents
        .get('member')!
        .get(`/communities/${communityId}/posts`)
        .query({ cursor: 'garbage!!' })
        .expect(400);
    });
  });

  describe('edit and delete — own vs any', () => {
    let memberPostId: string;

    beforeAll(async () => {
      const res = await agents
        .get('member')!
        .post(`/communities/${communityId}/posts`)
        .send({ body: 'member-owned post' })
        .expect(201);
      memberPostId = (res.body as PostBody).id;
    });

    it('author edits their own post', async () => {
      const res = await agents
        .get('member')!
        .patch(`/posts/${memberPostId}`)
        .send({ body: 'member-owned post (edited)' })
        .expect(200);
      expect((res.body as PostBody).body).toBe('member-owned post (edited)');
    });

    it("a plain member cannot edit someone else's post", async () => {
      const other = await agents
        .get('moderator')!
        .post(`/communities/${communityId}/posts`)
        .send({ body: 'mod post' })
        .expect(201);

      await agents
        .get('member')!
        .patch(`/posts/${(other.body as PostBody).id}`)
        .send({ body: 'hijacked' })
        .expect(403);
    });

    it("a moderator edits a member's post (post:edit:any)", async () => {
      await agents
        .get('moderator')!
        .patch(`/posts/${memberPostId}`)
        .send({ body: 'moderated content' })
        .expect(200);
    });

    it('an outsider gets 404 for posts in private communities', async () => {
      await agents
        .get('outsider')!
        .patch(`/posts/${privatePostId}`)
        .send({ body: 'sneaky' })
        .expect(404);
    });

    it('author deletes their own post; a member cannot delete others', async () => {
      const mine = await agents
        .get('member')!
        .post(`/communities/${communityId}/posts`)
        .send({ body: 'short-lived' })
        .expect(201);
      const theirs = await agents
        .get('owner')!
        .post(`/communities/${communityId}/posts`)
        .send({ body: 'owner post' })
        .expect(201);

      await agents
        .get('member')!
        .delete(`/posts/${(mine.body as PostBody).id}`)
        .expect(204);
      await agents
        .get('member')!
        .delete(`/posts/${(theirs.body as PostBody).id}`)
        .expect(403);

      // moderator deletes it via post:delete:any
      await agents
        .get('moderator')!
        .delete(`/posts/${(theirs.body as PostBody).id}`)
        .expect(204);
    });
  });

  describe('likes', () => {
    let postId: string;

    beforeAll(async () => {
      const res = await agents
        .get('owner')!
        .post(`/communities/${communityId}/posts`)
        .send({ body: 'like me' })
        .expect(201);
      postId = (res.body as PostBody).id;
    });

    it('a member likes a post; count and likedByMe update', async () => {
      await agents.get('member')!.put(`/posts/${postId}/like`).expect(204);

      const feed = await agents
        .get('member')!
        .get(`/communities/${communityId}/posts`)
        .query({ limit: 5 })
        .expect(200);

      const post = (feed.body as FeedBody).items.find((p) => p.id === postId)!;
      expect(post.likeCount).toBe(1);
      expect(post.likedByMe).toBe(true);
    });

    it('liking twice is idempotent — the count stays at 1', async () => {
      await agents.get('member')!.put(`/posts/${postId}/like`).expect(204);

      const row = await prisma.post.findUniqueOrThrow({
        where: { id: postId },
        select: { likeCount: true, _count: { select: { likes: true } } },
      });
      expect(row.likeCount).toBe(1);
      expect(row._count.likes).toBe(1); // counter matches actual rows
    });

    it('unlike removes the like; repeated unlike is a no-op', async () => {
      await agents.get('member')!.delete(`/posts/${postId}/like`).expect(204);
      await agents.get('member')!.delete(`/posts/${postId}/like`).expect(204);

      const row = await prisma.post.findUniqueOrThrow({
        where: { id: postId },
        select: { likeCount: true, _count: { select: { likes: true } } },
      });
      expect(row.likeCount).toBe(0);
      expect(row._count.likes).toBe(0);
    });

    it('outsiders cannot like (403 public, 404 private)', async () => {
      await agents.get('outsider')!.put(`/posts/${postId}/like`).expect(403);
      await agents
        .get('outsider')!
        .put(`/posts/${privatePostId}/like`)
        .expect(404);
    });

    it('anonymous like attempts are 401', async () => {
      await request(app.getHttpServer())
        .put(`/posts/${postId}/like`)
        .expect(401);
    });

    it('deleting a post cascades its likes away', async () => {
      const res = await agents
        .get('member')!
        .post(`/communities/${communityId}/posts`)
        .send({ body: 'liked then deleted' })
        .expect(201);
      const id = (res.body as PostBody).id;

      await agents.get('moderator')!.put(`/posts/${id}/like`).expect(204);
      await agents.get('member')!.delete(`/posts/${id}`).expect(204);

      expect(await prisma.postLike.count({ where: { postId: id } })).toBe(0);
    });
  });
});
