import {
  Controller,
  Delete,
  Get,
  INestApplication,
  Module,
  Patch,
  Post,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-setup';
import { Public } from '../src/auth/decorators/public.decorator';
import { RequirePermission } from '../src/authz/require-permission.decorator';
import { CommunityRole, Visibility } from '../src/generated/prisma/enums';
import { PrismaService } from '../src/prisma/prisma.service';
import { resetDatabase } from './utils/app';

/**
 * Probe controller: exists only inside this test module, never ships. Each
 * route declares a permission the way real resource controllers will, so this
 * suite proves the guard wiring end-to-end over HTTP — 404 vs 403, database
 * freshness of roles, and the own/any fallback — independent of any feature
 * module.
 */
@Controller('probe')
class ProbeController {
  @Public()
  @RequirePermission('community:view')
  @Get('communities/:communityId/view')
  view() {
    return { ok: true };
  }

  @RequirePermission('post:create')
  @Post('communities/:communityId/posts')
  createPost() {
    return { ok: true };
  }

  @RequirePermission({
    any: 'post:edit:any',
    own: 'post:edit:own',
    ownerField: 'authorId',
  })
  @Patch('posts/:postId')
  editPost() {
    return { ok: true };
  }

  @RequirePermission('event:manage')
  @Post('communities/:communityId/events')
  manageEvents() {
    return { ok: true };
  }

  @RequirePermission('community:delete')
  @Delete('communities/:communityId')
  deleteCommunity() {
    return { ok: true };
  }

  @RequirePermission('member:role:change')
  @Patch('communities/:communityId/roles')
  changeRole() {
    return { ok: true };
  }
}

@Module({ imports: [AppModule], controllers: [ProbeController] })
class ProbeTestModule {}

const PASSWORD = 'correct-horse-battery';

describe('Authorization guard (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  /** cookie jars per persona */
  const agents = new Map<string, ReturnType<typeof request.agent>>();
  const userIds = new Map<string, string>();

  let publicCommunityId: string;
  let privateCommunityId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeTestModule],
    }).compile();

    app = moduleRef.createNestApplication<INestApplication<App>>();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    await resetDatabase(prisma);

    // personas: one per actor role, plus a platform admin
    for (const name of ['admin', 'owner', 'moderator', 'member', 'outsider']) {
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

    // PLATFORM_ADMIN is seeded directly — there is deliberately no endpoint for it
    await prisma.user.update({
      where: { id: userIds.get('admin')! },
      data: { globalRole: 'PLATFORM_ADMIN' },
    });

    const mkCommunity = async (
      slug: string,
      visibility: Visibility,
      roles: Record<string, CommunityRole>,
    ) => {
      const community = await prisma.community.create({
        data: {
          slug,
          name: slug,
          visibility,
          createdById: userIds.get('owner')!,
          memberships: {
            create: Object.entries(roles).map(([persona, role]) => ({
              userId: userIds.get(persona)!,
              role,
            })),
          },
        },
      });
      return community.id;
    };

    publicCommunityId = await mkCommunity('public-club', 'PUBLIC', {
      owner: 'OWNER',
      moderator: 'MODERATOR',
      member: 'MEMBER',
    });
    privateCommunityId = await mkCommunity('secret-club', 'PRIVATE', {
      owner: 'OWNER',
      moderator: 'MODERATOR',
      member: 'MEMBER',
    });
    // note: 'admin' has NO membership anywhere — their power is global only
  });

  afterAll(async () => {
    await app.close();
  });

  describe('404 vs 403 — private communities look nonexistent to outsiders', () => {
    it('outsider viewing a private community gets 404, not 403', async () => {
      await agents
        .get('outsider')!
        .get(`/probe/communities/${privateCommunityId}/view`)
        .expect(404);
    });

    it('outsider acting in a private community still gets 404 — even for actions that would be 403 in a public one', async () => {
      await agents
        .get('outsider')!
        .post(`/probe/communities/${privateCommunityId}/posts`)
        .expect(404);
    });

    it('outsider acting in a PUBLIC community gets 403 — existence is no secret', async () => {
      await agents
        .get('outsider')!
        .post(`/probe/communities/${publicCommunityId}/posts`)
        .expect(403);
    });

    it('a member of the private community sees it fine', async () => {
      await agents
        .get('member')!
        .get(`/probe/communities/${privateCommunityId}/view`)
        .expect(200);
    });

    it('platform admin sees a private community without any membership', async () => {
      await agents
        .get('admin')!
        .get(`/probe/communities/${privateCommunityId}/view`)
        .expect(200);
    });

    it('a garbage id and a valid-but-absent id are the same 404', async () => {
      const absent = '01234567-89ab-7def-8123-456789abcdef';
      await agents
        .get('member')!
        .get(`/probe/communities/${absent}/view`)
        .expect(404);
      await agents
        .get('member')!
        .get('/probe/communities/not-a-uuid/view')
        .expect(404);
    });

    it('anonymous guests can view a public community', async () => {
      await request(app.getHttpServer())
        .get(`/probe/communities/${publicCommunityId}/view`)
        .expect(200);
    });

    it('anonymous guests get 404 for a private one', async () => {
      await request(app.getHttpServer())
        .get(`/probe/communities/${privateCommunityId}/view`)
        .expect(404);
    });
  });

  describe('matrix enforcement over HTTP', () => {
    it('member may create posts but not events', async () => {
      const member = agents.get('member')!;
      await member
        .post(`/probe/communities/${publicCommunityId}/posts`)
        .expect(201);
      await member
        .post(`/probe/communities/${publicCommunityId}/events`)
        .expect(403);
    });

    it('moderator may manage events but not delete the community or change roles', async () => {
      const moderator = agents.get('moderator')!;
      await moderator
        .post(`/probe/communities/${publicCommunityId}/events`)
        .expect(201);
      await moderator
        .delete(`/probe/communities/${publicCommunityId}`)
        .expect(403);
      await moderator
        .patch(`/probe/communities/${publicCommunityId}/roles`)
        .expect(403);
    });

    it('owner may do all of it', async () => {
      const owner = agents.get('owner')!;
      await owner
        .post(`/probe/communities/${publicCommunityId}/events`)
        .expect(201);
      await owner
        .patch(`/probe/communities/${publicCommunityId}/roles`)
        .expect(200);
      await owner.delete(`/probe/communities/${publicCommunityId}`).expect(200);
    });

    it('platform admin may act in a community they never joined', async () => {
      await agents
        .get('admin')!
        .post(`/probe/communities/${publicCommunityId}/events`)
        .expect(201);
    });
  });

  describe('own vs any', () => {
    let memberPostId: string;
    let moderatorPostId: string;

    beforeAll(async () => {
      const mk = (persona: string) =>
        prisma.post.create({
          data: {
            communityId: publicCommunityId,
            authorId: userIds.get(persona)!,
            body: `${persona}'s post`,
          },
        });
      memberPostId = (await mk('member')).id;
      moderatorPostId = (await mk('moderator')).id;
    });

    it('member edits their own post', async () => {
      await agents
        .get('member')!
        .patch(`/probe/posts/${memberPostId}`)
        .expect(200);
    });

    it("member cannot edit someone else's post", async () => {
      await agents
        .get('member')!
        .patch(`/probe/posts/${moderatorPostId}`)
        .expect(403);
    });

    it("moderator edits a member's post via post:edit:any", async () => {
      await agents
        .get('moderator')!
        .patch(`/probe/posts/${memberPostId}`)
        .expect(200);
    });

    it('outsider cannot edit anything — not even with a stolen post id', async () => {
      await agents
        .get('outsider')!
        .patch(`/probe/posts/${memberPostId}`)
        .expect(403);
    });
  });

  describe('rule 4 — the database, not the token, is the authority', () => {
    it('a demotion applies on the very next request with the same cookie', async () => {
      const moderator = agents.get('moderator')!;

      // works as MODERATOR
      await moderator
        .post(`/probe/communities/${privateCommunityId}/events`)
        .expect(201);

      // demote directly in the database — no re-login, same access token
      await prisma.membership.update({
        where: {
          userId_communityId: {
            userId: userIds.get('moderator')!,
            communityId: privateCommunityId,
          },
        },
        data: { role: 'MEMBER' },
      });

      await moderator
        .post(`/probe/communities/${privateCommunityId}/events`)
        .expect(403);

      // restore for any later assertions
      await prisma.membership.update({
        where: {
          userId_communityId: {
            userId: userIds.get('moderator')!,
            communityId: privateCommunityId,
          },
        },
        data: { role: 'MODERATOR' },
      });
    });

    it('removal from a private community turns its 200s into 404s mid-session', async () => {
      const member = agents.get('member')!;

      await member
        .get(`/probe/communities/${privateCommunityId}/view`)
        .expect(200);

      const membership = await prisma.membership.delete({
        where: {
          userId_communityId: {
            userId: userIds.get('member')!,
            communityId: privateCommunityId,
          },
        },
      });

      // same cookie, next request: the community no longer exists for them
      await member
        .get(`/probe/communities/${privateCommunityId}/view`)
        .expect(404);

      await prisma.membership.create({
        data: {
          userId: membership.userId,
          communityId: membership.communityId,
          role: membership.role,
        },
      });
    });
  });

  describe('scoping', () => {
    it('the same user is OWNER in one community and powerless in another', async () => {
      // 'member' persona: MEMBER in public-club; make them OWNER of a fresh community
      const soloCommunity = await prisma.community.create({
        data: {
          slug: 'members-own-club',
          name: 'Members Own Club',
          createdById: userIds.get('member')!,
          memberships: {
            create: [{ userId: userIds.get('member')!, role: 'OWNER' }],
          },
        },
      });

      const member = agents.get('member')!;

      // owner powers where they own...
      await member
        .patch(`/probe/communities/${soloCommunity.id}/roles`)
        .expect(200);

      // ...none where they are just a member
      await member
        .patch(`/probe/communities/${publicCommunityId}/roles`)
        .expect(403);
    });
  });
});
