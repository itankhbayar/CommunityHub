import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Opts a route out of the global JwtAuthGuard. Authentication is on by
 * default, so forgetting this decorator fails closed.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
