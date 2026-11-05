import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchItem } from '../watch-items/entities/watch-item.entity';
import { PublicWatchController } from './public-watch.controller';
import { WebhookService } from './webhook.service';

@Module({
  imports: [TypeOrmModule.forFeature([WatchItem])],
  controllers: [PublicWatchController],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class PublicApiModule {}

