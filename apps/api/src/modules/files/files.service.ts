import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { copyFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ensureStorage, publicMediaUrl } from '../../common/storage-paths';
import { StorageService } from '../../common/storage.service';
import type { AuthUser, UploadedFileRecord } from '@picup/shared';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxFileSize = 10 * 1024 * 1024;

@Injectable()
export class FilesService {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  async saveUploadedFile(file: Express.Multer.File, user: AuthUser): Promise<UploadedFileRecord> {
    if (!file) throw new BadRequestException('请选择要上传的图片');
    if (!allowedMimeTypes.has(file.mimetype)) {
      throw new BadRequestException('仅支持 JPG、PNG、WEBP 图片');
    }
    if (file.size > maxFileSize) {
      throw new BadRequestException('图片不能超过 10MB');
    }

    const paths = await ensureStorage();
    const id = randomUUID();
    const extension = this.extensionFor(file);
    const filename = `${id}${extension}`;
    const target = resolve(paths.inputs, filename);

    if (file.buffer) {
      await writeFile(target, file.buffer);
    } else if (file.path) {
      await copyFile(file.path, target);
    } else {
      throw new BadRequestException('图片上传失败');
    }

    return this.storage.addFile({
      id,
      userId: user.id,
      url: publicMediaUrl('inputs', filename),
      mimeType: file.mimetype,
      size: file.size,
      createdAt: new Date().toISOString()
    });
  }

  private extensionFor(file: Express.Multer.File) {
    const ext = extname(file.originalname).toLowerCase();
    if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return ext;
    if (file.mimetype === 'image/png') return '.png';
    if (file.mimetype === 'image/webp') return '.webp';
    return '.jpg';
  }
}
