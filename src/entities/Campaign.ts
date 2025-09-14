import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToMany, JoinTable, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Contact, ContactGroup } from './Contact';
import { MessageTemplate } from './MessageTemplate';
import { Session } from './Session';

@Entity('campaigns')
@Index(['name'])
@Index(['sessionId'])
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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Session relation
  @Column({ type: 'int', nullable: true })
  sessionId: number;

  @Column({ type: 'bit', nullable: true, name: 'is_started', default: 0 })
  isStarted: boolean;

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
}
