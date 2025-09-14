import { Repository, DataSource } from 'typeorm';
import { CampaignJob } from '../entities/CampaignJob';
import { Campaign } from '../entities/Campaign';

export interface CampaignJobDto {
  id: number;
  campaignId: number;
  contactId: number;
  templateId: number;
  contactPhone: string;
  templateMessage: string;
  sessionName: string;
  status: string;
  queueJobId: string;
  scheduledAt: Date;
  processingStartedAt: Date | null;
  processedAt: Date | null;
  delayMinutes: number;
  whatsappMessageId: string | null;
  errorMessage: string | null;
  retryCount: number;
  maxRetries: number;
  isCompleted: boolean;
  isFailed: boolean;
  isPending: boolean;
  isProcessing: boolean;
  canRetry: boolean;
}

export interface JobStatsDto {
  totalJobs: number;
  pendingJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  cancelledJobs: number;
  averageProcessingTime: number;
  nextScheduledJob: {
    jobId: number;
    scheduledAt: Date;
    contactPhone: string;
    delayMinutes: number;
  } | null;
}

export class CampaignJobService {
  private campaignJobRepository: Repository<CampaignJob>;
  private campaignRepository: Repository<Campaign>;
  private dataSource: DataSource;

  constructor(dataSource: DataSource) {
    this.dataSource = dataSource;
    this.campaignJobRepository = dataSource.getRepository(CampaignJob);
    this.campaignRepository = dataSource.getRepository(Campaign);
  }

  /**
   * Create a campaign job
   */
  async createCampaignJob(jobData: {
    campaignId: number;
    contactId: number;
    templateId: number;
    contactPhone: string;
    templateMessage: string;
    sessionName: string;
    scheduledAt: Date;
    delayMinutes: number;
  }): Promise<CampaignJob> {
    try {
      const job = this.campaignJobRepository.create({
        campaignId: jobData.campaignId,
        contactId: jobData.contactId,
        templateId: jobData.templateId,
        contactPhone: jobData.contactPhone,
        templateMessage: jobData.templateMessage,
        sessionName: jobData.sessionName,
        scheduledAt: jobData.scheduledAt,
        delayMinutes: jobData.delayMinutes,
        status: 'pending'
      });

      const savedJob = await this.campaignJobRepository.save(job);
      console.log(`📋 Created campaign job: ${savedJob.id} for contact ${jobData.contactPhone}`);
      
      return savedJob;
    } catch (error) {
      console.error('Error creating campaign job:', error);
      throw error;
    }
  }

  /**
   * Update job with queue job ID
   */
  async updateJobWithQueueId(jobId: number, queueJobId: string): Promise<CampaignJob> {
    try {
      await this.campaignJobRepository.update(jobId, { queueJobId });
      
      const updatedJob = await this.campaignJobRepository.findOne({ where: { id: jobId } });
      if (!updatedJob) {
        throw new Error(`Job with ID ${jobId} not found`);
      }

      console.log(`🔗 Updated job ${jobId} with queue ID: ${queueJobId}`);
      return updatedJob;
    } catch (error) {
      console.error('Error updating job with queue ID:', error);
      throw error;
    }
  }

  /**
   * Update job status and related fields
   */
  async updateJobStatus(
    queueJobId: string, 
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled',
    updateData: {
      whatsappMessageId?: string;
      errorMessage?: string;
      processingStartedAt?: Date;
      processedAt?: Date;
      retryCount?: number;
    } = {}
  ): Promise<CampaignJob | null> {
    try {
      const job = await this.campaignJobRepository.findOne({
        where: { queueJobId }
      });

      if (!job) {
        console.warn(`Job with queue ID ${queueJobId} not found`);
        return null;
      }

      // Update job fields
      job.status = status;
      if (updateData.whatsappMessageId) job.whatsappMessageId = updateData.whatsappMessageId;
      if (updateData.errorMessage) job.errorMessage = updateData.errorMessage;
      if (updateData.processingStartedAt) job.processingStartedAt = updateData.processingStartedAt;
      if (updateData.processedAt) job.processedAt = updateData.processedAt;
      if (updateData.retryCount !== undefined) job.retryCount = updateData.retryCount;

      const updatedJob = await this.campaignJobRepository.save(job);
      console.log(`📋 Updated job ${job.id} status to: ${status}`);
      
      return updatedJob;
    } catch (error) {
      console.error('Error updating job status:', error);
      throw error;
    }
  }

