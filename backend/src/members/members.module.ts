import { Module } from '@nestjs/common';
import { CommunitiesModule } from '../communities/communities.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  // CommunitiesModule exports MembershipPolicyService
  imports: [CommunitiesModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
