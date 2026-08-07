import { Global, Module } from '@nestjs/common';
import { MailerService } from './mailer.service';

/** Global so any feature can mail without re-importing the module. */
@Global()
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailModule {}
