import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JobsService } from './jobs.service';
import { CreateImageJobDto } from './dto';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { publicJob } from './preview-edit';

@Controller('api/image/jobs')
@UseGuards(AuthGuard)
export class JobsController {
  constructor(
    @Inject(JobsService) private readonly jobs: JobsService,
    @Inject(AuthService) private readonly auth: AuthService
  ) {}

  @Post()
  async create(@Body() body: CreateImageJobDto, @Req() req: AuthenticatedRequest) {
    const user = await this.auth.requireUser(req);
    return this.jobs.create(body, user);
  }

  @Get()
  async list(@Query('limit') limit: string | undefined, @Req() req: AuthenticatedRequest,
    @Query('cursor') cursor?: string, @Query('q') query?: string, @Query('status') status?: string) {
    return (await this.jobs.list(Number(limit ?? 20), req.authUser, cursor, query, status)).map(publicJob);
  }

  @Post('quote')
  quote(@Body() body: CreateImageJobDto, @Req() req: AuthenticatedRequest) {
    return this.jobs.quote(body, req.authUser);
  }

  @Post(':id/reference/:index')
  reference(@Param('id') id: string, @Param('index') index: string, @Req() req: AuthenticatedRequest) {
    return this.jobs.referenceOutput(id, Number(index), req.authUser);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return publicJob(await this.jobs.get(id, req.authUser));
  }

  @Get(':id/download/:index')
  async download(
    @Param('id') id: string,
    @Param('index') index: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response
  ) {
    const user = await this.auth.requireUser(req);
    const file = await this.jobs.downloadOutput(id, Number(index), user);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }

  @Get(':id/preview/:index')
  async preview(@Param('id') id: string, @Param('index') index: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const user = await this.auth.requireUser(req);
    const file = await this.jobs.downloadOutput(id, Number(index), user);
    res.setHeader('Content-Type', file.mimeType);
    // Output objects are immutable; keep them in the user's browser cache while
    // the ownership check above still protects every request.
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.body);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.jobs.delete(id, req.authUser);
  }
}
