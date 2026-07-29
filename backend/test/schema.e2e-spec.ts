import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Proves the two constraints the spec calls out by name, and that deleting a
 * community leaves nothing orphaned. These are database-level guarantees, so
 * they are asserted against a real Postgres rather than a mocked client.
 */
describe('Schema integrity (e2e)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Users and communities are the two roots; cascade clears everything below.
    await prisma.community.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedFixture() {
    const owner = await prisma.user.create({
      data: {
        email: 'owner@example.com',
        passwordHash: 'x',
        displayName: 'Owner',
      },
    });
    const member = await prisma.user.create({
      data: {
        email: 'member@example.com',
        passwordHash: 'x',
        displayName: 'Member',
      },
    });

    const community = await prisma.community.create({
      data: {
        slug: 'trail-runners',
        name: 'Trail Runners',
        createdById: owner.id,
        memberships: {
          create: [
            { userId: owner.id, role: 'OWNER' },
            { userId: member.id, role: 'MEMBER' },
          ],
        },
      },
    });

    const post = await prisma.post.create({
      data: { communityId: community.id, authorId: owner.id, body: 'Hello' },
    });
    await prisma.postLike.create({
      data: { postId: post.id, userId: member.id },
    });

    const event = await prisma.event.create({
      data: {
        communityId: community.id,
        createdById: owner.id,
        title: 'Saturday long run',
        startsAt: new Date('2026-08-01T08:00:00Z'),
        capacity: 10,
      },
    });
    await prisma.eventRsvp.create({
      data: { eventId: event.id, userId: member.id, status: 'GOING' },
    });

    return { owner, member, community, post, event };
  }

  it('rejects a duplicate membership for the same (user, community)', async () => {
    const { member, community } = await seedFixture();

    await expect(
      prisma.membership.create({
        data: { userId: member.id, communityId: community.id, role: 'MEMBER' },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it('rejects a duplicate RSVP for the same (event, user)', async () => {
    const { member, event } = await seedFixture();

    await expect(
      prisma.eventRsvp.create({
        data: { eventId: event.id, userId: member.id, status: 'NOT_GOING' },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it('allows the same user to hold different roles in different communities', async () => {
    const { member, owner } = await seedFixture();

    const second = await prisma.community.create({
      data: {
        slug: 'book-club',
        name: 'Book Club',
        createdById: owner.id,
        memberships: { create: [{ userId: member.id, role: 'OWNER' }] },
      },
    });

    const roles = await prisma.membership.findMany({
      where: { userId: member.id },
      select: { communityId: true, role: true },
    });

    expect(roles).toHaveLength(2);
    expect(roles.find((r) => r.communityId === second.id)?.role).toBe('OWNER');
  });

  it('cascades a community delete to posts, likes, events, rsvps and memberships', async () => {
    const { community } = await seedFixture();

    await prisma.community.delete({ where: { id: community.id } });

    const [memberships, posts, likes, events, rsvps, users] = await Promise.all(
      [
        prisma.membership.count(),
        prisma.post.count(),
        prisma.postLike.count(),
        prisma.event.count(),
        prisma.eventRsvp.count(),
        prisma.user.count(),
      ],
    );

    expect({ memberships, posts, likes, events, rsvps }).toEqual({
      memberships: 0,
      posts: 0,
      likes: 0,
      events: 0,
      rsvps: 0,
    });
    // the people survive; only the community's contents are removed
    expect(users).toBe(2);
  });
});
