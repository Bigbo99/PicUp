import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { CreateImageJobDto } from './dto';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';

@Controller('api/image/jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @Post()
  create(@Body() body: CreateImageJobDto, @Req() req: AuthenticatedRequest) {
    return this.jobs.create(body, req.authUser);
  }

  @Get()
  list(@Query('limit') limit: string | undefined, @Req() req: AuthenticatedRequest) {
    return this.jobs.list(Number(limit ?? 20), req.authUser);
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.jobs.get(id, req.authUser);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.jobs.delete(id, req.authUser);
  }
}
