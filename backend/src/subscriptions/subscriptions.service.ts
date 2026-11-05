import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { User } from '../users/entities/user.entity';
import { Topic } from '../taxonomy/entities/topic.entity';
import { Source } from '../sources/entities/source.entity';
import { Keyword } from '../taxonomy/entities/keyword.entity';
import { Domain } from '../taxonomy/entities/domain.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription) private repo: Repository<Subscription>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Topic) private topics: Repository<Topic>,
    @InjectRepository(Source) private sources: Repository<Source>,
    @InjectRepository(Keyword) private keywords: Repository<Keyword>,
    @InjectRepository(Domain) private domains: Repository<Domain>,
  ) {}

  async options() {
    const [sources, topics, domains, keywords] = await Promise.all([
      this.sources.find({
        where: { active: true },
        select: { id: true, name: true },
        order: { name: 'ASC' },
      }),
      this.topics.find({
        select: { id: true, label: true },
        order: { label: 'ASC' },
      }),
      this.domains.find({
        where: { active: true },
        select: { id: true, name: true },
        order: { name: 'ASC' },
      }),
      this.keywords.find({
        where: { active: true },
        select: { id: true, label: true },
        order: { label: 'ASC' },
      }),
    ]);

    return { sources, topics, domains, keywords };
  }

  async create(userId: number, dto: CreateSubscriptionDto) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    const s = this.repo.create({
      subscriptionType: dto.subscriptionType,
      channel: dto.channel,
      active: true,
      user,
      topic: null,
      source: null,
      keyword: null,
      domain: null,
    });
    if (dto.subscriptionType === 'TOPIC' && dto.topicId)
      s.topic = await this.topics.findOne({ where: { id: dto.topicId } });
    if (dto.subscriptionType === 'SOURCE' && dto.sourceId)
      s.source = await this.sources.findOne({ where: { id: dto.sourceId } });
    if (dto.subscriptionType === 'KEYWORD' && dto.keywordId)
      s.keyword = await this.keywords.findOne({ where: { id: dto.keywordId } });
    if (dto.subscriptionType === 'DOMAIN' && dto.domainId)
      s.domain = await this.domains.findOne({ where: { id: dto.domainId } });
    if (!s.topic && !s.source && !s.keyword && !s.domain)
      throw new BadRequestException(
        'La cible de l’abonnement est obligatoire.',
      );

    const existing = await this.repo.findOne({
      where: {
        user: { id: userId },
        subscriptionType: dto.subscriptionType,
        channel: dto.channel,
        ...(s.topic ? { topic: { id: s.topic.id } } : {}),
        ...(s.source ? { source: { id: s.source.id } } : {}),
        ...(s.keyword ? { keyword: { id: s.keyword.id } } : {}),
        ...(s.domain ? { domain: { id: s.domain.id } } : {}),
      },
    });
    if (existing) {
      if (existing.active) {
        const channelName =
          dto.channel === 'EMAIL' ? 'par e-mail' : 'dans l’application';
        throw new ConflictException(
          `Cet abonnement est déjà actif ${channelName}.`,
        );
      }
      existing.active = true;
      return this.repo.save(existing);
    }

    return this.repo.save(s);
  }
  async list(userId: number) {
    const items = await this.repo.find({
      where: { user: { id: userId } },
      relations: { topic: true, source: true, keyword: true, domain: true },
      order: { id: 'ASC' },
    });
    const seen = new Set<string>();
    const unique: Subscription[] = [];
    const duplicateIds: number[] = [];
    for (const item of items) {
      const targetId =
        item.source?.id ??
        item.topic?.id ??
        item.domain?.id ??
        item.keyword?.id ??
        0;
      const key = `${item.subscriptionType}:${targetId}:${item.channel}`;
      if (seen.has(key)) {
        duplicateIds.push(item.id);
      } else {
        seen.add(key);
        unique.push(item);
      }
    }
    if (duplicateIds.length > 0) {
      await this.repo.delete(duplicateIds);
    }
    return unique;
  }
  async remove(userId: number, id: number) {
    const s = await this.repo.findOne({ where: { id, user: { id: userId } } });
    if (!s) throw new NotFoundException('Abonnement introuvable');
    await this.repo.remove(s);
    return { success: true };
  }
}
