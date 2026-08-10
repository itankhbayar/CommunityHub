import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottleRefundInterceptor } from './throttle-refund.interceptor';
import { ThrottleGuard } from './throttle.guard';

/**
 * Imported before AuthModule in AppModule so this guard runs ahead of
 * JwtAuthGuard: rate limiting is the cheapest check available and must not sit
 * behind a database read that a flood is trying to provoke in the first place.
 */
@Module({
  providers: [
    // Registered under its own token as well as APP_GUARD, via useExisting so
    // both resolve to one instance. Without this the counters the interceptor
    // refunds against would belong to a second, unrelated guard — and the two
    // would silently disagree about how many attempts a client had left.
    ThrottleGuard,
    { provide: APP_GUARD, useExisting: ThrottleGuard },
    { provide: APP_INTERCEPTOR, useClass: ThrottleRefundInterceptor },
  ],
})
export class ThrottleModule {}
