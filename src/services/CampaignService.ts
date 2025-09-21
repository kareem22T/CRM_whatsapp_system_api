import { Repository, DataSource, In, DeepPartial } from 'typeorm';
import { CampaignRepository } from '../repositories/CampaignRepository';
import { Campaign } from '../entities/Campaign';
import { Contact, ContactGroup } from '../entities/Contact';
import { MessageTemplate } from '../entities/MessageTemplate';
import { Session } from '../entities/Session';
import { CampaignJob } from '../entities/CampaignJob';
import { CampaignTimeScheduler } from '../utils/CampaignTimeScheduler';

// DTOs for Campaign operations
export interface CreateCampaignDto {
  name: string;
  description?: string;
  minIntervalMinutes?: number;
  maxIntervalMinutes?: number;
  sessionId?: number;
  groupId?: number;
  templateIds?: number[];
  // NEW: Time scheduling fields
  isAllDay?: boolean;
  dailyStartTime?: string; // Format: "HH:MM:SS"
  dailyEndTime?: string;   // Format: "HH:MM:SS"
  timezone?: string;
}

export interface UpdateCampaignDto {
  name?: string;
  description?: string;
  minIntervalMinutes?: number;
  maxIntervalMinutes?: number;
  sessionId?: number;
  groupId?: number;
  templateIds?: number[];
  // NEW: Time scheduling fields
  isAllDay?: boolean;
  dailyStartTime?: string;
  dailyEndTime?: string;
  timezone?: string;
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

export interface CampaignProgressDto {
  campaignId: number;
  campaignName: string;
  status: string;
  totalContacts: number;
  messagesSent: number;
  messagesFailed: number;
  messagesPending: number;
  progressPercentage: number;
  successRate: number;
  nextSendAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  estimatedCompletionAt: Date | null;
  remainingContacts: number;
  lastSent: Date | null;
  isCompleted: boolean;
  isActive: boolean;
}

export interface CampaignJobUpdate {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  whatsappMessageId?: string;
  errorMessage?: string;
  processingStartedAt?: Date;
  processedAt?: Date;
}

export class CampaignService {
  private campaignRepository: CampaignRepository;
  private contactRepository: Repository<Contact>;
  private contactGroupRepository: Repository<ContactGroup>;
  private templateRepository: Repository<MessageTemplate>;
  private sessionRepository: Repository<Session>;
  private campaignJobRepository: Repository<CampaignJob>;
  private dataSource: DataSource;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.campaignRepository = new CampaignRepository(dataSource);
    this.contactRepository = dataSource.getRepository(Contact);
    this.contactGroupRepository = dataSource.getRepository(ContactGroup);
    this.templateRepository = dataSource.getRepository(MessageTemplate);
    this.sessionRepository = dataSource.getRepository(Session);
    this.campaignJobRepository = dataSource.getRepository(CampaignJob);
  }

  // ========== PROGRESS TRACKING METHODS ==========

  /**
   * Update campaign progress when a job is created
   */
  async initializeCampaignProgress(campaignId: number, totalJobs: number): Promise<Campaign> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      
      campaign.totalContacts = totalJobs;
      campaign.messagesPending = totalJobs;
      campaign.messagesSent = 0;
      campaign.messagesFailed = 0;
      campaign.progressPercentage = 0;
      campaign.status = 'running';
      campaign.startedAt = new Date();
      
      // Calculate estimated completion time
      const avgIntervalMinutes = (campaign.minIntervalMinutes + campaign.maxIntervalMinutes) / 2;
      const estimatedTotalMinutes = totalJobs * avgIntervalMinutes;
      campaign.estimatedCompletionAt = new Date(Date.now() + (estimatedTotalMinutes * 60 * 1000));
      
      const updatedCampaign = await this.campaignRepository.save(campaign);
      console.log(`📊 Initialized campaign progress: ${campaign.name} - ${totalJobs} total jobs`);
      
