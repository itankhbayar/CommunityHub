import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * `new` is the default because it is what the listing has always done, and the
 * communities index depends on newest-first.
 */
export const COMMUNITY_SORTS = ['new', 'popular', 'active'] as const;

export type CommunitySort = (typeof COMMUNITY_SORTS)[number];

export class ListCommunitiesQuery {
  /** case-insensitive name filter */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  /**
   * Ordering, not filtering: every sort returns the same set of communities,
   * only in a different order. A visitor picking "active" on a quiet week
   * should still see something.
   */
  @IsOptional()
  @IsIn(COMMUNITY_SORTS)
  sort?: CommunitySort = 'new';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}
