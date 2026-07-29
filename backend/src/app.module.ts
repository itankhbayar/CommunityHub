import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AuthzModule } from './authz/authz.module';
import { CommunitiesModule } from './communities/communities.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    // Order matters: AuthModule's JwtAuthGuard must register before
    // AuthzModule's PermissionGuard — identity first, then permissions.
    AuthModule,
    AuthzModule,
    CommunitiesModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
