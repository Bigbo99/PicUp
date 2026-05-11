import { Controller, Get, Inject } from '@nestjs/common';
import { ModelsService } from './models.service';

@Controller('api/models')
export class ModelsController {
  constructor(@Inject(ModelsService) private readonly models: ModelsService) {}

  @Get()
  list() {
    return this.models.getModels();
  }
}
