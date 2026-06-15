import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { ObjectStorageService } from '../../common/object-storage.service';
import { StorageService } from '../../common/storage.service';
import type { AuthUser, UploadedFileRecord } from '@picup/shared';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxFileSize = 10 * 1024 * 1024;

@Injectable()
export class FilesService {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(ObjectStorageService) private readonly objectStorage: ObjectStorageService
  ) {}

  async saveUploadedFile(file: Express.Multer.File, user: AuthUser): Promise<UploadedFileRecord> {
    if (!file) throw new BadRequestException('Please choose an image to upload');
    if (!allowedMimeTypes.has(file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG, and WEBP images are supported');
    }
    if (file.size > maxFileSize) {
      throw new BadRequestException('Image cannot exceed 10MB');
    }

    const id = randomUUID();
    const extension = this.extensionFor(file);
    const buffer = file.buffer ?? (file.path ? await readFile(file.path) : null);
    if (!buffer) throw new BadRequestException('Image upload failed');
    const hash = this.hashBuffer(buffer);
    const existing = await this.storage.findFileByHash(hash, user.id);
    if (existing) return existing;
    const url = await this.objectStorage.save('inputs', `${hash}${extension}`, buffer, file.mimetype);

    return this.storage.addFile({
      id,
      userId: user.id,
      hash,
      url,
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

  private hashBuffer(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }
}
