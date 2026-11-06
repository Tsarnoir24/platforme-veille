import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { safeGet } from '../connectors/utils/safe-http-client';
import { stripHtmlTags } from '../common/utils/strip-html';

export interface DiscoveredSource {
  originalUrl: string;
  resolvedUrl: string;
  detectedType: 'RSS' | 'ATOM' | 'API';
  resolutionMethod: 'PATTERN_MATCH' | 'DIRECT_FEED' | 'DOM_AUTODISCOVERY' | 'HTML_EXTRACTION';
  suggestedTitle?: string;
  suggestedOrganization?: string;
  suggestedCountry?: string;
  suggestedCategory?: string;
  suggestedFrequency?: string;
  message: string;
}

@Injectable()
export class UrlDiscoveryService {
  private readonly logger = new Logger(UrlDiscoveryService.name);

  async resolveSourceUrl(inputUrl: string): Promise<DiscoveredSource> {
    const cleanUrl = inputUrl.trim();
    if (!cleanUrl) {
      throw new BadRequestException("Veuillez saisir l'adresse de la page web à analyser.");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(cleanUrl);
    } catch {
      throw new BadRequestException("L'adresse URL fournie est invalide.");
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new BadRequestException('Utilisez une adresse HTTP ou HTTPS.');
    }

    const host = parsedUrl.hostname.toLowerCase();
    const knownMeta = this.detectDomainMetadata(host);

    // 1. Règles rapides par domaine connu (Pattern Matching : ISO.org, etc.)
    const isoStandardMatch = cleanUrl.match(/iso\.org\/(?:[a-z]{2}\/)?standard\/(\d+)\.html/i);
    if (isoStandardMatch) {
      const rawId = isoStandardMatch[1];
      const id = rawId.padStart(6, '0');
      const part1 = id.slice(0, 2);
      const part2 = id.slice(2, 4);
      const resolvedUrl = `https://www.iso.org/contents/data/standard/${part1}/${part2}/${rawId}.detail.rss`;
      const pageMeta = await this.fetchPageTitleSafely(cleanUrl);

      return {
        originalUrl: cleanUrl,
        resolvedUrl,
        detectedType: 'RSS',
        resolutionMethod: 'PATTERN_MATCH',
        suggestedTitle: pageMeta.title || `Norme ISO (fiche ${rawId})`,
        suggestedOrganization: 'ISO',
        suggestedCountry: 'International',
        suggestedCategory: 'NORMATIF',
        suggestedFrequency: '6h',
        message: 'Flux officiel ISO détecté et converti automatiquement.',
      };
    }

    const isoCommitteeMatch = cleanUrl.match(/iso\.org\/(?:[a-z]{2}\/)?committee\/(\d+)\.html/i);
    if (isoCommitteeMatch) {
      const rawId = isoCommitteeMatch[1];
      const id = rawId.padStart(6, '0');
      const part1 = id.slice(0, 2);
      const part2 = id.slice(2, 4);
      const resolvedUrl = `https://www.iso.org/contents/data/committee/${part1}/${part2}/${rawId}.catalogue.rss`;
      const pageMeta = await this.fetchPageTitleSafely(cleanUrl);

      return {
        originalUrl: cleanUrl,
        resolvedUrl,
        detectedType: 'RSS',
        resolutionMethod: 'PATTERN_MATCH',
        suggestedTitle: pageMeta.title || `Comité technique ISO ${rawId}`,
        suggestedOrganization: 'ISO',
        suggestedCountry: 'International',
        suggestedCategory: 'NORMATIF',
        suggestedFrequency: '6h',
        message: 'Flux officiel du comité ISO détecté et converti automatiquement.',
      };
    }

    if (/^https?:\/\/(www\.)?iso\.org(\/[a-z]{2})?\/?$/i.test(cleanUrl)) {
      return {
        originalUrl: cleanUrl,
        resolvedUrl: 'https://www.iso.org/contents/shared/rss/latest-standards.rss',
        detectedType: 'RSS',
        resolutionMethod: 'PATTERN_MATCH',
        suggestedTitle: 'ISO - Dernières normes publiées',
        suggestedOrganization: 'ISO',
        suggestedCountry: 'International',
        suggestedCategory: 'NORMATIF',
        suggestedFrequency: '6h',
        message: 'Flux général des normes ISO détecté et converti automatiquement.',
      };
    }

    // 2. Inspection HTTP sécurisée (safeGet anti-SSRF)
    let response;
    try {
      response = await safeGet(parsedUrl.toString(), {
        headers: {
          Accept:
            'text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml,text/xml,application/json;q=0.9,*/*;q=0.8',
          'User-Agent': 'VeilleISO17025/1.0',
        },
        timeoutMs: 12000,
      });
    } catch (err) {
      this.logger.warn(`Inspection directe impossible pour ${cleanUrl}: ${err instanceof Error ? err.message : err}`);
      return {
        originalUrl: cleanUrl,
        resolvedUrl: cleanUrl,
        detectedType: 'RSS',
        resolutionMethod: 'HTML_EXTRACTION',
        ...knownMeta,
        suggestedFrequency: '6h',
        message: 'Lien enregistré (lecture directe lors de la collecte).',
      };
    }

    const header = response.headers['content-type'];
    const contentType = (Array.isArray(header) ? header[0] : header || '').toLowerCase();
    const body = await response.text();
    const trimmed = body.replace(/^\uFEFF/, '').trimStart();

    if (
      contentType.includes('application/json') ||
      contentType.includes('application/feed+json') ||
      trimmed.startsWith('{') ||
      trimmed.startsWith('[')
    ) {
      return {
        originalUrl: cleanUrl,
        resolvedUrl: cleanUrl,
        detectedType: host === 'api.crossref.org' ? 'API' : 'RSS',
        resolutionMethod: 'DIRECT_FEED',
        ...knownMeta,
        suggestedFrequency: '6h',
        message: 'Flux JSON / API direct détecté.',
      };
    }

    if (
      contentType.includes('rss') ||
      contentType.includes('atom') ||
      contentType.includes('xml') ||
      /^<\?xml|<rss|<feed/i.test(trimmed)
    ) {
      const isAtom = contentType.includes('atom') || /<feed[\s>]/i.test(trimmed);
      const $xml = cheerio.load(body, { xmlMode: true });
      const xmlTitle = stripHtmlTags($xml('channel > title, feed > title').first().text());
      return {
        originalUrl: cleanUrl,
        resolvedUrl: cleanUrl,
        detectedType: isAtom ? 'ATOM' : 'RSS',
        resolutionMethod: 'DIRECT_FEED',
        suggestedTitle: xmlTitle || knownMeta.suggestedTitle,
        ...knownMeta,
        suggestedFrequency: '6h',
        message: `Flux ${isAtom ? 'Atom' : 'RSS'} direct reconnu.`,
      };
    }

    // 3. Auto-découverte dans le DOM HTML avec Cheerio
    const $ = cheerio.load(body);
    const rawPageTitle =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').first().text() ||
      $('h1').first().text() ||
      '';
    const pageTitle = stripHtmlTags(rawPageTitle);
    const siteName = stripHtmlTags($('meta[property="og:site_name"]').attr('content') || '');

    const alternateAtom = $('link[rel="alternate"][type*="atom" i]').first().attr('href');
    const alternateRss =
      $('link[rel="alternate"][type*="rss" i]').first().attr('href') ||
      $('link[rel="alternate"][type*="xml" i]').first().attr('href');
    const anchorFeed = $(
      'a[href$=".rss"], a[href$=".xml"], a[href*="/rss"], a[href*="/feed"], a[href*="format=rss"]',
    )
      .first()
      .attr('href');

    const discoveredHref = alternateAtom || alternateRss || anchorFeed;
    if (discoveredHref) {
      try {
        const absoluteFeedUrl = new URL(discoveredHref, cleanUrl).toString();
        const isAtom = Boolean(alternateAtom) || /atom/i.test(discoveredHref);
        return {
          originalUrl: cleanUrl,
          resolvedUrl: absoluteFeedUrl,
          detectedType: isAtom ? 'ATOM' : 'RSS',
          resolutionMethod: 'DOM_AUTODISCOVERY',
          suggestedTitle: pageTitle || knownMeta.suggestedTitle,
          suggestedOrganization: siteName || knownMeta.suggestedOrganization,
          suggestedCountry: knownMeta.suggestedCountry,
          suggestedCategory: knownMeta.suggestedCategory,
          suggestedFrequency: '6h',
          message: 'Flux officiel détecté dans la page HTML et converti automatiquement.',
        };
      } catch {
        // Ignore invalid relative feed href and fallback to HTML extraction
      }
    }

    // 4. Fallback : extraction directe des métadonnées et articles HTML via Cheerio
    return {
      originalUrl: cleanUrl,
      resolvedUrl: cleanUrl,
      detectedType: 'RSS',
      resolutionMethod: 'HTML_EXTRACTION',
      suggestedTitle: pageTitle || knownMeta.suggestedTitle || parsedUrl.hostname,
      suggestedOrganization: siteName || knownMeta.suggestedOrganization,
      suggestedCountry: knownMeta.suggestedCountry,
      suggestedCategory: knownMeta.suggestedCategory,
      suggestedFrequency: '6h',
      message:
        'Aucun flux RSS externe requis : la page HTML et ses articles seront extraits directement via Cheerio.',
    };
  }

