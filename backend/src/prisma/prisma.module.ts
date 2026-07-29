import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global: every feature module needs db access, and the guard layer resolves
// community context on essentially every request.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
