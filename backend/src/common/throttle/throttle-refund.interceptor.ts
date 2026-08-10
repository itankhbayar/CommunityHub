import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { THROTTLE_KEY, ThrottlePolicy } from './throttle.decorator';
import { ThrottleGuard, throttleKey } from './throttle.guard';

/**
 * Returns a rate-limit slot when the handler succeeds, for policies that ask
 * for it.
 *
 * This exists because a guard cannot see the outcome — it decides before the
 * handler runs. Splitting the decision (guard, must be early) from the
 * accounting (here, must be late) is what lets `/auth/login` ration wrong
 * passwords rather than sign-ins.
 *
 * `tap` fires only on the success notification, so a thrown 401 keeps its slot
 * spent, which is exactly the intent.
 */
@Injectable()
export class ThrottleRefundInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly guard: ThrottleGuard,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const policy = this.reflector.getAllAndOverride<ThrottlePolicy | undefined>(
      THROTTLE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!policy?.refundOnSuccess) return next.handle();

    const key = throttleKey(context);
    return next.handle().pipe(tap(() => this.guard.refund(key)));
  }
}
