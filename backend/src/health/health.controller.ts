import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';

@Controller('health')
export class HealthController {
  // container healthchecks and uptime probes have no session
  @Public()
  @Get()
  check() {
    return { status: 'ok', uptime: process.uptime() };
  }
}
