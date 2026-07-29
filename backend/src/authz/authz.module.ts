import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CommunityContextResolver } from './community-context.resolver';
import { PermissionGuard } from './permission.guard';

/**
 * Global so every feature module gets the guard without importing anything.
 *
 * Import order in AppModule matters: AuthModule (JwtAuthGuard) must come
 * before this module so identity is established before permissions are
 * evaluated — APP_GUARD instances run in module-registration order.
 */
@Global()
@Module({
  providers: [
    CommunityContextResolver,
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
  exports: [CommunityContextResolver],
})
export class AuthzModule {}
