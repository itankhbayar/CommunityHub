import { SetMetadata } from '@nestjs/common';

export const THROTTLE_KEY = 'throttle:policy';

export interface ThrottlePolicy {
  /** requests one client may make to this handler per window */
  limit: number;
  windowMs: number;
}

/**
 * Caps how often one client may call a handler. Opt-in: an undecorated route
 * is not limited, which is the right default for reads but means every new
 * endpoint that costs something real has to say so explicitly.
 */
export const Throttle = (policy: ThrottlePolicy) =>
  SetMetadata(THROTTLE_KEY, policy);
