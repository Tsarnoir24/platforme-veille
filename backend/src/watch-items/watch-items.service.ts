import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';

import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { Source } from '../sources/entities/source.entity';

import { WatchItem } from './entities/watch-item.entity';

import { WatchVersion } from './entities/watch-version.entity';

import { DeduplicationService } from './deduplication.service';

import { NormalizedWatchItem } from './interfaces/normalized-watch-item.interface';
import { AiAnalysisService } from '../ai/ai-analysis.service';
import { stripHtmlNullable, stripHtmlTags } from '../common/utils/strip-html';

export type IngestionResult = 'CREE' | 'MIS_A_JOUR' | 'DOUBLON';

@Injectable()
export class WatchItemsService implements OnModuleInit {
  constructor(
    @InjectRepository(WatchItem)
    private readonly watchItemRepository: Repository<WatchItem>,

    @InjectRepository(WatchVersion)
    private readonly versionRepository: Repository<WatchVersion>,

    private readonly deduplicationService: DeduplicationService,
    private readonly aiAnalysis: AiAnalysisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.sanitizeExistingHtmlTags();
  }

  private sanitizeItemFields<T extends Partial<WatchItem>>(item: T): T {
    if (typeof item.title === 'string') {
      item.title = stripHtmlTags(item.title) || item.title;
    }
    if (typeof item.originalTitle === 'string') {
      item.originalTitle = stripHtmlTags(item.originalTitle) || item.originalTitle;
    }
    if (typeof item.frenchTitle === 'string') {
      item.frenchTitle = stripHtmlNullable(item.frenchTitle);
    }
    if (typeof item.englishTitle === 'string') {
      item.englishTitle = stripHtmlNullable(item.englishTitle);
    }
    if (typeof item.summary === 'string') {
      item.summary = stripHtmlNullable(item.summary);
    }
    if (typeof item.originalSummary === 'string') {
      item.originalSummary = stripHtmlNullable(item.originalSummary);
    }
    if (typeof item.frenchSummary === 'string') {
      item.frenchSummary = stripHtmlNullable(item.frenchSummary);
    }
    if (typeof item.englishSummary === 'string') {
      item.englishSummary = stripHtmlNullable(item.englishSummary);
    }
    return item;
  }

  async sanitizeExistingHtmlTags(): Promise<void> {
    try {
      const dirtyItems = await this.watchItemRepository
        .createQueryBuilder('item')
        .where(
          "item.title ~ '<[a-zA-Z/]' OR item.title ~ '&lt;[a-zA-Z/]' OR " +
          "COALESCE(item.original_title, '') ~ '<[a-zA-Z/]' OR COALESCE(item.original_title, '') ~ '&lt;[a-zA-Z/]' OR " +
          "COALESCE(item.french_title, '') ~ '<[a-zA-Z/]' OR COALESCE(item.french_title, '') ~ '&lt;[a-zA-Z/]' OR " +
          "COALESCE(item.english_title, '') ~ '<[a-zA-Z/]' OR COALESCE(item.english_title, '') ~ '&lt;[a-zA-Z/]' OR " +
          "COALESCE(item.summary, '') ~ '<[a-zA-Z/]' OR COALESCE(item.summary, '') ~ '&lt;[a-zA-Z/]' OR " +
          "COALESCE(item.original_summary, '') ~ '<[a-zA-Z/]' OR COALESCE(item.original_summary, '') ~ '&lt;[a-zA-Z/]' OR " +
          "COALESCE(item.french_summary, '') ~ '<[a-zA-Z/]' OR COALESCE(item.french_summary, '') ~ '&lt;[a-zA-Z/]' OR " +
          "COALESCE(item.english_summary, '') ~ '<[a-zA-Z/]' OR COALESCE(item.english_summary, '') ~ '&lt;[a-zA-Z/]'",
        )
        .getMany();

      if (dirtyItems.length > 0) {
        for (const item of dirtyItems) {
          this.sanitizeItemFields(item);
        }
        await this.watchItemRepository.save(dirtyItems);
      }

      // Also clean notifications messages that might contain <i>...</i> from watch item titles
      await this.watchItemRepository.manager.query(
        `UPDATE notifications
         SET message = BTRIM(REGEXP_REPLACE(REGEXP_REPLACE(message, '&lt;/?[a-zA-Z][^&]*&gt;', '', 'g'), '</?[a-zA-Z][^>]*>', '', 'g'))
         WHERE message ~ '</?[a-zA-Z]' OR message ~ '&lt;/?[a-zA-Z]'`,
      );
    } catch {
      // Ignore if table does not exist yet during unit tests
    }
  }

