import { Repository, DataSource, In, DeepPartial } from 'typeorm';
import { CampaignRepository } from '../repositories/CampaignRepository';
import { Campaign } from '../entities/Campaign';
import { Contact, ContactGroup } from '../entities/Contact';
import { MessageTemplate } from '../entities/MessageTemplate';
import { Session } from '../entities/Session';

// DTOs for Campaign operations
export interface CreateCampaignDto {
  name: string;
  description?: string;
  minIntervalMinutes?: number;
  maxIntervalMinutes?: number;
  sessionId?: number;
  groupId?: number;
  templateIds?: number[];
}

export interface UpdateCampaignDto {
  name?: string;
  description?: string;
  minIntervalMinutes?: number;
  maxIntervalMinutes?: number;
  sessionId?: number;
  groupId?: number;
  templateIds?: number[];
}

export interface CampaignQueryOptions {
  includeContactGroup?: boolean;
  includeTemplates?: boolean;
  includeSession?: boolean;
  sessionId?: number;
  page?: number;
  limit?: number;
  isActive?: boolean;
  status?: string;
}

export class CampaignService {
  private campaignRepository: CampaignRepository;
  private contactRepository: Repository<Contact>;
  private contactGroupRepository: Repository<ContactGroup>;
  private templateRepository: Repository<MessageTemplate>;
  private sessionRepository: Repository<Session>;
  private dataSource: DataSource;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.campaignRepository = new CampaignRepository(dataSource);
    this.contactRepository = dataSource.getRepository(Contact);
    this.contactGroupRepository = dataSource.getRepository(ContactGroup);
    this.templateRepository = dataSource.getRepository(MessageTemplate);
    this.sessionRepository = dataSource.getRepository(Session);
  }

  // Create Campaign with relations
  async createCampaign(createCampaignDto: CreateCampaignDto): Promise<Campaign> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      console.log(`🚀 Creating new campaign: ${createCampaignDto.name}`);

      // ✅ Validate session
      if (createCampaignDto.sessionId) {
        const session = await this.sessionRepository.findOne({
          where: { id: createCampaignDto.sessionId }
        });
        if (!session) {
          throw new Error(`Session with ID ${createCampaignDto.sessionId} not found`);
        }
        console.log(`✅ Session validated: ${session.sessionName}`);
      }

      // ✅ Validate contact group
      if (createCampaignDto.groupId) {
        const group = await this.contactGroupRepository.findOne({
          where: { id: createCampaignDto.groupId }
        });
        if (!group) {
          throw new Error(`Contact group with ID ${createCampaignDto.groupId} not found`);
        }
        console.log(`✅ Contact group validated: ${group.name}`);
      }

      // ✅ Create campaign entity
      const campaign = queryRunner.manager.create(Campaign, {
        name: createCampaignDto.name,
        description: createCampaignDto.description,
        minIntervalMinutes: createCampaignDto.minIntervalMinutes ?? 30,
        maxIntervalMinutes: createCampaignDto.maxIntervalMinutes ?? 120,
        sessionId: createCampaignDto.sessionId,
        groupId: createCampaignDto.groupId,
      } as DeepPartial<Campaign>);

      const savedCampaign = await queryRunner.manager.save(campaign);
      console.log(`✅ Campaign created with ID: ${savedCampaign.id}`);

      // ✅ Handle templates
      if (createCampaignDto.templateIds && createCampaignDto.templateIds.length > 0) {
        const templates = await this.templateRepository.find({
          where: { id: In(createCampaignDto.templateIds) }
        });

        if (templates.length !== createCampaignDto.templateIds.length) {
          const foundIds = templates.map(t => t.id);
          const missingIds = createCampaignDto.templateIds.filter(id => !foundIds.includes(id));
          throw new Error(`Templates not found with IDs: ${missingIds.join(', ')}`);
        }

        savedCampaign.templates = templates;
        console.log(`✅ Added ${templates.length} templates to campaign`);
      }

      // ✅ Save with relations
      const finalCampaign = await queryRunner.manager.save(savedCampaign);
      await queryRunner.commitTransaction();

      console.log(`🎉 Campaign created successfully: ${finalCampaign.name}`);
      return this.getCampaignById(finalCampaign.id);

    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Error creating campaign:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // Get all campaigns with optional filtering
  async getCampaigns(options: CampaignQueryOptions = {}): Promise<{ campaigns: Campaign[]; total: number }> {
    try {
      const campaigns = await this.campaignRepository.findAllWithRelations(options);
      
      // Get total count for pagination
      const whereCondition: any = {};
      if (options.sessionId) whereCondition.sessionId = options.sessionId;
      if (options.isActive !== undefined) whereCondition.isActive = options.isActive;
      if (options.status) whereCondition.status = options.status;

      const total = await this.campaignRepository.count({ where: whereCondition });

      console.log(`📊 Found ${campaigns.length} campaigns (total: ${total})`);
      return { campaigns, total };
    } catch (error) {
      console.error('Error getting campaigns:', error);
      
      // Fallback to simple query
      const whereCondition: any = {};
      if (options.sessionId) whereCondition.sessionId = options.sessionId;
      if (options.isActive !== undefined) whereCondition.isActive = options.isActive;
      if (options.status) whereCondition.status = options.status;

      const skip = ((options.page || 1) - 1) * (options.limit || 50);
      
      const [campaigns, total] = await this.campaignRepository.findAndCount({
        where: whereCondition,
        relations: ['contactGroup', 'templates', 'session'],
        order: { createdAt: 'DESC' },
        skip,
        take: options.limit || 50
      });

      return { campaigns, total };
    }
  }

  // Get campaign by ID with all relations
  async getCampaignById(id: number): Promise<Campaign> {
    const campaign = await this.campaignRepository.findByIdWithRelations(id, {
      includeContactGroup: true,
      includeTemplates: true,
      includeSession: true
    });

    if (!campaign) {
      throw new Error(`Campaign with ID ${id} not found`);
    }

    return campaign;
  }

  // Get campaigns by session
  async getCampaignsBySession(
    sessionId: number,
    options: {
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ campaigns: Campaign[]; total: number }> {
    try {
      const campaigns = await this.campaignRepository.findBySessionId(sessionId);
      
      // Apply additional filters
      let filteredCampaigns = campaigns;
      
      // Apply pagination
      const skip = ((options.page || 1) - 1) * (options.limit || 50);
      const paginatedCampaigns = filteredCampaigns.slice(skip, skip + (options.limit || 50));

      console.log(`📊 Found ${paginatedCampaigns.length} campaigns for session ${sessionId}`);
      return { campaigns: paginatedCampaigns, total: filteredCampaigns.length };
    } catch (error) {
      console.error('Error getting campaigns by session:', error);
      throw error;
    }
  }

  // Update campaign
  async updateCampaign(id: number, updateCampaignDto: UpdateCampaignDto): Promise<Campaign> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      console.log(`📝 Updating campaign ID: ${id}`);

      const campaign = await this.campaignRepository.findByIdWithRelations(id, {
        includeContactGroup: true,
        includeTemplates: true
      });

      if (!campaign) {
        throw new Error(`Campaign with ID ${id} not found`);
      }

      // Update basic fields
      if (updateCampaignDto.name !== undefined) campaign.name = updateCampaignDto.name;
      if (updateCampaignDto.description !== undefined) campaign.description = updateCampaignDto.description;
      if (updateCampaignDto.minIntervalMinutes !== undefined) campaign.minIntervalMinutes = updateCampaignDto.minIntervalMinutes;
      if (updateCampaignDto.maxIntervalMinutes !== undefined) campaign.maxIntervalMinutes = updateCampaignDto.maxIntervalMinutes;
      if (updateCampaignDto.sessionId !== undefined) campaign.sessionId = updateCampaignDto.sessionId;
      if (updateCampaignDto.groupId !== undefined) campaign.groupId = updateCampaignDto.groupId;

      // Validate session if provided
      if (updateCampaignDto.sessionId) {
        const session = await this.sessionRepository.findOne({
          where: { id: updateCampaignDto.sessionId }
        });
        if (!session) {
          throw new Error(`Session with ID ${updateCampaignDto.sessionId} not found`);
        }
      }

      // Validate contact group if provided
      if (updateCampaignDto.groupId) {
        const group = await this.contactGroupRepository.findOne({
          where: { id: updateCampaignDto.groupId }
        });
        if (!group) {
          throw new Error(`Contact group with ID ${updateCampaignDto.groupId} not found`);
        }
        console.log(`📝 Updated contact group: ${group.name}`);
      }

      // Handle templates relation update
      if (updateCampaignDto.templateIds !== undefined) {
        if (updateCampaignDto.templateIds.length > 0) {
          const templates = await this.templateRepository.find({
            where: { id: In(updateCampaignDto.templateIds) }
          });

          if (templates.length !== updateCampaignDto.templateIds.length) {
            const foundIds = templates.map(t => t.id);
            const missingIds = updateCampaignDto.templateIds.filter(id => !foundIds.includes(id));
            throw new Error(`Templates not found with IDs: ${missingIds.join(', ')}`);
          }

          campaign.templates = templates;
          console.log(`📝 Updated templates: ${templates.length} templates`);
        } else {
          campaign.templates = [];
          console.log(`📝 Removed all templates from campaign`);
        }
      }

      const updatedCampaign = await queryRunner.manager.save(campaign);
      await queryRunner.commitTransaction();
      
      console.log(`✅ Campaign updated successfully: ${updatedCampaign.name}`);
      return this.getCampaignById(updatedCampaign.id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Error updating campaign:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // Update or create campaign (like ensureCampaignExists)
  async updateOrCreateCampaign(campaignData: {
    name: string;
    description?: string;
    sessionId?: number;
    minIntervalMinutes?: number;
    maxIntervalMinutes?: number;
    groupId?: number;
    templateIds?: number[];
  }): Promise<Campaign> {
    try {
      // Try to find existing campaign by name and session
      let campaign = await this.campaignRepository.findOne({
        where: { 
          name: campaignData.name,
          sessionId: campaignData.sessionId 
        },
        relations: ['contactGroup', 'templates']
      });

      if (campaign) {
        // Update existing campaign
        const updateData: UpdateCampaignDto = {};
        let shouldUpdate = false;

        if (campaignData.description && !campaign.description) {
          updateData.description = campaignData.description;
          shouldUpdate = true;
        }

        if (campaignData.groupId && campaign.groupId !== campaignData.groupId) {
          updateData.groupId = campaignData.groupId;
          shouldUpdate = true;
        }

        if (campaignData.templateIds) {
          updateData.templateIds = campaignData.templateIds;
          shouldUpdate = true;
        }

        if (shouldUpdate) {
          campaign = await this.updateCampaign(campaign.id, updateData);
          console.log(`📝 Updated existing campaign: ${campaignData.name}`);
        }
      } else {
        // Create new campaign
        const createData: CreateCampaignDto = {
          name: campaignData.name,
          description: campaignData.description,
          sessionId: campaignData.sessionId,
          minIntervalMinutes: campaignData.minIntervalMinutes ?? 30,
          maxIntervalMinutes: campaignData.maxIntervalMinutes ?? 120,
          groupId: campaignData.groupId,
          templateIds: campaignData.templateIds
        };

        campaign = await this.createCampaign(createData);
        console.log(`✅ Created new campaign: ${campaignData.name}`);
      }

      return campaign;
    } catch (error) {
      console.error('Error updating or creating campaign:', error);
      throw error;
    }
  }

  // Delete campaign
  async deleteCampaign(id: number): Promise<void> {
    try {
      const campaign = await this.campaignRepository.findOne({ where: { id } });
      
      if (!campaign) {
        throw new Error(`Campaign with ID ${id} not found`);
      }

      await this.campaignRepository.remove(campaign);
      console.log(`🗑️ Deleted campaign: ${campaign.name}`);
    } catch (error) {
      console.error('Error deleting campaign:', error);
      throw error;
    }
  }

  // Search campaigns
  async searchCampaigns(
    searchQuery: string,
    options: {
      sessionId?: number;
      page?: number;
      limit?: number;
    } = {}
  ): Promise<{ campaigns: Campaign[]; total: number }> {
    try {
      const queryBuilder = this.campaignRepository.createQueryBuilder('campaign')
        .leftJoinAndSelect('campaign.contactGroup', 'contactGroup')
        .leftJoinAndSelect('campaign.templates', 'template')
        .leftJoinAndSelect('campaign.session', 'session')
        .where('campaign.name LIKE :search OR campaign.description LIKE :search', 
               { search: `%${searchQuery}%` });

      if (options.sessionId) {
        queryBuilder.andWhere('campaign.sessionId = :sessionId', { sessionId: options.sessionId });
      }

      const skip = ((options.page || 1) - 1) * (options.limit || 50);
      queryBuilder.skip(skip).take(options.limit || 50);

      const [campaigns, total] = await queryBuilder.getManyAndCount();

      console.log(`🔍 Search "${searchQuery}" found ${campaigns.length} campaigns`);
      return { campaigns, total };
    } catch (error) {
      console.error('Error searching campaigns:', error);
      throw error;
    }
  }

  // Business logic methods

  async updateLastSent(campaignId: number): Promise<Campaign> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      campaign.lastSent = new Date();
      const updatedCampaign = await this.campaignRepository.save(campaign);
      console.log(`📤 Updated last sent time for campaign: ${campaign.name}`);
      return updatedCampaign;
    } catch (error) {
      console.error('Error updating last sent:', error);
      throw error;
    }
  }

  async updateIsStarted(campaignId: number, isStarted: boolean): Promise<Campaign> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      campaign.isStarted = isStarted;
      const updatedCampaign = await this.campaignRepository.save(campaign);
      console.log(`🔄 Updated isStarted to ${isStarted} for campaign: ${campaign.name}`);
      return updatedCampaign;
    } catch (error) {
      console.error('Error updating isStarted:', error);
      throw error;
    }
  }

  async getActiveCampaigns(sessionId?: number): Promise<Campaign[]> {
    const options: CampaignQueryOptions = { 
      includeContactGroup: true,
      includeTemplates: true,
      isActive: true
    };
    
    if (sessionId) {
      options.sessionId = sessionId;
    }

    const { campaigns } = await this.getCampaigns(options);
    console.log(`📊 Found ${campaigns.length} active campaigns`);
    return campaigns;
  }

  async getCampaignsReadyToSend(sessionId?: number): Promise<Campaign[]> {
    try {
      const activeCampaigns = await this.getActiveCampaigns(sessionId);
      const now = new Date();

      const readyCampaigns = activeCampaigns.filter(campaign => {
        if (!campaign.lastSent) return true;

        const timeSinceLastSent = now.getTime() - campaign.lastSent.getTime();
        const minInterval = campaign.minIntervalMinutes * 60 * 1000; // Convert to milliseconds

        return timeSinceLastSent >= minInterval;
      });

      console.log(`📤 Found ${readyCampaigns.length} campaigns ready to send`);
      return readyCampaigns;
    } catch (error) {
      console.error('Error getting campaigns ready to send:', error);
      throw error;
    }
  }

  // Utility methods for contact group management

  async updateCampaignContactGroup(campaignId: number, groupId: number): Promise<Campaign> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      
      // Validate the group exists
      const group = await this.contactGroupRepository.findOne({
        where: { id: groupId }
      });

      if (!group) {
        throw new Error(`Contact group with ID ${groupId} not found`);
      }

      campaign.groupId = groupId;
      const updatedCampaign = await this.campaignRepository.save(campaign);
      console.log(`🔄 Updated contact group for campaign: ${campaign.name} to group: ${group.name}`);
      return updatedCampaign;
    } catch (error) {
      console.error('Error updating campaign contact group:', error);
      throw error;
    }
  }

  async removeCampaignContactGroup(campaignId: number): Promise<Campaign> {
    throw new Error('Cannot remove contact group - groupId is required for all campaigns');
  }

  // Template management methods (unchanged)

  async addTemplatesToCampaign(campaignId: number, templateIds: number[]): Promise<Campaign> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      const templates = await this.templateRepository.find({
        where: { id: In(templateIds) }
      });

      if (templates.length !== templateIds.length) {
        const foundIds = templates.map(t => t.id);
        const missingIds = templateIds.filter(id => !foundIds.includes(id));
        throw new Error(`Templates not found with IDs: ${missingIds.join(', ')}`);
      }

      // Add new templates (avoid duplicates)
      const existingTemplateIds = campaign.templates.map(t => t.id);
      const newTemplates = templates.filter(t => !existingTemplateIds.includes(t.id));
      campaign.templates.push(...newTemplates);

      const updatedCampaign = await this.campaignRepository.save(campaign);
      console.log(`➕ Added ${newTemplates.length} templates to campaign: ${campaign.name}`);
      return updatedCampaign;
    } catch (error) {
      console.error('Error adding templates to campaign:', error);
      throw error;
    }
  }

  async removeTemplatesFromCampaign(campaignId: number, templateIds: number[]): Promise<Campaign> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      campaign.templates = campaign.templates.filter(t => !templateIds.includes(t.id));
      const updatedCampaign = await this.campaignRepository.save(campaign);
      console.log(`➖ Removed templates from campaign: ${campaign.name}`);
      return updatedCampaign;
    } catch (error) {
      console.error('Error removing templates from campaign:', error);
      throw error;
    }
  }

  // Statistics and monitoring methods

  async getCampaignStatistics(campaignId: number): Promise<any> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      
      // Get contact count from the associated group
      let contactCount = 0;
      if (campaign.contactGroup) {
        const groupWithContacts = await this.contactGroupRepository.findOne({
          where: { id: campaign.contactGroup.id },
          relations: ['contacts']
        });
        contactCount = groupWithContacts?.contacts?.length || 0;
      }
      
      return {
        id: campaign.id,
        name: campaign.name,
        contactGroupName: campaign.contactGroup?.name || null,
        contactCount,
        templateCount: campaign.templates?.length || 0,
        minIntervalMinutes: campaign.minIntervalMinutes,
        maxIntervalMinutes: campaign.maxIntervalMinutes,
        lastSent: campaign.lastSent,
        isStarted: campaign.isStarted,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        sessionName: campaign.session?.sessionName || null
      };
    } catch (error) {
      console.error('Error getting campaign statistics:', error);
      return {
        id: campaignId,
        error: 'Failed to get statistics'
      };
    }
  }

  // Debug method
  async debugCampaignIssue(sessionId?: number): Promise<any> {
    console.log('🐛 Starting debug for campaigns', sessionId ? `in session: ${sessionId}` : '(all sessions)');
    
    try {
      // Check total campaigns
      const allCampaigns = await this.campaignRepository.find();
      console.log('📊 Total campaigns in database:', allCampaigns.length);
      
      // Check campaigns for specific session if provided
      if (sessionId) {
        const sessionCampaigns = await this.campaignRepository.find({
          where: { sessionId }
        });
        console.log('📊 Campaigns for session:', sessionCampaigns.length);
        
        if (sessionCampaigns.length > 0) {
          console.log('📋 First campaign details:', {
            id: sessionCampaigns[0].id,
            name: sessionCampaigns[0].name,
            sessionId: sessionCampaigns[0].sessionId,
            groupId: sessionCampaigns[0].groupId,
          });
        }
      }
                  
      // Check all session IDs
      const allSessionIds = await this.campaignRepository
        .createQueryBuilder('campaign')
        .select('DISTINCT campaign.sessionId', 'sessionId')
        .getRawMany();
      
      console.log('📊 All session IDs in campaigns:', allSessionIds.map(s => s.sessionId));
      
      return {
        totalCampaigns: allCampaigns.length,
        sessionCampaigns: sessionId ? await this.campaignRepository.count({ where: { sessionId } }) : null,
        allSessionIds: allSessionIds.map(s => s.sessionId),
        sampleCampaign: allCampaigns[0] || null
      };
    } catch (error: any) {
      console.error('🐛 Debug error:', error);
      return { error: error.message };
    }
  }
}