  /**
   * Get all jobs for a campaign
   */
  async getCampaignJobs(
    campaignId: number,
    options: {
      status?: string;
      page?: number;
      limit?: number;
      orderBy?: 'scheduledAt' | 'processedAt' | 'createdAt';
      orderDirection?: 'ASC' | 'DESC';
    } = {}
  ): Promise<{ jobs: CampaignJobDto[]; total: number }> {
    try {
      const queryBuilder = this.campaignJobRepository
        .createQueryBuilder('job')
        .leftJoinAndSelect('job.contact', 'contact')
        .leftJoinAndSelect('job.template', 'template')
        .where('job.campaignId = :campaignId', { campaignId });

      if (options.status) {
        queryBuilder.andWhere('job.status = :status', { status: options.status });
      }

      // Pagination
      const page = options.page || 1;
      const limit = options.limit || 50;
      const skip = (page - 1) * limit;

      queryBuilder.skip(skip).take(limit);

      // Ordering
      const orderBy = options.orderBy || 'scheduledAt';
      const orderDirection = options.orderDirection || 'ASC';
      queryBuilder.orderBy(`job.${orderBy}`, orderDirection);

      const [jobs, total] = await queryBuilder.getManyAndCount();

      const jobDtos: CampaignJobDto[] = jobs.map(job => ({
        id: job.id,
        campaignId: job.campaignId,
        contactId: job.contactId,
        templateId: job.templateId,
        contactPhone: job.contactPhone,
        templateMessage: job.templateMessage,
        sessionName: job.sessionName,
        status: job.status,
        queueJobId: job.queueJobId,
        scheduledAt: job.scheduledAt,
        processingStartedAt: job.processingStartedAt,
        processedAt: job.processedAt,
        delayMinutes: job.delayMinutes,
        whatsappMessageId: job.whatsappMessageId,
        errorMessage: job.errorMessage,
        retryCount: job.retryCount,
        maxRetries: job.maxRetries,
        isCompleted: job.isCompleted,
        isFailed: job.isFailed,
        isPending: job.isPending,
        isProcessing: job.isProcessing,
        canRetry: job.canRetry
      }));

      return { jobs: jobDtos, total };
    } catch (error) {
      console.error('Error getting campaign jobs:', error);
      throw error;
    }
  }