  async isUnchanged(normalized: NormalizedWatchItem): Promise<boolean> {
    const existing = await this.deduplicationService.findExisting(normalized);
    if (!existing) return false;
    if (existing.source && existing.source.id !== normalized.sourceId) {
      return true;
    }
    if (existing.fingerprint !== normalized.fingerprint) return false;
    return Boolean(existing.originalTitle) &&
      (!normalized.summary || Boolean(existing.originalSummary));
  }

  async ingest(
    source: Source,
    normalized: NormalizedWatchItem,
  ): Promise<IngestionResult> {
    const existing = await this.deduplicationService.findExisting(normalized);

    if (!existing) {
      const watchItem = this.watchItemRepository.create({
        externalId: normalized.externalId,

        doi: normalized.doi,

        title: normalized.title,

        originalTitle: normalized.originalTitle ?? normalized.title,
        originalSummary: normalized.originalSummary ?? normalized.summary,
        originalLanguage: normalized.originalLanguage ?? normalized.language,
        frenchTitle: normalized.frenchTitle ?? null,
        frenchSummary: normalized.frenchSummary ?? null,

        summary: normalized.summary,

        url: normalized.url,

        canonicalUrl: normalized.canonicalUrl,

        publishedAt: normalized.publishedAt,

        collectedAt: normalized.collectedAt,

        language: normalized.language,

        watchType: normalized.watchType,

        status: normalized.status,

        fingerprint: normalized.fingerprint,

        source,
      });

      const saved = await this.watchItemRepository.save(watchItem);

      await this.createVersion(saved, normalized);
      this.aiAnalysis.scheduleAutomaticAnalysis(saved.id);
      return 'CREE';
    }

    if (existing.source && existing.source.id !== source.id) {
      return 'DOUBLON';
    }

    if (existing.fingerprint === normalized.fingerprint) {
      if (!existing.originalTitle || (normalized.summary && !existing.originalSummary)) {
        existing.originalTitle = normalized.originalTitle ?? normalized.title;
        existing.originalSummary = normalized.originalSummary ?? normalized.summary;
        existing.originalLanguage = normalized.originalLanguage ?? normalized.language;
        existing.frenchTitle = normalized.frenchTitle ?? existing.frenchTitle;
        existing.frenchSummary = normalized.frenchSummary ?? existing.frenchSummary;
        existing.language = normalized.language ?? existing.language;
        const saved = await this.watchItemRepository.save(existing);
        await this.createVersion(saved, normalized);
        this.aiAnalysis.scheduleAutomaticAnalysis(saved.id);
        return 'MIS_A_JOUR';
      }
      return 'DOUBLON';
    }

    existing.externalId = normalized.externalId;

    existing.doi = normalized.doi;

    existing.title = normalized.title;

    existing.originalTitle = normalized.originalTitle ?? normalized.title;
    existing.originalSummary = normalized.originalSummary ?? normalized.summary;
    existing.originalLanguage = normalized.originalLanguage ?? normalized.language;
    existing.frenchTitle = normalized.frenchTitle ?? null;
    existing.frenchSummary = normalized.frenchSummary ?? null;

    existing.summary = normalized.summary;

    existing.url = normalized.url;

    existing.canonicalUrl = normalized.canonicalUrl;

    existing.publishedAt = normalized.publishedAt;

    existing.collectedAt = normalized.collectedAt;

    existing.language = normalized.language;

    existing.watchType = normalized.watchType;

    existing.fingerprint = normalized.fingerprint;
    existing.englishTitle = null;
    existing.englishSummary = null;

    const saved = await this.watchItemRepository.save(existing);

    await this.createVersion(saved, normalized);
    this.aiAnalysis.scheduleAutomaticAnalysis(saved.id);

    return 'MIS_A_JOUR';
  }

