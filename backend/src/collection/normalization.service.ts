import { Injectable } from '@nestjs/common';

import { createHash } from 'crypto';

import { ExternalItem } from '../connectors/interfaces/connector.interface';

import { Source } from '../sources/entities/source.entity';

import { NormalizedWatchItem } from '../watch-items/interfaces/normalized-watch-item.interface';
import { stripHtmlTags } from '../common/utils/strip-html';

@Injectable()
export class NormalizationService {
  normalize(source: Source, item: ExternalItem): NormalizedWatchItem {
    const title = this.cleanText(item.title) || 'Sans titre';

    const summary = this.cleanText(item.summary);

    const doi = this.normalizeDoi(item.doi);

    const safeUrl = this.httpUrl(item.url);
    const canonicalUrl = this.canonicalizeUrl(safeUrl);

    const fingerprint = this.createFingerprint({
      title,
      summary,
      doi,
      canonicalUrl,
      publishedAt: item.publishedAt,
    });

    return {
      sourceId: source.id,

      externalId: item.externalId?.trim() || null,

      doi,

      title,

      summary: summary || null,

      url: safeUrl,

      canonicalUrl,

      publishedAt: item.publishedAt ?? null,

      collectedAt: new Date(),

      language: item.language?.trim() || null,

      watchType: source.category,

      status: 'NOUVEAU',

      fingerprint,
    };
  }

  private cleanText(value?: string): string {
    return stripHtmlTags(value);
  }

  private normalizeDoi(doi?: string): string | null {
    if (!doi) {
      return null;
    }

    return doi
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  }

  private httpUrl(value?: string): string | null {
    if (!value) return null;
    try {
      const url = new URL(value.trim());
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
          url.username || url.password) return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  private canonicalizeUrl(value: string | null): string | null {
    if (!value) {
      return null;
    }

    try {
      const url = new URL(value);

      const trackingParams = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'fbclid',
        'gclid',
      ];

      for (const parameter of trackingParams) {
        url.searchParams.delete(parameter);
      }

      url.hash = '';

      // Normalisation des URLs multi-langues ISO pour éviter les doublons entre flux (/en/, /fr/, etc.)
      if (/(^|\.)iso\.org$/i.test(url.hostname)) {
        url.pathname = url.pathname
          .replace(
            /^\/cms\/render\/live\/[a-z]{2}\/sites\/isoorg\/contents\/data\/standard\/\d+\/\d+\/(\d+)\.html$/i,
            '/standard/$1.html',
          )
          .replace(
            /^\/cms\/render\/live\/[a-z]{2}\/sites\/isoorg\/contents\/data\/committee\/\d+\/\d+\/(\d+)\.html$/i,
            '/committee/$1.html',
          )
          .replace(/^\/[a-z]{2}\/(standard|committee)\/(\d+\.html)$/i, '/$1/$2')
          .replace(/^\/[a-z]{2}\/(contents\/data\/.+)$/i, '/$1');
      }

      return url.toString().replace(/\/$/, '');
    } catch {
      return null;
    }
  }

  private createFingerprint(data: {
    title: string;
    summary: string;
    doi: string | null;
    canonicalUrl: string | null;
    publishedAt?: Date;
  }): string {
    const value = [
      data.title.toLowerCase(),
      data.summary.toLowerCase(),
      data.doi ?? '',
      data.canonicalUrl ?? '',
      data.publishedAt?.toISOString() ?? '',
    ].join('|');

    return createHash('sha256').update(value).digest('hex');
  }
}