      return updatedCampaign;
    } catch (error) {
      console.error('Error initializing campaign progress:', error);
      throw error;
    }
  }

  /**
   * Update campaign progress when a job completes (success or failure)
   */
  async updateCampaignJobProgress(campaignId: number, jobUpdate: CampaignJobUpdate): Promise<Campaign> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Update the job record
      const job = await this.campaignJobRepository.findOne({
        where: { queueJobId: jobUpdate.jobId }
      });

      if (job) {
        job.status = jobUpdate.status;
        job.whatsappMessageId = jobUpdate.whatsappMessageId || job.whatsappMessageId;
        job.errorMessage = jobUpdate.errorMessage || job.errorMessage;
        job.processingStartedAt = jobUpdate.processingStartedAt || job.processingStartedAt;
        job.processedAt = jobUpdate.processedAt || job.processedAt;
        
        await queryRunner.manager.save(job);
      }

      // Get current campaign
      const campaign = await queryRunner.manager.findOne(Campaign, {
        where: { id: campaignId }
      });

      if (!campaign) {
        throw new Error(`Campaign with ID ${campaignId} not found`);
      }

      // Recalculate progress based on all jobs
      const jobStats = await queryRunner.manager
        .createQueryBuilder(CampaignJob, 'job')
        .select('job.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('job.campaignId = :campaignId', { campaignId })
        .groupBy('job.status')
        .getRawMany();

      let messagesSent = 0;
      let messagesFailed = 0;
      let messagesPending = 0;

      jobStats.forEach(stat => {
        const count = parseInt(stat.count);
        switch (stat.status) {
          case 'completed':
            messagesSent += count;
            break;
          case 'failed':
            messagesFailed += count;
            break;
          case 'pending':
          case 'processing':
            messagesPending += count;
            break;
        }
      });

      // Update campaign progress
      campaign.messagesSent = messagesSent;
      campaign.messagesFailed = messagesFailed;
      campaign.messagesPending = messagesPending;
      campaign.lastSent = new Date();
      
      // Calculate progress percentage
      const totalProcessed = messagesSent + messagesFailed;
      const progressPercentage = campaign.totalContacts > 0 
        ? (totalProcessed / campaign.totalContacts) * 100 
        : 0;
      campaign.progressPercentage = Math.round(progressPercentage * 100) / 100; // Round to 2 decimal places

      // Update next send time (find next pending job)
      const nextPendingJob = await queryRunner.manager.findOne(CampaignJob, {
        where: { 
          campaignId,
          status: 'pending'
        },
        order: { scheduledAt: 'ASC' }
      });
      
      campaign.nextSendAt = nextPendingJob?.scheduledAt || null;

      // Check if campaign is completed
      if (messagesPending === 0) {
        campaign.status = 'completed';
        campaign.completedAt = new Date();
        campaign.nextSendAt = null;
        console.log(`🎉 Campaign completed: ${campaign.name}`);
      }

      const updatedCampaign = await queryRunner.manager.save(campaign);
      await queryRunner.commitTransaction();

      const completionText = campaign.status === 'completed' ? ' - COMPLETED!' : '';
      console.log(`📊 Campaign progress updated: ${campaign.name} - ${progressPercentage.toFixed(2)}%${completionText}`);
      console.log(`   ✅ Sent: ${messagesSent} | ❌ Failed: ${messagesFailed} | ⏳ Pending: ${messagesPending}`);
      
      return updatedCampaign;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Error updating campaign progress:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Get comprehensive campaign progress data
   */
  async getCampaignProgress(campaignId: number): Promise<CampaignProgressDto> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      
      return {
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: campaign.status,
        totalContacts: campaign.totalContacts,
        messagesSent: campaign.messagesSent,
        messagesFailed: campaign.messagesFailed,
        messagesPending: campaign.messagesPending,
        progressPercentage: campaign.progressPercentage,
        successRate: campaign.successRate,
        nextSendAt: campaign.nextSendAt,
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
        estimatedCompletionAt: campaign.estimatedCompletionAt,
        remainingContacts: campaign.remainingContacts,
        lastSent: campaign.lastSent,
        isCompleted: campaign.isCompleted,
        isActive: campaign.isActive
      };
    } catch (error) {
      console.error('Error getting campaign progress:', error);
      throw error;
    }
  }

  /**
   * Get progress for all campaigns (with optional session filter)
   */
  async getAllCampaignsProgress(sessionId?: number): Promise<CampaignProgressDto[]> {
    try {
      const options: CampaignQueryOptions = {
        includeContactGroup: true,
        includeTemplates: true,
        includeSession: true
      };
      
      if (sessionId) {
        options.sessionId = sessionId;
      }

      const { campaigns } = await this.getCampaigns(options);
      
      const progressData: CampaignProgressDto[] = campaigns.map(campaign => ({
        campaignId: campaign.id,
        campaignName: campaign.name,
        status: campaign.status,
        totalContacts: campaign.totalContacts,
        messagesSent: campaign.messagesSent,
        messagesFailed: campaign.messagesFailed,
        messagesPending: campaign.messagesPending,
        progressPercentage: campaign.progressPercentage,
        successRate: campaign.successRate,
        nextSendAt: campaign.nextSendAt,
        startedAt: campaign.startedAt,
        completedAt: campaign.completedAt,
        estimatedCompletionAt: campaign.estimatedCompletionAt,
        remainingContacts: campaign.remainingContacts,
        lastSent: campaign.lastSent,
        isCompleted: campaign.isCompleted,
        isActive: campaign.isActive
      }));

      return progressData;
    } catch (error) {
      console.error('Error getting all campaigns progress:', error);
      throw error;
    }
  }

  // ========== CAMPAIGN JOB MANAGEMENT ==========

  /**
   * Create campaign jobs for all contacts in the campaign
   */
  async createCampaignJobs(campaignId: number): Promise<{ jobs: CampaignJob[]; totalJobs: number; scheduleInfo: any }> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const campaign = await this.getCampaignById(campaignId);
      
      if (!campaign.contactGroup) {
        throw new Error('Campaign has no contact group assigned');
      }

      if (!campaign.templates || campaign.templates.length === 0) {
        throw new Error('Campaign has no templates');
      }

      // Get contacts from the contact group
      const contactService = new (await import('./ContactService')).ContactService();
      const contacts = await contactService.getContactsByGroup(campaign.groupId);
      
      if (!contacts || contacts.length === 0) {
        throw new Error('Contact group has no contacts');
      }

      console.log(`📅 Creating jobs for campaign "${campaign.name}" with time scheduling...`);
      console.log(`   All Day: ${campaign.isAllDay}`);
      if (!campaign.isAllDay) {
        console.log(`   Daily Window: ${campaign.dailyStartTime} - ${campaign.dailyEndTime} (${campaign.timezone})`);
      }

      // Use the time scheduler to get optimal scheduling
      const { scheduledTimes, estimatedCompletion } = CampaignTimeScheduler.scheduleJobsWithTimeWindows(
        campaign, 
        contacts.length, 
        new Date()
      );

      console.log(`⏰ Scheduled ${scheduledTimes.length}/${contacts.length} jobs within time constraints`);

      const jobs: CampaignJob[] = [];
      const scheduleInfo = CampaignTimeScheduler.getScheduleInfo(campaign);

      // Create job records with scheduled times
      for (let i = 0; i < Math.min(contacts.length, scheduledTimes.length); i++) {
        const contact = contacts[i];
        const scheduledTime = scheduledTimes[i];
        
        // Select random template
        const randomTemplateIndex = Math.floor(Math.random() * campaign.templates.length);
        const selectedTemplate = campaign.templates[randomTemplateIndex];

        // Calculate delay in minutes from now
        const delayMinutes = Math.max(0, Math.floor((scheduledTime.getTime() - Date.now()) / 60000));

        const job = queryRunner.manager.create(CampaignJob, {
          campaignId: campaign.id,
          contactId: contact.id,
          templateId: selectedTemplate.id,
          contactPhone: contact.phone,
          templateMessage: selectedTemplate.message,
          sessionName: campaign.session.sessionName,
          status: 'pending',
          scheduledAt: scheduledTime,
          delayMinutes: delayMinutes
        });

        const savedJob = await queryRunner.manager.save(job);
        jobs.push(savedJob);
      }

      // Update campaign with next window information
      if (!campaign.isAllDay) {
        const nextWindow = CampaignTimeScheduler.getScheduleInfo(campaign).nextWindow;
        campaign.nextWindowStart = nextWindow?.start || null;
        await queryRunner.manager.save(campaign);
      }

      await queryRunner.commitTransaction();
      
      console.log(`📋 Created ${jobs.length} campaign jobs with time scheduling`);
      if (jobs.length < contacts.length) {
        console.warn(`⚠️  Only ${jobs.length}/${contacts.length} jobs could be scheduled within time constraints`);
      }

      return { 
        jobs, 
        totalJobs: jobs.length,
        scheduleInfo: {
          canScheduleNow: scheduleInfo.canScheduleNow,
          reason: scheduleInfo.reason,
          nextAvailableTime: scheduleInfo.nextAvailableTime,
          estimatedCompletion,
          currentWindow: scheduleInfo.currentWindow ? 
            CampaignTimeScheduler.formatTimeWindow(scheduleInfo.currentWindow) : null,
          nextWindow: scheduleInfo.nextWindow ? 
            CampaignTimeScheduler.formatTimeWindow(scheduleInfo.nextWindow) : null
        }
      };
      
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Error creating campaign jobs with time scheduling:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Update job status with queue job ID
   */
  async updateJobWithQueueId(jobId: number, queueJobId: string): Promise<void> {
    try {
      await this.campaignJobRepository.update(jobId, { queueJobId });
      console.log(`🔗 Linked job ${jobId} with queue job ${queueJobId}`);
    } catch (error) {
      console.error('Error updating job with queue ID:', error);
      throw error;
    }
  }

  /**
   * Get campaign job statistics
   */
  async getCampaignJobStats(campaignId: number): Promise<any> {
    try {
      const stats = await this.campaignJobRepository
        .createQueryBuilder('job')
        .select('job.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .addSelect('AVG(job.delayMinutes)', 'avgDelay')
        .where('job.campaignId = :campaignId', { campaignId })
        .groupBy('job.status')
        .getRawMany();

      const totalJobs = await this.campaignJobRepository.count({
        where: { campaignId }
      });

      const nextJob = await this.campaignJobRepository.findOne({
        where: { 
          campaignId,
          status: 'pending'
        },
        order: { scheduledAt: 'ASC' }
      });

      return {
        totalJobs,
        statusBreakdown: stats,
        nextScheduledJob: nextJob ? {
          jobId: nextJob.id,
          scheduledAt: nextJob.scheduledAt,
          contactPhone: nextJob.contactPhone,
          delayMinutes: nextJob.delayMinutes
        } : null
      };
    } catch (error) {
      console.error('Error getting campaign job stats:', error);
      throw error;
    }
  }

  // ========== CAMPAIGN STATUS MANAGEMENT ==========

  /**
   * Start a campaign - updates status and creates jobs
   */
  async startCampaign(campaignId: number): Promise<{
    campaign: Campaign;
    jobs: CampaignJob[];
    totalJobs: number;
    scheduleInfo: any;
  }> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      
      if (campaign.status === 'running') {
        throw new Error('Campaign is already running');
      }

      if (campaign.status === 'completed') {
        throw new Error('Campaign is already completed');
      }

      // Check time window constraints
      const scheduleInfo = CampaignTimeScheduler.getScheduleInfo(campaign);
      
      console.log(`🕐 Campaign time analysis:`, {
        canScheduleNow: scheduleInfo.canScheduleNow,
        reason: scheduleInfo.reason,
        nextAvailableTime: scheduleInfo.nextAvailableTime?.toISOString()
      });

      // Create jobs with time scheduling
      const { jobs, totalJobs, scheduleInfo: jobScheduleInfo } = await this.createCampaignJobs(campaignId);
      
      if (totalJobs === 0) {
        throw new Error('No jobs could be scheduled within the campaign time constraints');
      }

      // Initialize progress tracking
      const updatedCampaign = await this.initializeCampaignProgress(campaignId, totalJobs);
      
      console.log(`🚀 Campaign started with time scheduling: ${campaign.name} with ${totalJobs} jobs`);
      
      return { 
        campaign: updatedCampaign, 
        jobs, 
        totalJobs,
        scheduleInfo: jobScheduleInfo
      };
      
    } catch (error) {
      console.error('Error starting campaign with time scheduling:', error);
      throw error;
    }
  }


  /**
   * Check if campaign can run at current time
   */
  async validateCampaignTiming(campaignId: number): Promise<{
    canRun: boolean;
    reason: string;
    nextAvailableTime: Date | null;
    currentWindow: string | null;
    nextWindow: string | null;
  }> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      const scheduleInfo = CampaignTimeScheduler.getScheduleInfo(campaign);
      
      return {
        canRun: scheduleInfo.canScheduleNow,
        reason: scheduleInfo.reason,
        nextAvailableTime: scheduleInfo.nextAvailableTime,
        currentWindow: scheduleInfo.currentWindow ? 
          CampaignTimeScheduler.formatTimeWindow(scheduleInfo.currentWindow) : null,
        nextWindow: scheduleInfo.nextWindow ? 
          CampaignTimeScheduler.formatTimeWindow(scheduleInfo.nextWindow) : null
      };
      
    } catch (error) {
      console.error('Error validating campaign timing:', error);
      throw error;
    }
  }


  /**
   * Pause a running campaign
   */
  async pauseCampaign(campaignId: number): Promise<Campaign> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      
      if (campaign.status !== 'running') {
        throw new Error('Only running campaigns can be paused');
      }

      campaign.status = 'paused';
      campaign.pausedAt = new Date();
      
      const updatedCampaign = await this.campaignRepository.save(campaign);
      console.log(`⏸️ Campaign paused: ${campaign.name}`);
      
      return updatedCampaign;
    } catch (error) {
      console.error('Error pausing campaign:', error);
      throw error;
    }
  }

  /**
   * Resume a paused campaign
   */
  async resumeCampaign(campaignId: number): Promise<Campaign> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      
      if (campaign.status !== 'paused') {
        throw new Error('Only paused campaigns can be resumed');
      }

      campaign.status = 'running';
      campaign.pausedAt = null;
      
      const updatedCampaign = await this.campaignRepository.save(campaign);
      console.log(`▶️ Campaign resumed: ${campaign.name}`);
      
      return updatedCampaign;
    } catch (error) {
      console.error('Error resuming campaign:', error);
      throw error;
    }
  }

  /**
   * Cancel a campaign
   */
  async cancelCampaign(campaignId: number): Promise<Campaign> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const campaign = await queryRunner.manager.findOne(Campaign, {
        where: { id: campaignId }
      });

      if (!campaign) {
        throw new Error(`Campaign with ID ${campaignId} not found`);
      }

      if (campaign.status === 'completed') {
        throw new Error('Cannot cancel a completed campaign');
      }

      // Cancel all pending jobs
      await queryRunner.manager.update(CampaignJob, 
        { campaignId, status: 'pending' },
        { status: 'cancelled' }
      );

      // Update campaign status
      campaign.status = 'cancelled';
      campaign.completedAt = new Date();
      campaign.nextSendAt = null;

      const updatedCampaign = await queryRunner.manager.save(campaign);
      await queryRunner.commitTransaction();
      
      console.log(`❌ Campaign cancelled: ${campaign.name}`);
      return updatedCampaign;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Error cancelling campaign:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // Update campaign
  async updateCampaign(id: number, updateCampaignDto: UpdateCampaignDto): Promise<Campaign> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      console.log(`📝 Updating campaign with time scheduling ID: ${id}`);

      const campaign = await this.campaignRepository.findByIdWithRelations(id, {
        includeContactGroup: true,
        includeTemplates: true
      });

      if (!campaign) {
        throw new Error(`Campaign with ID ${id} not found`);
      }

      // Validate time scheduling updates
      if (updateCampaignDto.isAllDay === false) {
        const startTime = updateCampaignDto.dailyStartTime ?? campaign.dailyStartTime;
        const endTime = updateCampaignDto.dailyEndTime ?? campaign.dailyEndTime;
        
        if (!startTime || !endTime) {
          throw new Error('Daily start and end times are required when isAllDay is false');
        }

        // Validate time format
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
        if (updateCampaignDto.dailyStartTime && !timeRegex.test(updateCampaignDto.dailyStartTime)) {
          throw new Error('Invalid dailyStartTime format. Use HH:MM or HH:MM:SS');
        }
        if (updateCampaignDto.dailyEndTime && !timeRegex.test(updateCampaignDto.dailyEndTime)) {
          throw new Error('Invalid dailyEndTime format. Use HH:MM or HH:MM:SS');
        }
      }

      // Update basic fields
      if (updateCampaignDto.name !== undefined) campaign.name = updateCampaignDto.name;
      if (updateCampaignDto.description !== undefined) campaign.description = updateCampaignDto.description;
      if (updateCampaignDto.minIntervalMinutes !== undefined) campaign.minIntervalMinutes = updateCampaignDto.minIntervalMinutes;
      if (updateCampaignDto.maxIntervalMinutes !== undefined) campaign.maxIntervalMinutes = updateCampaignDto.maxIntervalMinutes;
      if (updateCampaignDto.sessionId !== undefined) campaign.sessionId = updateCampaignDto.sessionId;
      if (updateCampaignDto.groupId !== undefined) campaign.groupId = updateCampaignDto.groupId;

      // Update time scheduling fields
      if (updateCampaignDto.isAllDay !== undefined) campaign.isAllDay = updateCampaignDto.isAllDay;
      if (updateCampaignDto.dailyStartTime !== undefined) campaign.dailyStartTime = updateCampaignDto.dailyStartTime;
      if (updateCampaignDto.dailyEndTime !== undefined) campaign.dailyEndTime = updateCampaignDto.dailyEndTime;
      if (updateCampaignDto.timezone !== undefined) campaign.timezone = updateCampaignDto.timezone;

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

      // Log updated time scheduling info
      if (!updatedCampaign.isAllDay) {
        console.log(`⏰ Updated time window: ${updatedCampaign.dailyStartTime} - ${updatedCampaign.dailyEndTime} (${updatedCampaign.timezone})`);
        
        const scheduleInfo = CampaignTimeScheduler.getScheduleInfo(updatedCampaign);
        console.log(`📅 Current schedule status: ${scheduleInfo.reason}`);
      }
      
      console.log(`✅ Campaign updated successfully: ${updatedCampaign.name}`);
      return this.getCampaignById(updatedCampaign.id);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Error updating campaign with time scheduling:', error);
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

  async createCampaign(createCampaignDto: CreateCampaignDto): Promise<Campaign> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      console.log(`🚀 Creating new campaign with time scheduling: ${createCampaignDto.name}`);

      console.log(createCampaignDto);
      

      // Validate time scheduling parameters
      if (!createCampaignDto.isAllDay) {
        if (!createCampaignDto.dailyStartTime || !createCampaignDto.dailyEndTime) {
          throw new Error('Daily start and end times are required when isAllDay is false');
        }
        
        // Validate time format
        const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
        if (!timeRegex.test(createCampaignDto.dailyStartTime)) {
          throw new Error('Invalid dailyStartTime format. Use HH:MM or HH:MM:SS');
        }
        if (!timeRegex.test(createCampaignDto.dailyEndTime)) {
          throw new Error('Invalid dailyEndTime format. Use HH:MM or HH:MM:SS');
        }

        console.log(`⏰ Time window: ${createCampaignDto.dailyStartTime} - ${createCampaignDto.dailyEndTime} (${createCampaignDto.timezone || 'UTC'})`);
      }

      // Validate session
      if (createCampaignDto.sessionId) {
        const session = await this.sessionRepository.findOne({
          where: { id: createCampaignDto.sessionId }
        });
        if (!session) {
          throw new Error(`Session with ID ${createCampaignDto.sessionId} not found`);
        }
        console.log(`✅ Session validated: ${session.sessionName}`);
      }

      // Validate contact group
      if (createCampaignDto.groupId) {
        const group = await this.contactGroupRepository.findOne({
          where: { id: createCampaignDto.groupId }
        });
        if (!group) {
          throw new Error(`Contact group with ID ${createCampaignDto.groupId} not found`);
        }
        console.log(`✅ Contact group validated: ${group.name}`);
      }

      // Create campaign entity with time scheduling fields
      const campaign = queryRunner.manager.create(Campaign, {
        name: createCampaignDto.name,
        description: createCampaignDto.description,
        minIntervalMinutes: createCampaignDto.minIntervalMinutes ?? 30,
        maxIntervalMinutes: createCampaignDto.maxIntervalMinutes ?? 120,
        sessionId: createCampaignDto.sessionId,
        groupId: createCampaignDto.groupId,
        status: 'inactive',
        totalContacts: 0,
        messagesSent: 0,
        messagesFailed: 0,
        messagesPending: 0,
        progressPercentage: 0,
        // NEW: Time scheduling fields
        isAllDay: createCampaignDto.isAllDay ?? true,
        dailyStartTime: createCampaignDto.dailyStartTime || null,
        dailyEndTime: createCampaignDto.dailyEndTime || null,
        timezone: createCampaignDto.timezone || 'UTC'
      } as DeepPartial<Campaign>);

      const savedCampaign = await queryRunner.manager.save(campaign);
      console.log(`✅ Campaign created with ID: ${savedCampaign.id}`);

      // Handle templates
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

      const finalCampaign = await queryRunner.manager.save(savedCampaign);
      await queryRunner.commitTransaction();

      // Log time scheduling summary
      if (!finalCampaign.isAllDay) {
        const scheduleInfo = CampaignTimeScheduler.getScheduleInfo(finalCampaign);
        console.log(`📅 Campaign time schedule summary:`);
        console.log(`   Can run now: ${scheduleInfo.canScheduleNow}`);
        console.log(`   Reason: ${scheduleInfo.reason}`);
        if (scheduleInfo.nextAvailableTime) {
          console.log(`   Next available: ${scheduleInfo.nextAvailableTime.toLocaleString()}`);
        }
      }

      console.log(`🎉 Campaign created successfully: ${finalCampaign.name}`);
      return this.getCampaignById(finalCampaign.id);

    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error('Error creating campaign with time scheduling:', error);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }


  // Keep all existing methods...
  async getCampaigns(options: CampaignQueryOptions = {}): Promise<{ campaigns: Campaign[]; total: number }> {
    try {
      const campaigns = await this.campaignRepository.findAllWithRelations(options);
      
      const whereCondition: any = {};
      if (options.sessionId) whereCondition.sessionId = options.sessionId;
      if (options.isActive !== undefined) whereCondition.isActive = options.isActive;
      if (options.status) whereCondition.status = options.status;

      const total = await this.campaignRepository.count({ where: whereCondition });

      console.log(`📊 Found ${campaigns.length} campaigns (total: ${total})`);
      return { campaigns, total };
    } catch (error) {
      console.error('Error getting campaigns:', error);
      
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