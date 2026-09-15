import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PrismaService } from '../../common/database/prisma.service';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';

class PreferencesDto {
  @IsOptional() @IsIn(['system', 'light', 'dark']) theme?: string;
  @IsOptional() @IsIn(['1K', '2K', '4K']) quality?: string;
  @IsOptional() @IsIn(['auto', '1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9']) aspectRatio?: string;
  @IsOptional() @IsIn(['enter', 'modifier']) sendMode?: string;
  @IsOptional() @IsBoolean() autoContinue?: boolean;
  @IsOptional() @IsString() @MaxLength(100) provider?: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
}
class AssetDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsBoolean() hidden?: boolean;
}
class ConversationDto {
  @IsIn(['archive', 'restore']) action!: 'archive' | 'restore';
}

class SubjectDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsUUID() fileId!: string;
}

@Controller('api/studio')
@UseGuards(AuthGuard)
export class StudioController {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}

  @Get('subjects')
  async subjects(@Req() req: AuthenticatedRequest, @Query('q') q = '', @Query('offset') offset = '0') {
    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const items = await this.db.studioSubject.findMany({ where: { userId: req.authUser.id, name: { contains: q.trim(), mode: 'insensitive' } },
      include: { file: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: start, take: 21 });
    return { items: items.slice(0, 20), next: items.length > 20 ? start + 20 : null };
  }

  @Post('subjects')
  async createSubject(@Body() body: SubjectDto, @Req() req: AuthenticatedRequest) {
    if (!body.name.trim()) throw new BadRequestException('请输入主体名称');
    const file = await this.db.fileRecord.findFirst({ where: { id: body.fileId, userId: req.authUser.id, mimeType: { startsWith: 'image/' } } });
    if (!file) throw new NotFoundException('主体参考图片不存在');
    return this.db.studioSubject.create({ data: { userId: req.authUser.id, fileId: file.id, name: body.name.trim(), description: body.description?.trim() ?? '' }, include: { file: true } });
  }

  @Get('preferences')
  async preferences(@Req() req: AuthenticatedRequest) {
    return (await this.db.studioPreference.findUnique({ where: { userId: req.authUser.id } }))?.settings ?? {};
  }

  @Patch('preferences')
  async savePreferences(@Body() body: PreferencesDto, @Req() req: AuthenticatedRequest) {
    return this.db.$transaction(async tx => {
      // Serialize updates per account so simultaneous preference changes do not overwrite each other.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${req.authUser.id}::uuid FOR UPDATE`;
      const old = await tx.studioPreference.findUnique({ where: { userId: req.authUser.id } });
      const patch = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
      const settings = { ...(old?.settings as Record<string, unknown> ?? {}), ...patch };
      return (await tx.studioPreference.upsert({ where: { userId: req.authUser.id }, create: { userId: req.authUser.id, settings }, update: { settings } })).settings;
    });
  }

  @Get('conversations')
  async conversations(@Req() req: AuthenticatedRequest, @Query('q') q = '', @Query('offset') offset = '0', @Query('archived') archived = 'false') {
    const normalizedQuery = q.trim();
    const [jobs, metadata] = await Promise.all([
      this.db.imageJob.findMany({
        where: { userId: req.authUser.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 5000,
        select: { id: true, parentJobId: true, prompt: true, status: true, createdAt: true, deletedAt: true }
      }),
      this.db.studioConversationMetadata.findMany({ where: { userId: req.authUser.id }, orderBy: { updatedAt: 'desc' }, take: 5000 })
    ]);
    const metaByRoot = new Map(metadata.map(item => [item.rootJobId, item]));
    const byId = new Map(jobs.map(job => [job.id, job]));
    const groups = new Map<string, { id: string; title: string; jobId: string; count: number; status: string; updatedAt: Date; matches: boolean }>();
    for (const job of jobs) {
      if (job.deletedAt) continue;
      let root = job;
      const seen = new Set([root.id]);
      while (root.parentJobId && byId.has(root.parentJobId) && !seen.has(root.parentJobId)) {
        root = byId.get(root.parentJobId)!; seen.add(root.id);
      }
      const old = groups.get(root.id);
      groups.set(root.id, { id: root.id, title: root.prompt, jobId: job.id, count: (old?.count ?? 0) + 1, status: job.status, updatedAt: job.createdAt, matches: Boolean(old?.matches || job.prompt.toLowerCase().includes(normalizedQuery.toLowerCase())) });
    }
    const showArchived = archived === 'true';
    const all = [...groups.values()].filter(item => {
      const meta = metaByRoot.get(item.id);
      return item.matches && !meta?.deletedAt && Boolean(meta?.archived) === showArchived;
    }).map(item => ({ ...item, archived: showArchived })).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.jobId.localeCompare(a.jobId));
    const start = Math.max(0, Number(offset) || 0);
    return { items: all.slice(start, start + 20), next: start + 20 < all.length ? start + 20 : null };
  }

  @Patch('conversations/:rootJobId')
  async updateConversation(@Param('rootJobId') rootJobId: string, @Body() body: ConversationDto, @Req() req: AuthenticatedRequest) {
    await this.requireConversation(req.authUser.id, rootJobId);
    const archived = body.action === 'archive';
    await this.db.studioConversationMetadata.upsert({
      where: { userId_rootJobId: { userId: req.authUser.id, rootJobId } },
      create: { userId: req.authUser.id, rootJobId, archived },
      update: { archived, deletedAt: null }
    });
    return { ok: true, rootJobId, archived };
  }

  @Delete('conversations/:rootJobId')
  async deleteConversation(@Param('rootJobId') rootJobId: string, @Req() req: AuthenticatedRequest) {
    const ids = await this.requireConversation(req.authUser.id, rootJobId);
    const now = new Date();
    await this.db.$transaction([
      this.db.imageJob.updateMany({ where: { userId: req.authUser.id, id: { in: ids } }, data: { deletedAt: now } }),
      this.db.studioConversationMetadata.upsert({
        where: { userId_rootJobId: { userId: req.authUser.id, rootJobId } },
        create: { userId: req.authUser.id, rootJobId, deletedAt: now },
        update: { deletedAt: now }
      })
    ]);
    return { ok: true, rootJobId, jobIds: ids };
  }

  private async requireConversation(userId: string, rootJobId: string) {
    const jobs = await this.db.imageJob.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, take: 5000, select: { id: true, parentJobId: true, deletedAt: true } });
    if (!jobs.some(job => job.id === rootJobId && !job.deletedAt)) throw new NotFoundException('对话不存在');
    const ids = new Set([rootJobId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const job of jobs) if (!job.deletedAt && job.parentJobId && ids.has(job.parentJobId) && !ids.has(job.id)) { ids.add(job.id); changed = true; }
    }
    return [...ids];
  }

  private async assets(userId: string) {
    const [files, jobs, metadata, subjects] = await Promise.all([
      this.db.fileRecord.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5000 }),
      this.db.imageJob.findMany({ where: { userId, deletedAt: null, status: 'succeeded' }, orderBy: { createdAt: 'desc' }, take: 5000, select: { id: true, prompt: true, outputImages: true, imageIds: true, createdAt: true, status: true } }),
      this.db.studioAssetMetadata.findMany({ where: { userId }, take: 5000 }),
      this.db.studioSubject.findMany({ where: { userId }, include: { file: true }, orderBy: { createdAt: 'desc' }, take: 5000 })
    ]);
    const meta = new Map(metadata.map(item => [item.key, item]));
    const referenced = new Set(jobs.flatMap(job => (job.imageIds as string[]) ?? []));
    const items = [
      ...subjects.map(subject => ({ key: `subject:${subject.id}`, subjectId: subject.id, fileId: subject.fileId, jobId: null as string | null, index: 0, url: subject.file.url, title: subject.name, kind: 'subject', createdAt: subject.createdAt })),
      ...files.filter(file => referenced.has(file.id)).map(file => ({ key: `file:${file.id}`, fileId: file.id, jobId: null as string | null, index: 0, url: file.url, title: '上传图片', kind: 'upload', createdAt: file.createdAt })),
      ...jobs.filter(job => job.status === 'succeeded').flatMap(job => (job.outputImages as { url: string }[]).map((image, index) => ({ key: `job:${job.id}:${index}`, fileId: null as string | null, jobId: job.id, index, url: image.url, title: job.prompt, kind: 'generated', createdAt: job.createdAt })))
    ];
    const unique = new Map(items.map(item => [item.key, item]));
    return [...unique.values()].map(item => ({ ...item, title: meta.get(item.key)?.title ?? item.title, hidden: meta.get(item.key)?.hidden ?? false }));
  }

  @Get('assets')
  async listAssets(@Req() req: AuthenticatedRequest, @Query('q') q = '', @Query('kind') kind = '', @Query('offset') offset = '0') {
    const items = (await this.assets(req.authUser.id)).filter(item => !item.hidden && (!kind || item.kind === kind) && item.title.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.key.localeCompare(a.key));
    const start = Math.max(0, Number(offset) || 0);
    return { items: items.slice(start, start + 20), next: start + 20 < items.length ? start + 20 : null };
  }

  @Patch('assets/:key')
  async updateAsset(@Param('key') key: string, @Body() body: AssetDto, @Req() req: AuthenticatedRequest) {
    const subjectMatch = key.match(/^subject:([0-9a-f-]{36})$/i);
    if (subjectMatch) {
      const where = { id: subjectMatch[1], userId: req.authUser.id };
      if (!await this.db.studioSubject.findFirst({ where })) throw new NotFoundException('主体不存在');
      if (body.hidden) await this.db.studioSubject.deleteMany({ where });
      else if (body.title !== undefined) {
        if (!body.title.trim()) throw new BadRequestException('请输入主体名称');
        await this.db.studioSubject.updateMany({ where, data: { name: body.title.trim() } });
      }
      return { ok: true };
    }
    const fileMatch = key.match(/^file:([0-9a-f-]{36})$/i);
    const jobMatch = key.match(/^job:([0-9a-f-]{36}):(\d+)$/i);
    const exists = fileMatch
      ? await this.db.fileRecord.findFirst({ where: { id: fileMatch[1], userId: req.authUser.id }, select: { id: true } })
      : jobMatch
        ? await this.db.imageJob.findFirst({ where: { id: jobMatch[1], userId: req.authUser.id, status: 'succeeded', deletedAt: null }, select: { id: true, outputImages: true } }).then(job => {
          const index = Number(jobMatch[2]);
          return job && Array.isArray(job.outputImages) && index >= 0 && index < job.outputImages.length ? job : null;
        })
        : null;
    if (!exists) throw new NotFoundException('图片不存在');
    await this.db.studioAssetMetadata.upsert({ where: { userId_key: { userId: req.authUser.id, key } }, create: { userId: req.authUser.id, key, ...body }, update: body });
    return { ok: true };
  }
}
