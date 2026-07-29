import { PartialType } from '@nestjs/mapped-types';
import { CreateCommunityDto } from './create-community.dto';

/** PATCH semantics: every field optional; the slug is immutable — URLs last. */
export class UpdateCommunityDto extends PartialType(CreateCommunityDto) {}