  /**
   * Get job statistics for a campaign
   */
  async getCampaignJobStatistics(campaignId: number): Promise<JobStatsDto> {
    try {
      // Get status breakdown
      const statusStats = await this.campaignJobRepository
        .createQueryBuilder('job')
        .select('job.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('job.campaignId = :campaignId', { campaignId })
        .groupBy('job.status')
        .getRawMany();

      // Initialize counters
      let totalJobs = 0;
      let pendingJobs = 0;
      let processingJobs = 0;
      let completedJobs = 0;
      let failedJobs = 0;
      let cancelledJobs = 0;

      statusStats.forEach(stat => {
        const count = parseInt(stat.count);
        totalJobs += count;
        
        switch (stat.status) {
          case 'pending':
            pendingJobs = count;
            break;
          case 'processing':
            processingJobs = count;
            break;
          case 'completed':
            completedJobs = count;
            break;
          case 'failed':
            failedJobs = count;
            break;
          case 'cancelled':
            cancelledJobs = count;
            break;
        }
      });

      // Calculate average processing time for completed jobs
      const avgProcessingResult = await this.campaignJobRepository
        .createQueryBuilder('job')
        .select('AVG(TIMESTAMPDIFF(SECOND, job.processingStartedAt, job.processedAt))', 'avgSeconds')
        .where('job.campaignId = :campaignId', { campaignId })
        .andWhere('job.status = :status', { status: 'completed' })
        .andWhere('job.processingStartedAt IS NOT NULL')
        .andWhere('job.processedAt IS NOT NULL')
        .getRawOne();

      const averageProcessingTime = avgProcessingResult?.avgSeconds 
        ? parseFloat(avgProcessingResult.avgSeconds) * 1000 // Convert to milliseconds
        : 0;

      // Get next scheduled job
      const nextJob = await this.campaignJobRepository.findOne({
        where: { 
          campaignId,
          status: 'pending'
        },
        order: { scheduledAt: 'ASC' }
      });

      const nextScheduledJob = nextJob ? {
        jobId: nextJob.id,
        scheduledAt: nextJob.scheduledAt,
        contactPhone: nextJob.contactPhone,
        delayMinutes: nextJob.delayMinutes
      } : null;

      return {
        totalJobs,
        pendingJobs,
        processingJobs,
        completedJobs,
        failedJobs,
        cancelledJobs,
        averageProcessingTime,
        nextScheduledJob
      };
    } catch (error) {
      console.error('Error getting campaign job statistics:', error);
      throw error;
    }
  }

  /**
   * Get pending jobs that are ready to be processed
   */
  async getPendingJobsReadyForProcessing(limit: number = 100): Promise<CampaignJob[]> {
    try {
      const now = new Date();
      
      const jobs = await this.campaignJobRepository.find({
        where: { 
          status: 'pending'
        },
        relations: ['campaign'],
        order: { scheduledAt: 'ASC' },
        take: limit
      });

      // Filter jobs that are due to be processed
      const readyJobs = jobs.filter(job => job.scheduledAt <= now);
      
      return readyJobs;
    } catch (error) {
      console.error('Error getting pending jobs ready for processing:', error);
      throw error;
    }
  }

  /**
   * Retry a failed job
   */
  async retryFailedJob(jobId: number): Promise<CampaignJob> {
    try {
      const job = await this.campaignJobRepository.findOne({
        where: { id: jobId }
      });

      if (!job) {
        throw new Error(`Job with ID ${jobId} not found`);
      }

      if (!job.canRetry) {
        throw new Error(`Job ${jobId} cannot be retried (status: ${job.status}, retries: ${job.retryCount}/${job.maxRetries})`);
      }

      // Reset job for retry
      job.status = 'pending';
      job.errorMessage = null;
      job.processingStartedAt = null;
      job.processedAt = null;
      job.retryCount = (job.retryCount || 0) + 1;
      job.scheduledAt = new Date(); // Schedule immediately for retry

      const updatedJob = await this.campaignJobRepository.save(job);
      console.log(`🔄 Job ${jobId} scheduled for retry (attempt ${updatedJob.retryCount}/${updatedJob.maxRetries})`);
      
      return updatedJob;
    } catch (error) {
      console.error('Error retrying failed job:', error);
      throw error;
    }
  }

  /**
   * Cancel pending jobs for a campaign
   */
  async cancelPendingJobs(campaignId: number): Promise<number> {
    try {
      const result = await this.campaignJobRepository.update(
        { 
          campaignId,
          status: 'pending'
        },
        { 
          status: 'cancelled',
          processedAt: new Date()
        }
      );

      const cancelledCount = result.affected || 0;
      console.log(`❌ Cancelled ${cancelledCount} pending jobs for campaign ${campaignId}`);
      
      return cancelledCount;
    } catch (error) {
      console.error('Error cancelling pending jobs:', error);
      throw error;
    }
  }

  /**
   * Get job by queue job ID
   */
  async getJobByQueueId(queueJobId: string): Promise<CampaignJob | null> {
    try {
      const job = await this.campaignJobRepository.findOne({
        where: { queueJobId },
        relations: ['campaign']
      });

      return job;
    } catch (error) {
      console.error('Error getting job by queue ID:', error);
      throw error;
    }
  }

  /**
   * Clean up old completed jobs (optional maintenance method)
   */
  async cleanupOldJobs(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const result = await this.campaignJobRepository
        .createQueryBuilder()
        .delete()
        .where('status IN (:...statuses)', { statuses: ['completed', 'cancelled'] })
        .andWhere('processedAt < :cutoffDate', { cutoffDate })
        .execute();

      const deletedCount = result.affected || 0;
      console.log(`🧹 Cleaned up ${deletedCount} old jobs older than ${olderThanDays} days`);
      
      return deletedCount;
    } catch (error) {
      console.error('Error cleaning up old jobs:', error);
      throw error;
    }
  }

  /**
   * Get job execution timeline for a campaign
   */
  async getCampaignJobTimeline(campaignId: number): Promise<{
    timeline: Array<{
      date: string;
      completed: number;
      failed: number;
      total: number;
    }>;
    totalDays: number;
  }> {
    try {
      const jobs = await this.campaignJobRepository.find({
        where: { campaignId },
        order: { processedAt: 'ASC' }
      });

      const timelineMap = new Map<string, { completed: number; failed: number; total: number }>();
      
      jobs.forEach(job => {
        if (job.processedAt) {
          const dateKey = job.processedAt.toISOString().split('T')[0]; // YYYY-MM-DD
          
          if (!timelineMap.has(dateKey)) {
            timelineMap.set(dateKey, { completed: 0, failed: 0, total: 0 });
          }
          
          const dayStats = timelineMap.get(dateKey)!;
          dayStats.total += 1;
          
          if (job.status === 'completed') {
            dayStats.completed += 1;
          } else if (job.status === 'failed') {
            dayStats.failed += 1;
          }
        }
      });

      const timeline = Array.from(timelineMap.entries())
        .map(([date, stats]) => ({
          date,
          completed: stats.completed,
          failed: stats.failed,
          total: stats.total
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        timeline,
        totalDays: timeline.length
      };
    } catch (error) {
      console.error('Error getting campaign job timeline:', error);
      throw error;
    }
  }
}