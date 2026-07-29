import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommunitySummary, ResolvedResource } from './community-context';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedTarget {
  community: CommunitySummary;
  resource?: ResolvedResource;
}

const COMMUNITY_SELECT = {
  id: true,
  slug: true,
  name: true,
  visibility: true,
} as const;

/**
 * Maps whatever route params are present onto the community the request is
 * about, loading the addressed resource along the way in the same query.
 *
 * Precedence is most-specific-first: a :postId or :eventId already implies the
 * community, so those params win over :communityId/:slug when both appear.
 *
 * Everything that cannot be resolved is a 404 — including a syntactically
 * invalid UUID, so a probe with a garbage id is indistinguishable from a
 * genuinely absent row.
 */
@Injectable()
export class CommunityContextResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(params: Record<string, string>): Promise<ResolvedTarget> {
    const { postId, eventId, communityId, slug } = params;

    if (postId !== undefined) {
      return this.byPost(postId);
    }
    if (eventId !== undefined) {
      return this.byEvent(eventId);
    }
    if (communityId !== undefined) {
      return this.byCommunityId(communityId);
    }
    if (slug !== undefined) {
      return this.bySlug(slug);
    }

    // A @RequirePermission route without a recognized param is a programming
    // error, but it must fail closed for the caller regardless.
    throw new NotFoundException('Not found.');
  }

  private async byPost(postId: string): Promise<ResolvedTarget> {
    this.assertUuid(postId);

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        authorId: true,
        community: { select: COMMUNITY_SELECT },
      },
    });
    if (!post) throw new NotFoundException('Not found.');

    return {
      community: post.community,
      resource: { kind: 'post', id: post.id, authorId: post.authorId },
    };
  }

  private async byEvent(eventId: string): Promise<ResolvedTarget> {
    this.assertUuid(eventId);

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        createdById: true,
        community: { select: COMMUNITY_SELECT },
      },
    });
    if (!event) throw new NotFoundException('Not found.');

    return {
      community: event.community,
      resource: { kind: 'event', id: event.id, createdById: event.createdById },
    };
  }

  private async byCommunityId(communityId: string): Promise<ResolvedTarget> {
    this.assertUuid(communityId);

    const community = await this.prisma.community.findUnique({
      where: { id: communityId },
      select: COMMUNITY_SELECT,
    });
    if (!community) throw new NotFoundException('Not found.');

    return { community };
  }

  private async bySlug(slug: string): Promise<ResolvedTarget> {
    const community = await this.prisma.community.findUnique({
      where: { slug },
      select: COMMUNITY_SELECT,
    });
    if (!community) throw new NotFoundException('Not found.');

    return { community };
  }

  private assertUuid(value: string): void {
    if (!UUID_RE.test(value)) {
      throw new NotFoundException('Not found.');
    }
  }
}
