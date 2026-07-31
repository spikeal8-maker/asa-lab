import { Controller, Get, Inject } from '@nestjs/common';
import type { ModuleRegistry, ModuleSummary } from '@asa-lab/module-sdk';
import { TOKENS } from './tokens.js';

@Controller('api/modules')
export class ModulesController {
  constructor(@Inject(TOKENS.moduleRegistry) private readonly registry: ModuleRegistry) {}

  @Get()
  list(): { items: readonly ModuleSummary[] } {
    return { items: this.registry.list() };
  }
}
