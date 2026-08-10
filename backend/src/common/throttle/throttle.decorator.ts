import { SetMetadata } from '@nestjs/common';

export const THROTTLE_KEY = 'throttle:policy';

export interface ThrottlePolicy {
  /** requests one client may make to this handler per window */
  limit: number;
  windowMs: number;
  /**
   * Give the slot back when the handler succeeds, so only failures accumulate.
   *
   * For login this is the difference between a usable limit and a hostile one.
   * A guard runs before the handler and cannot know the outcome, so counting
   * every request charges someone signing in on their phone, laptop and tablet
   * exactly what it charges someone guessing passwords. Refunding on success
   * means the budget is spent only by attempts that were actually wrong, which
   * is the thing worth rationing.
   *
   * Not appropriate where the *successful* call is the expensive one —
   * registration creates an account, sending mail reaches an inbox — so those
   * keep counting everything.
   */
  refundOnSuccess?: boolean;
}

/**
 * Caps how often one client may call a handler. Opt-in: an undecorated route
 * is not limited, which is the right default for reads but means every new
 * endpoint that costs something real has to say so explicitly.
 */
export const Throttle = (policy: ThrottlePolicy) =>
  SetMetadata(THROTTLE_KEY, policy);
