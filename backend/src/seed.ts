/**
 * Demo seed: 1 platform admin + 3 users, 2 communities (1 private), mixed
 * roles per community, ~30 posts with likes, 3 events with varied capacities
 * (2 / 20 / unlimited), and RSVPs that leave the small event already full.
 *
 * Idempotent by design: users, communities, and memberships are upserted;
 * posts and events INSIDE THE TWO SEED COMMUNITIES are wiped and recreated,
 * so every run converges to the same predictable demo state. Content in any
 * other community is never touched.
 *
 * Lives in src/ (not prisma/) deliberately: it compiles with the app, so the
 * generated Prisma Client's `./x.js` specifiers resolve from dist/ without
 * any loader tricks. Run with `npm run seed`.
 */
import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

const DEMO_PASSWORD = 'password123!';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    const passwordHash = await argon2.hash(DEMO_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

    // ---- users ------------------------------------------------------------
    const upsertUser = (
      email: string,
      displayName: string,
      globalRole: 'USER' | 'PLATFORM_ADMIN' = 'USER',
    ) =>
      prisma.user.upsert({
        where: { email },
        // keep the demo password working even if it was changed
        update: { displayName, globalRole, passwordHash },
        create: { email, displayName, globalRole, passwordHash },
      });

    const admin = await upsertUser(
      'admin@communityhub.local',
      'Platform Admin',
      'PLATFORM_ADMIN',
    );
    const maya = await upsertUser('maya@communityhub.local', 'Maya Chen');
    const theo = await upsertUser('theo@communityhub.local', 'Theo Okafor');
    const suki = await upsertUser('suki@communityhub.local', 'Suki Tanaka');

    // ---- communities + mixed roles ---------------------------------------
    // Maya: OWNER of Trail Blazers, MEMBER of Book Nook.
    // Theo: MODERATOR of Trail Blazers, OWNER of Book Nook.
    // Suki: MEMBER of Trail Blazers, MODERATOR of Book Nook.
    // Admin: no memberships anywhere — their power is global.
    const trail = await prisma.community.upsert({
      where: { slug: 'trail-blazers' },
      update: {},
      create: {
        slug: 'trail-blazers',
        name: 'Trail Blazers',
        description:
          'Weekend hikes, sunrise summits, and the occasional muddy disaster. All paces welcome.',
        visibility: 'PUBLIC',
        createdById: maya.id,
      },
    });

    const nook = await prisma.community.upsert({
      where: { slug: 'book-nook' },
      update: {},
      create: {
        slug: 'book-nook',
        name: 'Book Nook',
        description:
          'A quiet corner for slow readers with strong opinions. Spoilers require consent.',
        visibility: 'PRIVATE',
        createdById: theo.id,
      },
    });

    const upsertMembership = (
      userId: string,
      communityId: string,
      role: 'OWNER' | 'MODERATOR' | 'MEMBER',
    ) =>
      prisma.membership.upsert({
        where: { userId_communityId: { userId, communityId } },
        update: { role },
        create: { userId, communityId, role },
      });

    await upsertMembership(maya.id, trail.id, 'OWNER');
    await upsertMembership(theo.id, trail.id, 'MODERATOR');
    await upsertMembership(suki.id, trail.id, 'MEMBER');
    await upsertMembership(theo.id, nook.id, 'OWNER');
    await upsertMembership(suki.id, nook.id, 'MODERATOR');
    await upsertMembership(maya.id, nook.id, 'MEMBER');

    // ---- content reset (seed communities only) ----------------------------
    await prisma.post.deleteMany({
      where: { communityId: { in: [trail.id, nook.id] } },
    });
    await prisma.event.deleteMany({
      where: { communityId: { in: [trail.id, nook.id] } },
    });

    // ---- posts ------------------------------------------------------------
    const now = Date.now();
    const authors = { maya, theo, suki };

    const trailPosts: [keyof typeof authors, string][] = [
      [
        'maya',
        'Welcome to Trail Blazers! Introduce yourself and tell us your favorite local trail.',
      ],
      [
        'theo',
        'Reminder: always pack a headlamp, even for "short" afternoon hikes. Ask me how I know.',
      ],
      [
        'suki',
        'First hike with this group yesterday — my legs hate me but my camera roll is thriving.',
      ],
      [
        'maya',
        'Scouted the ridge line route this morning. Muddy but passable. Poles recommended.',
      ],
      [
        'theo',
        'PSA: the north trailhead parking lot is closed for repaving until the 12th.',
      ],
      [
        'suki',
        'Does anyone have a boot recommendation for wide feet? Budget around $150.',
      ],
      [
        'maya',
        'Sunrise from Eagle Point at 5:48 this morning. Zero regrets, several yawns.',
      ],
      [
        'theo',
        'Trail mix hot take: raisins are load-bearing. Fight me in the comments.',
      ],
      [
        'suki',
        'Saw a family of deer on the creek loop today. They were unimpressed by us.',
      ],
      [
        'maya',
        'Group pace check: should we split into a fast crew and a scenic crew for long hikes?',
      ],
      [
        'theo',
        'Fixed the washed-out step on the switchback with some rocks. Temporary but solid.',
      ],
      [
        'suki',
        'My first summit with you all! Thank you for waiting at every viewpoint.',
      ],
      [
        'maya',
        'Weather looks rough this weekend — keep an eye on the events page for changes.',
      ],
      [
        'theo',
        'Recommended read: the county just published new trail maps, link at the visitor center.',
      ],
      [
        'suki',
        'Blister prevention thread. Drop your secrets. Mine is two pairs of socks.',
      ],
      [
        'maya',
        'We crossed 3 communities on one ridge today. Geography is fun.',
      ],
      [
        'theo',
        'Volunteer cleanup crew was unstoppable today. 14 bags of trash off the creek loop.',
      ],
      [
        'suki',
        'Anyone else name the trail cats? Gravel and Boulder said hi again today.',
      ],
      [
        'maya',
        'Monthly photo thread: post your best shot from a group hike this month.',
      ],
      [
        'theo',
        'If you borrowed my green trekking poles at the cleanup, I would love them back.',
      ],
    ];

    const nookPosts: [keyof typeof authors, string][] = [
      [
        'theo',
        'Welcome to the Nook. House rule: no spoilers without a warning, ever.',
      ],
      [
        'suki',
        'Finished the August pick in two sittings. I have THOUGHTS. Saving them for the meetup.',
      ],
      [
        'maya',
        'Confession: I am three books behind and reading the shortest one first.',
      ],
      [
        'theo',
        'Poll soon for the September pick — nominations open in the comments.',
      ],
      [
        'suki',
        'The twist in chapter 11. That is the post. That is all I can legally say.',
      ],
      [
        'maya',
        'Reading on the porch while it rains is the whole personality now.',
      ],
      [
        'theo',
        'Library sale on Saturday. Hardcovers a dollar. This is not a drill.',
      ],
      [
        'suki',
        'Annotated my copy for the first time ever. I get it now. I am a margins person.',
      ],
      [
        'maya',
        'Vote result: we ARE allowed to say "the ending felt rushed" before the meetup.',
      ],
      [
        'theo',
        'Gentle reminder the meetup moved one week later — see the events tab.',
      ],
    ];

    type SeedPost = {
      communityId: string;
      authorId: string;
      body: string;
      createdAt: Date;
    };

    const posts: SeedPost[] = [
      ...trailPosts.map(([who, body], i): SeedPost => ({
        communityId: trail.id,
        authorId: authors[who].id,
        body,
        // newest entry ~2h ago, spaced ~16h apart across two weeks
        createdAt: new Date(
          now - 2 * HOUR - (trailPosts.length - 1 - i) * 16 * HOUR,
        ),
      })),
      ...nookPosts.map(([who, body], i): SeedPost => ({
        communityId: nook.id,
        authorId: authors[who].id,
        body,
        createdAt: new Date(
          now - 5 * HOUR - (nookPosts.length - 1 - i) * 26 * HOUR,
        ),
      })),
    ];

    const createdPosts = [];
    for (const post of posts) {
      createdPosts.push(await prisma.post.create({ data: post }));
    }

    // ---- likes (counter kept consistent with rows) ------------------------
    const userIds = [maya.id, theo.id, suki.id];
    let likeTotal = 0;
    for (const [index, post] of createdPosts.entries()) {
      // deterministic spread: 0-2 likes per post, never the author's own
      const likers = userIds
        .filter((id) => id !== post.authorId)
        .slice(0, index % 3);
      if (likers.length === 0) continue;

      await prisma.postLike.createMany({
        data: likers.map((userId) => ({ postId: post.id, userId })),
      });
      await prisma.post.update({
        where: { id: post.id },
        data: { likeCount: likers.length },
      });
      likeTotal += likers.length;
    }

    // ---- events (varied capacities: 2 / 20 / unlimited) -------------------
    const summit = await prisma.event.create({
      data: {
        communityId: trail.id,
        createdById: maya.id,
        title: 'Sunrise Summit Hike',
        description:
          'Small crew, alpine start. We leave the trailhead at 4:30 sharp — headlamps mandatory.',
        location: 'Eagle Point Trailhead',
        startsAt: new Date(now + 3 * DAY),
        endsAt: new Date(now + 3 * DAY + 6 * HOUR),
        capacity: 2, // seeded full below — demos the 409 + rollback path
      },
    });

    const cleanup = await prisma.event.create({
      data: {
        communityId: trail.id,
        createdById: theo.id,
        title: 'Creek Loop Cleanup Day',
        description:
          'Bags and grabbers provided. Come for an hour or stay all morning — every pair of hands counts.',
        location: 'Creek Loop, south entrance',
        startsAt: new Date(now + 7 * DAY),
        capacity: null, // unlimited
      },
    });

    const bookClub = await prisma.event.create({
      data: {
        communityId: nook.id,
        createdById: theo.id,
        title: 'August Book Club: The Long Way Home',
        description:
          'Spoilers become legal at 7pm sharp. Snacks encouraged, strong opinions required.',
        location: 'Corner table, Milletto Cafe',
        startsAt: new Date(now + 10 * DAY),
        endsAt: new Date(now + 10 * DAY + 2 * HOUR),
        capacity: 20,
      },
    });

    await prisma.eventRsvp.createMany({
      data: [
        // summit is FULL: capacity 2, two GOING
        { eventId: summit.id, userId: maya.id, status: 'GOING' },
        { eventId: summit.id, userId: theo.id, status: 'GOING' },
        { eventId: cleanup.id, userId: theo.id, status: 'GOING' },
        { eventId: cleanup.id, userId: suki.id, status: 'GOING' },
        { eventId: cleanup.id, userId: maya.id, status: 'NOT_GOING' },
        { eventId: bookClub.id, userId: theo.id, status: 'GOING' },
        { eventId: bookClub.id, userId: suki.id, status: 'GOING' },
        { eventId: bookClub.id, userId: maya.id, status: 'GOING' },
      ],
    });

    // ---- summary ----------------------------------------------------------
    console.log('Seed complete.');
    console.log(
      `  users: 4 (1 platform admin), posts: ${createdPosts.length}, likes: ${likeTotal}, events: 3`,
    );
    console.log(`  communities: trail-blazers (public), book-nook (private)`);
    console.log('');
    console.log('Demo logins (password for all: password123!)');
    console.log(
      '  admin@communityhub.local  platform admin, member of nothing',
    );
    console.log(
      '  maya@communityhub.local   OWNER of Trail Blazers, MEMBER of Book Nook',
    );
    console.log(
      '  theo@communityhub.local   MODERATOR of Trail Blazers, OWNER of Book Nook',
    );
    console.log(
      '  suki@communityhub.local   MEMBER of Trail Blazers, MODERATOR of Book Nook',
    );
    console.log('');
    console.log(
      '"Sunrise Summit Hike" is seeded full (2/2) to demo the 409 path.',
    );
    void admin;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
