import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Source } from './entities/source.entity';

import { SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';
import { UrlDiscoveryService } from './url-discovery.service';
import { AuditModule } from '../audit/audit.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { CollectionModule } from '../collection/collection.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([Source]),
    AuditModule,
    ConnectorsModule,
    CollectionModule,
  ],

  controllers: [SourcesController],

  providers: [SourcesService, UrlDiscoveryService],

  exports: [SourcesService, UrlDiscoveryService, TypeOrmModule],
})
export class SourcesModule {}
