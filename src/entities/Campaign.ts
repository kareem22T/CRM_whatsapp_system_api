import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToMany, JoinTable, Index, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Contact, ContactGroup } from './Contact';
import { MessageTemplate } from './MessageTemplate';
import { Session } from './Session';
import { CampaignJob } from './CampaignJob';

@Entity('campaigns')
@Index(['name'])
@Index(['sessionId'])
@Index(['status'])
export class Campaign {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  name: string;

  @Column({ type: 'nvarchar', nullable: true })
  description: string;

  @Column({ type: 'int', name: 'group_id'})
  groupId: number;

  // Timing configuration for message sending
  @Column({ type: 'int', name: 'min_interval_minutes', default: 30 })
  minIntervalMinutes: number;

  @Column({ type: 'int', name: 'max_interval_minutes', default: 120 })
  maxIntervalMinutes: number;

  @Column({ type: 'datetime', nullable: true, name: 'last_sent' })
  lastSent: Date;

  // Campaign Status and Progress Tracking
  @Column({ 
    type: 'varchar', 
    length: 50, 
    default: 'inactive',
    comment: 'Campaign status: inactive, active, running, paused, completed, failed'
  })
  status: string;

  @Column({ type: 'bit', nullable: true, name: 'is_started', default: 0 })
  isStarted: boolean;

  // Progress tracking fields
  @Column({ type: 'int', name: 'total_contacts', default: 0 })
  totalContacts: number;

  @Column({ type: 'int', name: 'messages_sent', default: 0 })
  messagesSent: number;

  @Column({ type: 'int', name: 'messages_failed', default: 0 })
  messagesFailed: number;

  @Column({ type: 'int', name: 'messages_pending', default: 0 })
  messagesPending: number;

  // Percentage progress (computed field)
  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'progress_percentage', default: 0.00 })
  progressPercentage: number;

  // Next scheduled send time
  @Column({ type: 'datetime', nullable: true, name: 'next_send_at' })
  nextSendAt: Date | null;

  // Campaign completion tracking
  @Column({ type: 'datetime', nullable: true, name: 'started_at' })
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true, name: 'completed_at' })
  completedAt: Date;

  @Column({ type: 'datetime', nullable: true, name: 'paused_at' })
  pausedAt: Date | null;

  // Estimated completion time
  @Column({ type: 'datetime', nullable: true, name: 'estimated_completion_at' })
  estimatedCompletionAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Session relation
  @Column({ type: 'int', nullable: true })
  sessionId: number;

  @OneToMany(() => CampaignJob, (job) => job.campaign)
  jobs: CampaignJob[];

  @ManyToOne(() => Session, session => session.campaigns)
  @JoinColumn({ name: 'sessionId' })
  session: Session;

  @ManyToOne(() => ContactGroup, contactGroup => contactGroup.campaigns)
  @JoinColumn({ name: 'group_id' })
  contactGroup: ContactGroup;

  // Many-to-many relation with message templates
  @ManyToMany(() => MessageTemplate, template => template.campaigns)
  @JoinTable({
    name: 'campaign_templates',
    joinColumn: { name: 'campaign_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'template_id', referencedColumnName: 'id' }
  })
  templates: MessageTemplate[];

  // Virtual computed properties
  get isCompleted(): boolean {
    return this.status === 'completed';
  }

  get isActive(): boolean {
    return ['active', 'running'].includes(this.status);
  }

  get remainingContacts(): number {
    return Math.max(0, this.totalContacts - this.messagesSent - this.messagesFailed);
  }

  get successRate(): number {
    if (this.messagesSent + this.messagesFailed === 0) return 0;
    return (this.messagesSent / (this.messagesSent + this.messagesFailed)) * 100;
  }
}