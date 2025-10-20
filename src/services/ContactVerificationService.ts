import { DataSource, Repository, In } from 'typeorm';
import { ContactVerificationJob } from '../entities/ContactVerificationJob';
import { Contact } from '../entities/Contact';
import { ContactGroup } from '../entities/Contact';
import { DatabaseManager } from '../database/database-manager';

export class ContactVerificationService {
  private verificationJobRepository: Repository<ContactVerificationJob>;
  private contactRepository: Repository<Contact>;
  private contactGroupRepository: Repository<ContactGroup>;

  constructor(dataSource?: DataSource) {
    const dbManager = DatabaseManager.getInstance();
    const source = dataSource || dbManager.dataSource;
    
    this.verificationJobRepository = source.getRepository(ContactVerificationJob);
    this.contactRepository = source.getRepository(Contact);
    this.contactGroupRepository = source.getRepository(ContactGroup);
  }

  /**
   * Start verification process for a contact group
   */
  async startGroupVerification(
    groupId: number,
    sessionName: string,
    minDelay: number = 5,
    maxDelay: number = 15
  ): Promise<{
    totalContacts: number;
    uncheckedContacts: number;
    jobs: ContactVerificationJob[];
  }> {
    // Get group with contacts
    const group = await this.contactGroupRepository.findOne({
      where: { id: groupId },
      relations: ['contacts']
    });

    if (!group) {
      throw new Error(`Contact group with ID ${groupId} not found`);
    }

    // Filter unchecked contacts
    const uncheckedContacts = group.contacts.filter(contact => !contact.isChecked);

    if (uncheckedContacts.length === 0) {
      throw new Error('All contacts in this group have already been verified');
    }

    const jobs: ContactVerificationJob[] = [];
    const startTime = new Date();
    let cumulativeDelay = 0;

    for (const contact of uncheckedContacts) {
      // Random delay between min and max (in seconds)
      const randomDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
      cumulativeDelay += randomDelay;

      const scheduledAt = new Date(startTime.getTime() + cumulativeDelay * 1000);

      const job = this.verificationJobRepository.create({
        groupId,
        contactId: contact.id,
        contactPhone: contact.phone,
        sessionName,
        status: 'pending',
        scheduledAt,
        delaySeconds: cumulativeDelay,
        retryCount: 0,
        maxRetries: 2
      });

      jobs.push(job);
    }

    // Save all jobs
    await this.verificationJobRepository.save(jobs);

    console.log(`Created ${jobs.length} verification jobs for group "${group.name}"`);

    return {
      totalContacts: group.contacts.length,
      uncheckedContacts: uncheckedContacts.length,
      jobs
    };
  }

  /**
   * Start verification for a single contact
   */
  async startContactVerification(
    contactId: number,
    sessionName: string,
    delaySeconds: number = 0
  ): Promise<ContactVerificationJob> {
    const contact = await this.contactRepository.findOne({
      where: { id: contactId }
    });

    if (!contact) {
      throw new Error(`Contact with ID ${contactId} not found`);
    }

    if (contact.isChecked) {
      throw new Error('This contact has already been verified');
    }

    const scheduledAt = new Date(Date.now() + delaySeconds * 1000);

    const job = this.verificationJobRepository.create({
      groupId: null,
      contactId: contact.id,
      contactPhone: contact.phone,
      sessionName,
      status: 'pending',
      scheduledAt,
      delaySeconds,
      retryCount: 0,
      maxRetries: 2
    });

    await this.verificationJobRepository.save(job);

    console.log(`Created verification job for contact ${contact.name} (${contact.phone})`);

    return job;
  }

  /**
   * Update job status to processing
   */
  async updateJobProcessing(jobId: number): Promise<void> {
    await this.verificationJobRepository.update(jobId, {
      status: 'processing',
      processingStartedAt: new Date()
    });
  }

  /**
   * Update job with verification result
   */
  async updateJobResult(
    jobId: number,
    isWhatsappUser: boolean,
    contactId: number,
    sessionName: string
  ): Promise<void> {
    await this.verificationJobRepository.update(jobId, {
      status: 'completed',
      isWhatsappUser,
      processedAt: new Date()
    });

    // Update contact
    await this.contactRepository.update(contactId, {
      isChecked: true,
      isWpContact: isWhatsappUser,
      checkedAt: new Date(),
      checkedBySession: sessionName
    });

    console.log(`Contact ${contactId} verified: ${isWhatsappUser ? 'WhatsApp user' : 'Not WhatsApp user'}`);
  }

