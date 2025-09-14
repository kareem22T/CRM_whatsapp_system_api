import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Campaign } from './Campaign';
import { Contact } from './Contact';
import { MessageTemplate } from './MessageTemplate';

@Entity('campaign_jobs')
@Index(['campaignId'])
@Index(['status'])
@Index(['scheduledAt'])
@Index(['processedAt'])
export class CampaignJob {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'campaign_id' })
  campaignId: number;

  @Column({ type: 'int', name: 'contact_id' })
  contactId: number;

  @Column({ type: 'int', name: 'template_id' })
  templateId: number;

  @Column({ type: 'varchar', length: 20 })
  contactPhone: string;

  @Column({ type: 'nvarchar', nullable: true })
  templateMessage: string;

  @Column({ type: 'varchar', length: 100 })
  sessionName: string;

  // Job status: pending, processing, completed, failed, cancelled
  @Column({ 
    type: 'varchar', 
    length: 20, 
    default: 'pending'
  })
  status: string;

  // Bull queue job ID for tracking
  @Column({ type: 'varchar', length: 100, nullable: true, name: 'queue_job_id' })
  queueJobId: string;

  // Timing fields
  @Column({ type: 'datetime', name: 'scheduled_at' })
  scheduledAt: Date;

  @Column({ type: 'datetime', nullable: true, name: 'processing_started_at' })
  processingStartedAt: Date | null;

  @Column({ type: 'datetime', nullable: true, name: 'processed_at' })
  processedAt: Date | null;

  @Column({ type: 'int', name: 'delay_minutes' })
  delayMinutes: number;

  // Result tracking
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'whatsapp_message_id' })
  whatsappMessageId: string;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @Column({ type: 'int', nullable: true, name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ type: 'int', nullable: true, name: 'max_retries', default: 3 })
  maxRetries: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Campaign, (campaign) => campaign.jobs, {
    onDelete: "CASCADE",   
  })
  @JoinColumn({ name: 'campaign_id' })
  campaign: Campaign;

  @ManyToOne(() => Contact)
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @ManyToOne(() => MessageTemplate)
  @JoinColumn({ name: 'template_id' })
  template: MessageTemplate;

  // Helper methods
  get isCompleted(): boolean {
    return this.status === 'completed';
  }

  get isFailed(): boolean {
    return this.status === 'failed';
  }

  get isPending(): boolean {
    return this.status === 'pending';
  }

  get isProcessing(): boolean {
    return this.status === 'processing';
  }

  get canRetry(): boolean {
    return this.status === 'failed' && this.retryCount < this.maxRetries;
  }

  get processingDuration(): number | null {
    if (!this.processingStartedAt || !this.processedAt) return null;
    return this.processedAt.getTime() - this.processingStartedAt.getTime();
  }
}