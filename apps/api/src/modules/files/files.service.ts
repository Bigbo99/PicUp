import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ObjectStorageService } from '../../common/object-storage.service';
import { StorageService } from '../../common/storage.service';
import type { AuthUser, UploadedFileRecord } from '@picup/shared';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const allowedUploadMimeTypes = allowedMimeTypes;
export const maxUploadFileSize = 10 * 1024 * 1024;

@Injectable()
export class FilesService {
  constructor(
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(ObjectStorageService) private readonly objectStorage: ObjectStorageService
  ) {}

  async saveUploadedFile(file: Express.Multer.File, user: AuthUser, purpose: 'user' | 'system' = 'user'): Promise<UploadedFileRecord> {
    if (!file) throw new BadRequestException('Please choose an image to upload');
    if (!allowedMimeTypes.has(file.mimetype)) {
      throw new BadRequestException('Only JPG, PNG, and WEBP images are supported');
    }
    if (file.size > maxUploadFileSize) {
      throw new BadRequestException('Image cannot exceed 10MB');
    }

    const id = randomUUID();
    const buffer = file.buffer ?? (file.path ? await readFile(file.path) : null);
    if (!buffer) throw new BadRequestException('Image upload failed');
    const detected = this.detectImageType(buffer);
    if (!detected) {
      throw new BadRequestException('无法识别图片内容，请将原图导出为 JPG、PNG 或 WebP 后重试');
    }
    const extension = detected.extension;
    const hash = purpose === 'system' ? createHash('sha256').update('system:').update(buffer).digest('hex') : this.hashBuffer(buffer);
    const existing = await this.storage.findFileByHash(hash, user.id);
    if (existing) return existing;
    const url = await this.objectStorage.save('inputs', `${hash}${extension}`, buffer, detected.mimeType);

    return this.storage.addFile({
      purpose,
      id,
      userId: user.id,
      hash,
      url,
      mimeType: detected.mimeType,
      size: file.size,
      createdAt: new Date().toISOString()
    });
  }

  async readPrivateInput(filename: string, user: AuthUser) {
    if (!/^[a-f0-9]{64}\.(?:jpg|jpeg|png|webp)$/i.test(filename)) {
      throw new NotFoundException('Image not found');
    }
    const file = await this.storage.getFileByInputFilename(filename, user.id);
    if (!file || file.purpose === 'system') throw new NotFoundException('Image not found');
    return {
      body: await this.objectStorage.readByUrl(file.url),
      mimeType: file.mimeType
    };
  }

  async readForUser(id: string, user: AuthUser) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new NotFoundException('Image not found');
    const [file] = await this.storage.getFiles([id], user.id);
    if (!file || file.purpose === 'system') throw new NotFoundException('Image not found');
    return { body: await this.objectStorage.readByUrl(file.url), mimeType: file.mimeType };
  }

  private detectImageType(buffer: Buffer) {
    if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return { mimeType: 'image/jpeg', extension: '.jpg' };
    }
    if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return { mimeType: 'image/png', extension: '.png' };
    }
    if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      return { mimeType: 'image/webp', extension: '.webp' };
    }
    return null;
  }

  private hashBuffer(buffer: Buffer) {
    return createHash('sha256').update(buffer).digest('hex');
  }
}
