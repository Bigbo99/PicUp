import { Global, Module } from '@nestjs/common';
import { StorageService } from '../storage.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService, StorageService],
  exports: [PrismaService, StorageService]
})
export class DatabaseModule {}
