import { Module } from '@nestjs/common';
import { FilesController, PrivateInputMediaController } from './files.controller';
import { FilesService } from './files.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [FilesController, PrivateInputMediaController],
  providers: [FilesService],
  exports: [FilesService]
})
export class FilesModule {}
