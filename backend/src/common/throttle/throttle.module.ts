import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottleGuard } from './throttle.guard';

/**
 * Imported before AuthModule in AppModule so this guard runs ahead of
 * JwtAuthGuard: rate limiting is the cheapest check available and must not sit
 * behind a database read that a flood is trying to provoke in the first place.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: ThrottleGuard }],
})
export class ThrottleModule {}
