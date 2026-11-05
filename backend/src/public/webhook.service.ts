import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac } from 'node:crypto';
import { WatchItem } from '../watch-items/entities/watch-item.entity';
import { WatchItemPublishedEvent } from '../notifications/events/watch-item-published.event';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(WatchItem)
    private readonly watchItemRepository: Repository<WatchItem>,
  ) {}

  /**
   * Écoute automatique de l'événement interne émis lors de la publication d'une veille.
   */
  @OnEvent('watch-item.published')
  async handleWatchItemPublished(event: WatchItemPublishedEvent): Promise<void> {
    const webhookUrlsRaw = process.env.WEBHOOK_SUBSCRIBERS_URLS?.trim();
    if (!webhookUrlsRaw) {
      return; // Aucun webhook configuré
    }

    const item = await this.watchItemRepository.findOne({
      where: { id: event.watchItemId },
      relations: {
        source: true,
        laboratories: true,
        domains: true,
      },
    });

    if (!item) {
      this.logger.warn(
        `Webhook ignoré : veille introuvable pour l'id ${event.watchItemId}`,
      );
      return;
    }

    const payload = {
      event: 'watch_item.published',
      timestamp: new Date().toISOString(),
      data: {
        id: item.id,
        title: item.title,
        summary: item.summary,
        url: item.url,
        doi: item.doi,
        watchType: item.watchType,
        criticality: item.criticality,
        relevance: item.relevance,
        publishedAt: item.publishedAt,
        source: item.source?.name,
        laboratories: item.laboratories?.map((l) => l.name) || [],
        domains: item.domains?.map((d) => d.name) || [],
      },
    };

    const payloadString = JSON.stringify(payload);
    const secret = process.env.WEBHOOK_SECRET || '';
    const signature = secret
      ? createHmac('sha256', secret).update(payloadString).digest('hex')
      : null;

    const urls = webhookUrlsRaw
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    for (const url of urls) {
      this.dispatchWebhook(url, payloadString, signature, item.id);
    }
  }

  /**
   * Envoi asynchrone du webhook avec signature HMAC.
   * Ne bloque jamais le workflow principal en cas d'échec du destinataire.
   */
  private async dispatchWebhook(
    url: string,
    body: string,
    signature: string | null,
    itemId: number,
  ): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'PlateformeVeille-Webhook/1.0',
      };

      if (signature) {
        headers['X-Webhook-Signature'] = `sha256=${signature}`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (response.ok) {
        this.logger.log(
          `Webhook délivré avec succès à ${url} pour la veille #${itemId} (statut: ${response.status})`,
        );
      } else {
        this.logger.warn(
          `Échec délivrance webhook à ${url} pour veille #${itemId} : statut ${response.status}`,
        );
      }
    } catch (error: any) {
      this.logger.error(
        `Erreur réseau webhook vers ${url} pour la veille #${itemId} : ${error?.message || error}`,
      );
    }
  }
}
