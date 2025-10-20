import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Contact } from './Contact';
import { ContactGroup } from './Contact';

@Entity('contact_verification_jobs')
@Index(['groupId'])
@Index(['status'])
@Index(['scheduledAt'])
@Index(['processedAt'])
export class ContactVerificationJob {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true, name: 'group_id', comment: 'If checking a group, store group ID' })
  groupId: number | null;

  @Column({ type: 'int', name: 'contact_id' })
  contactId: number;

  @Column({ type: 'varchar', length: 20, name: 'contact_phone' })
  contactPhone: string;

  @Column({ type: 'varchar', length: 100, name: 'session_name' })
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

  @Column({ type: 'int', name: 'delay_seconds', comment: 'Delay in seconds from start' })
  delaySeconds: number;

  // Result tracking
  @Column({ type: 'bit', nullable: true, name: 'is_whatsapp_user', comment: 'Verification result' })
  isWhatsappUser: boolean | null;

  @Column({ type: 'text', nullable: true, name: 'error_message' })
  errorMessage: string | null;

  @Column({ type: 'int', nullable: true, name: 'retry_count', default: 0 })
  retryCount: number;

  @Column({ type: 'int', nullable: true, name: 'max_retries', default: 2 })
  maxRetries: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => ContactGroup, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: 'group_id' })
  group: ContactGroup | null;

  @ManyToOne(() => Contact, { onDelete: "CASCADE" })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

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