  private async fetchPageTitleSafely(url: string): Promise<{ title?: string }> {
    try {
      const response = await safeGet(url, {
        headers: { 'User-Agent': 'VeilleISO17025/1.0' },
        timeoutMs: 6000,
      });
      if (!response.ok) return {};
      const html = await response.text();
      const $ = cheerio.load(html);
      const raw =
        $('meta[property="og:title"]').attr('content') ||
        $('title').first().text() ||
        $('h1').first().text();
      return { title: stripHtmlTags(raw) || undefined };
    } catch {
      return {};
    }
  }

  private detectDomainMetadata(host: string): {
    suggestedTitle?: string;
    suggestedOrganization?: string;
    suggestedCountry?: string;
    suggestedCategory?: string;
  } {
    if (host.includes('iso.org')) {
      return {
        suggestedOrganization: 'ISO',
        suggestedCountry: 'International',
        suggestedCategory: 'NORMATIF',
      };
    }
    if (host.includes('anses.fr')) {
      return {
        suggestedOrganization: 'ANSES',
        suggestedCountry: 'France',
        suggestedCategory: 'REGLEMENTAIRE',
      };
    }
    if (host.includes('efsa.europa.eu')) {
      return {
        suggestedOrganization: 'EFSA',
        suggestedCountry: 'Union européenne',
        suggestedCategory: 'REGLEMENTAIRE',
      };
    }
    if (host.includes('cofrac.fr')) {
      return {
        suggestedOrganization: 'COFRAC',
        suggestedCountry: 'France',
        suggestedCategory: 'ACCREDITATION',
      };
    }
    if (host.includes('inrs.fr')) {
      return {
        suggestedOrganization: 'INRS',
        suggestedCountry: 'France',
        suggestedCategory: 'REGLEMENTAIRE',
      };
    }
    if (host.includes('nature.com')) {
      return {
        suggestedOrganization: 'Nature Publishing Group',
        suggestedCountry: 'International',
        suggestedCategory: 'SCIENTIFIQUE',
      };
    }
    if (host.includes('plos.org')) {
      return {
        suggestedOrganization: 'Public Library of Science',
        suggestedCountry: 'International',
        suggestedCategory: 'SCIENTIFIQUE',
      };
    }
    if (host.includes('sciencedaily.com')) {
      return {
        suggestedOrganization: 'ScienceDaily',
        suggestedCountry: 'International',
        suggestedCategory: 'ENVIRONNEMENT',
      };
    }
    return {};
  }
}
