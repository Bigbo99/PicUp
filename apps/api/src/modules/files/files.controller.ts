import { Controller, Get, Inject, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { FilesService, allowedUploadMimeTypes, maxUploadFileSize } from './files.service';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';

@Controller('api/files')
@UseGuards(AuthGuard)
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: maxUploadFileSize, files: 1, fields: 0 },
    fileFilter: (_req, file, callback) => {
      callback(null, allowedUploadMimeTypes.has(file.mimetype));
    }
  }))
  upload(@UploadedFile() file: Express.Multer.File, @Req() req: AuthenticatedRequest) {
    return this.files.saveUploadedFile(file, req.authUser);
  }

  @Get(':id/content')
  async content(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const file = await this.files.readForUser(id, req.authUser);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.body);
  }
}

@Controller('media/inputs')
@UseGuards(AuthGuard)
export class PrivateInputMediaController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Get(':filename')
  async read(
    @Param('filename') filename: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response
  ) {
    const file = await this.files.readPrivateInput(filename, req.authUser);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.body.length));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.body);
  }
}
