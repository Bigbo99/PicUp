import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from '../object-storage.service';
import { StorageService } from '../storage.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, StorageService, ObjectStorageService],
  exports: [PrismaService, StorageService, ObjectStorageService]
})
export class DatabaseModule {}
