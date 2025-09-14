import { Repository, DataSource, In } from 'typeorm';
import { Campaign } from '../entities/Campaign';


export interface CampaignQueryOptions {
  includeContactGroup?: boolean;
  includeTemplates?: boolean;
  includeSession?: boolean;
  isActive?: boolean;
  status?: string;
}

export class CampaignRepository extends Repository<Campaign> {
  constructor(dataSource: DataSource) {
    super(Campaign, dataSource.createEntityManager());
  }

  async findAllWithRelations(options: CampaignQueryOptions = {}): Promise<Campaign[]> {
    const queryBuilder = this.createQueryBuilder('campaign');

      queryBuilder.leftJoinAndSelect('campaign.contactGroup', 'contactGroup');

      queryBuilder.leftJoinAndSelect('campaign.templates', 'template');

      queryBuilder.leftJoinAndSelect('campaign.session', 'session');

    if (options.isActive !== undefined) {
      queryBuilder.where('campaign.isActive = :isActive', { isActive: options.isActive });
    }

    if (options.status) {
      queryBuilder.andWhere('campaign.status = :status', { status: options.status });
    }

    return queryBuilder.getMany();
  }

  async findByIdWithRelations(id: number, options: CampaignQueryOptions = {}): Promise<Campaign | null> {
    const queryBuilder = this.createQueryBuilder('campaign')
      .where('campaign.id = :id', { id });

    if (options.includeContactGroup) {
      queryBuilder.leftJoinAndSelect('campaign.contactGroup', 'contactGroup');
    }

    if (options.includeTemplates) {
      queryBuilder.leftJoinAndSelect('campaign.templates', 'template');
    }

    if (options.includeSession) {
      queryBuilder.leftJoinAndSelect('campaign.session', 'session');
    }

    return queryBuilder.getOne();
  }

  async findBySessionId(sessionId: number): Promise<Campaign[]> {
    return this.find({
      where: { sessionId },
      relations: ['contactGroup', 'templates']
    });
  }
}
