import { Global, Module } from '@nestjs/common';
import { RedisQueueService } from './redis-queue.service';

@Global()
@Module({
  providers: [RedisQueueService],
  exports: [RedisQueueService]
})
export class QueueModule {}
