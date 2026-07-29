import { Module } from '@nestjs/common';
import { MembershipPolicyService } from '../authz/policies/membership.policy';
import { CommunitiesController } from './communities.controller';
import { CommunitiesService } from './communities.service';

@Module({
  controllers: [CommunitiesController],
  providers: [CommunitiesService, MembershipPolicyService],
  exports: [MembershipPolicyService],
})
export class CommunitiesModule {}
