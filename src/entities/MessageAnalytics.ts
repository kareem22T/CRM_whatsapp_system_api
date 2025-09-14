import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('message_analytics')
@Unique(['sessionName', 'dateRecorded'])
@Index(['sessionName', 'dateRecorded'])
@Index(['dateRecorded'])
export class MessageAnalytics {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, name: 'session_name' })
  sessionName: string;

  @Column({ type: 'date', name: 'date_recorded' })
  dateRecorded: Date;

  @Column({ type: 'int', default: 0, name: 'total_messages' })
  totalMessages: number;

  @Column({ type: 'int', default: 0, name: 'sent_messages' })
  sentMessages: number;

  @Column({ type: 'int', default: 0, name: 'received_messages' })
  receivedMessages: number;

  @Column({ type: 'int', default: 0, name: 'reply_messages' })
  replyMessages: number;

  @Column({ type: 'int', default: 0, name: 'media_messages' })
  mediaMessages: number;

  @Column({ type: 'int', default: 0, name: 'group_messages' })
  groupMessages: number;

  @Column({ type: 'int', default: 0, name: 'individual_messages' })
  individualMessages: number;

  @Column({ type: 'int', default: 0, name: 'unique_contacts' })
  uniqueContacts: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