  private async createVersion(
    watchItem: WatchItem,
    normalized: NormalizedWatchItem,
  ) {
    const version = this.versionRepository.create({
      hash: normalized.fingerprint,

      payloadSnapshot: {
        externalId: normalized.externalId,

        doi: normalized.doi,

        title: normalized.title,

        originalTitle: normalized.originalTitle ?? null,
        originalSummary: normalized.originalSummary ?? null,
        originalLanguage: normalized.originalLanguage ?? normalized.language,
        frenchTitle: normalized.frenchTitle ?? null,
        frenchSummary: normalized.frenchSummary ?? null,

        summary: normalized.summary,

        url: normalized.url,

        canonicalUrl: normalized.canonicalUrl,

        publishedAt: normalized.publishedAt?.toISOString() ?? null,

        language: normalized.language,

        watchType: normalized.watchType,
      },

      watchItem,
    });

    await this.versionRepository.save(version);
  }

  async findAll() {
    const items = await this.watchItemRepository.find({
      relations: {
        source: true,
      },

      order: {
        collectedAt: 'DESC',
      },

      take: 100,
    });
    return items.map((item) => this.sanitizeItemFields(item));
  }

  async findOne(id: number) {
    const item = await this.watchItemRepository.findOne({
      where: { id },

      relations: {
        source: true,
        versions: true,
      },
    });

    if (!item) {
      throw new NotFoundException('Élément de veille introuvable');
    }

    return this.sanitizeItemFields(item);
  }

  async saveEnglishTranslation(id: number, translation: { title: string; summary: string | null }) {
    const item = await this.findOne(id);
    item.englishTitle = translation.title;
    item.englishSummary = translation.summary;
    return this.watchItemRepository.save(item);
  }

  async findItemsMissingFrenchTranslation(limit = 10) {
    return this.watchItemRepository.createQueryBuilder('item')
      .where("(item.frenchTitle IS NULL OR BTRIM(item.frenchTitle) = '')")
      .orWhere("(item.summary IS NOT NULL AND BTRIM(item.summary) <> '' AND (item.frenchSummary IS NULL OR BTRIM(item.frenchSummary) = ''))")
      .orderBy('item.createdAt', 'ASC')
      .addOrderBy('item.id', 'ASC')
      .take(limit)
      .getMany();
  }

  async countItemsMissingFrenchTranslation() {
    return this.watchItemRepository.createQueryBuilder('item')
      .where("(item.frenchTitle IS NULL OR BTRIM(item.frenchTitle) = '')")
      .orWhere("(item.summary IS NOT NULL AND BTRIM(item.summary) <> '' AND (item.frenchSummary IS NULL OR BTRIM(item.frenchSummary) = ''))")
      .getCount();
  }

  async saveFrenchTranslation(id: number, translation: {
    title: string;
    summary: string | null;
    originalTitle: string;
    originalSummary: string | null;
    originalLanguage: string | null;
    frenchTitle: string | null;
    frenchSummary: string | null;
  }) {
    const item = await this.findOne(id);
    item.originalTitle ??= translation.originalTitle;
    item.originalSummary ??= translation.originalSummary;
    item.originalLanguage ??= translation.originalLanguage;
    item.frenchTitle = translation.frenchTitle;
    item.frenchSummary = translation.frenchSummary;
    item.title = translation.frenchTitle ?? translation.title;
    item.summary = translation.frenchSummary ?? translation.summary;
    return this.watchItemRepository.save(item);
  }

  async findOneForRoles(id: number, roles: string[]) {
    const item = await this.findOne(id);
    const hasInternalRole = [
      'ADMIN',
      'RESPONSABLE_VEILLE',
      'REFERENT_LABORATOIRE',
      'OPERATEUR_VEILLE',
    ].some((role) => roles.includes(role));

    if (!hasInternalRole && item.status !== 'PUBLIE') {
      throw new NotFoundException('Élément de veille introuvable');
    }

    return item;
  }
}
