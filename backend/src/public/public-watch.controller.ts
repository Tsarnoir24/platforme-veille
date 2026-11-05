import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { WatchItem } from '../watch-items/entities/watch-item.entity';
import { PublicWatchQueryDto } from './dto/public-watch-query.dto';

@Controller('api/v1/public/watch-items')
export class PublicWatchController {
  constructor(
    @InjectRepository(WatchItem)
    private readonly watchItemRepository: Repository<WatchItem>,
  ) {}

  /**
   * Consultation publique des veilles validées et publiées.
   * Aucune authentification requise, filtrage strict sur PUBLIE.
   * Protégé contre les abus par limitation de débit (60 req/min).
   */
  @Get()
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  async getPublishedWatchItems(@Query() query: PublicWatchQueryDto) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 50);
    const skip = (page - 1) * limit;

    const qb = this.watchItemRepository
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.source', 'source')
      .leftJoinAndSelect('item.laboratories', 'laboratory')
      .leftJoinAndSelect('item.domains', 'domain')
      .leftJoinAndSelect('item.topicLinks', 'topicLink')
      .leftJoinAndSelect('topicLink.topic', 'topic')
      .leftJoinAndSelect('item.keywordLinks', 'keywordLink')
      .leftJoinAndSelect('keywordLink.keyword', 'keyword')
      .where('item.status = :status', { status: 'PUBLIE' });

    if (query.search?.trim()) {
      qb.andWhere(
        '(LOWER(item.title) LIKE :s OR LOWER(item.summary) LIKE :s)',
        { s: `%${query.search.trim().toLowerCase()}%` },
      );
    }

    if (query.laboratory?.trim()) {
      qb.andWhere('LOWER(laboratory.name) = :lab', {
        lab: query.laboratory.trim().toLowerCase(),
      });
    }

    if (query.domain?.trim()) {
      qb.andWhere('LOWER(domain.name) = :dom', {
        dom: query.domain.trim().toLowerCase(),
      });
    }

    qb.orderBy('item.publishedAt', 'DESC')
      .addOrderBy('item.id', 'DESC')
      .skip(skip)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      data: items.map((item) => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        url: item.url,
        doi: item.doi,
        watchType: item.watchType,
        criticality: item.criticality,
        relevance: item.relevance,
        publishedAt: item.publishedAt,
        source: {
          id: item.source?.id,
          name: item.source?.name,
          category: item.source?.category,
        },
        laboratories: item.laboratories?.map((l) => l.name) || [],
        domains: item.domains?.map((d) => d.name) || [],
        topics: item.topicLinks?.map((tl) => tl.topic?.label).filter(Boolean) || [],
        keywords: item.keywordLinks?.map((kl) => kl.keyword?.label).filter(Boolean) || [],
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Consultation unitaire d'une veille publiée par son identifiant.
   */
  @Get(':id')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  async getPublishedWatchItemById(@Param('id', ParseIntPipe) id: number) {
    const item = await this.watchItemRepository.findOne({
      where: { id, status: 'PUBLIE' },
      relations: {
        source: true,
        laboratories: true,
        domains: true,
        topicLinks: { topic: true },
        keywordLinks: { keyword: true },
      },
    });

    if (!item) {
      throw new NotFoundException(
        `Veille introuvable ou non publiée pour l'identifiant ${id}`,
      );
    }

    return {
      id: item.id,
      title: item.title,
      summary: item.summary,
      originalTitle: item.originalTitle,
      originalSummary: item.originalSummary,
      originalLanguage: item.originalLanguage,
      url: item.url,
      doi: item.doi,
      watchType: item.watchType,
      criticality: item.criticality,
      relevance: item.relevance,
      collectedAt: item.collectedAt,
      publishedAt: item.publishedAt,
      source: {
        id: item.source?.id,
        name: item.source?.name,
        category: item.source?.category,
      },
      laboratories: item.laboratories?.map((l) => l.name) || [],
      domains: item.domains?.map((d) => d.name) || [],
      topics: item.topicLinks?.map((tl) => tl.topic?.label).filter(Boolean) || [],
      keywords: item.keywordLinks?.map((kl) => kl.keyword?.label).filter(Boolean) || [],
    };
  }
}
