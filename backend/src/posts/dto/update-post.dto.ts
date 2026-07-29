import { CreatePostDto } from './create-post.dto';

/** Editing a post replaces its body; nothing else about a post is mutable. */
export class UpdatePostDto extends CreatePostDto {}
