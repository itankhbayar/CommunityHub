import { Controller, Get } from '@nestjs/common';
import { trustProxyHops } from '../app-setup';
import { Public } from '../auth/decorators/public.decorator';
import { MailerService } from '../mail/mailer.service';

@Controller('health')
export class HealthController {
  constructor(private readonly mailer: MailerService) {}

  // container healthchecks and uptime probes have no session
  @Public()
  @Get()
  check() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      // Deployment settings that fail *silently* — each one leaves the API
      // healthy and an entire feature quietly broken, so each one is reported
      // here rather than only in the boot log:
      //
      //   mail.configured false -> reset and confirmation links go to the log
      //     instead of an inbox. Invisible otherwise, because
      //     /auth/forgot-password answers 202 either way on purpose.
      //   mail.transport 'smtp' on a host that blocks outbound 25/465/587
      //     (Render's free tier, among others) -> configured, reachable, and
      //     silently timing out on every send. Naming the transport is what
      //     separates that from a credential problem without reading logs.
      //   trustProxyHops 0 behind a proxy -> every client shares one
      //     rate-limit bucket, so one visitor can lock the endpoint for all.
      //   appUrl on localhost -> emailed links point at the recipient's own
      //     machine.
      //
      // No credentials here, and nothing an attacker gains from: a host and
      // two numbers that are already observable in the product's behaviour.
      config: {
        mail: this.mailer.status,
        trustProxyHops: trustProxyHops(),
        appUrl: process.env.APP_URL ?? null,
      },
    };
  }
}
