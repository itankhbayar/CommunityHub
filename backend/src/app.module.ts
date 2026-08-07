import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { AuthzModule } from './authz/authz.module';
import { ThrottleModule } from './common/throttle/throttle.module';
import { CommunitiesModule } from './communities/communities.module';
import { MembersModule } from './members/members.module';
import { PostsModule } from './posts/posts.module';
import { EventsModule } from './events/events.module';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    MailModule,
    // Order matters, because global guards run in registration order:
    // ThrottleModule's limiter first (cheapest, and it must not sit behind the
    // work a flood is trying to provoke), then AuthModule's JwtAuthGuard, then
    // AuthzModule's PermissionGuard — identity before permissions.
    ThrottleModule,
    AuthModule,
    AuthzModule,
    CommunitiesModule,
    MembersModule,
    PostsModule,
    EventsModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