  /**
   * Update job as failed
   */
  async updateJobFailed(jobId: number, errorMessage: string): Promise<void> {
    const job = await this.verificationJobRepository.findOne({ where: { id: jobId } });
    
    if (!job) return;

    await this.verificationJobRepository.update(jobId, {
      status: 'failed',
      errorMessage,
      processedAt: new Date(),
      retryCount: job.retryCount + 1
    });
  }

  /**
   * Update job with queue ID
   */
  async updateJobWithQueueId(jobId: number, queueJobId: string): Promise<void> {
    await this.verificationJobRepository.update(jobId, { queueJobId });
  }

  /**
   * Get verification progress for a group
   */
  async getGroupVerificationProgress(groupId: number): Promise<{
    totalJobs: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    whatsappUsers: number;
    nonWhatsappUsers: number;
    progressPercentage: number;
  }> {
    const jobs = await this.verificationJobRepository.find({
      where: { groupId }
    });

    const completed = jobs.filter(j => j.status === 'completed');
    const whatsappUsers = completed.filter(j => j.isWhatsappUser === true).length;
    const nonWhatsappUsers = completed.filter(j => j.isWhatsappUser === false).length;

    return {
      totalJobs: jobs.length,
      pending: jobs.filter(j => j.status === 'pending').length,
      processing: jobs.filter(j => j.status === 'processing').length,
      completed: completed.length,
      failed: jobs.filter(j => j.status === 'failed').length,
      whatsappUsers,
      nonWhatsappUsers,
      progressPercentage: jobs.length > 0 ? (completed.length / jobs.length) * 100 : 0
    };
  }

  /**
   * Get all verification jobs for a group
   */
  async getGroupVerificationJobs(
    groupId: number,
    status?: string
  ): Promise<ContactVerificationJob[]> {
    const where: any = { groupId };
    if (status) {
      where.status = status;
    }

    return await this.verificationJobRepository.find({
      where,
      relations: ['contact'],
      order: { scheduledAt: 'ASC' }
    });
  }

  /**
   * Retry failed job
   */
  async retryFailedJob(jobId: number): Promise<ContactVerificationJob> {
    const job = await this.verificationJobRepository.findOne({
      where: { id: jobId },
      relations: ['contact']
    });

    if (!job) {
      throw new Error(`Job with ID ${jobId} not found`);
    }

    if (!job.canRetry) {
      throw new Error('Job cannot be retried (max retries reached or not in failed state)');
    }

    // Update job for retry
    job.status = 'pending';
    job.scheduledAt = new Date();
    job.errorMessage = null;
    job.processingStartedAt = null;
    job.processedAt = null;

    await this.verificationJobRepository.save(job);

    return job;
  }

  /**
   * Get contacts that need verification (not yet checked)
   */
  async getUnverifiedContacts(groupId?: number): Promise<Contact[]> {
    const where: any = { isChecked: false };

    if (groupId) {
      return await this.contactRepository
        .createQueryBuilder('contact')
        .innerJoin('contact.groups', 'group')
        .where('contact.isChecked = :isChecked', { isChecked: false })
        .andWhere('group.id = :groupId', { groupId })
        .getMany();
    }

    return await this.contactRepository.find({ where });
  }

  /**
   * Get verification statistics
   */
  async getVerificationStats(groupId?: number): Promise<{
    total: number;
    checked: number;
    unchecked: number;
    whatsappUsers: number;
    nonWhatsappUsers: number;
    checkRate: number;
    whatsappRate: number;
  }> {
    let contacts: Contact[];

    if (groupId) {
      const group = await this.contactGroupRepository.findOne({
        where: { id: groupId },
        relations: ['contacts']
      });
      contacts = group?.contacts || [];
    } else {
      contacts = await this.contactRepository.find();
    }

    const checked = contacts.filter(c => c.isChecked);
    const whatsappUsers = contacts.filter(c => c.isWpContact).length;

    return {
      total: contacts.length,
      checked: checked.length,
      unchecked: contacts.length - checked.length,
      whatsappUsers,
      nonWhatsappUsers: checked.length - whatsappUsers,
      checkRate: contacts.length > 0 ? (checked.length / contacts.length) * 100 : 0,
      whatsappRate: checked.length > 0 ? (whatsappUsers / checked.length) * 100 : 0
    };
  }
}