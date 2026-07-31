import { Controller, Get } from '@nestjs/common';

@Controller('api/version')
export class VersionController {
  @Get()
  version(): { revision: string } {
    return { revision: process.env['ASA_BUILD_REVISION'] ?? 'development' };
  }
}
