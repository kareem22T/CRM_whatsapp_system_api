import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Session } from './Session.ts';
import { Chat } from './Chat.ts';

@Entity('messages')
@Index(['sessionName'])
@Index(['chatId'])
@Index(['timestamp'])
@Index(['messageStatus'])
@Index(['fromNumber'])
@Index(['toNumber'])
@Index(['participantPhone'])
@Index(['participantName'])
@Index(['isReply'])
@Index(['quotedMessageId'])
export class Message {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true, name: 'message_id' })
  messageId: string;

  @Column({ type: 'varchar', length: 50, name: 'from_number' })
  fromNumber: string;

  @Column({ type: 'varchar', length: 50, name: 'to_number' })
  toNumber: string;

  @Column({ type: 'nvarchar', name: 'message_body', nullable: true })
  messageBody: string;

  @Column({ type: 'varchar', length: 20, name: 'message_type' })
  messageType: string;

  @Column({ type: 'bit', default: false, name: 'is_group' })
  isGroup: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'group_id' })
  groupId: string;

  @Column({ type: 'datetime', default: () => 'GETDATE()' })
  timestamp: Date;

  @Column({ type: 'bit', default: false, name: 'is_from_me' })
  isFromMe: boolean;

  @Column({ type: 'varchar', length: 20, default: 'pending', name: 'message_status' })
  messageStatus: string;

  @Column({ type: 'varchar', length: 255, name: 'session_name' })
  sessionName: string;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'media_url' })
  mediaUrl: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'media_filename' })
  mediaFilename: string;

  @Column({ type: 'varchar', length: 100, nullable: true, name: 'media_mimetype' })
  mediaMimetype: string;

  @Column({ type: 'bigint', nullable: true, name: 'media_size' })
  mediaSize: number;

  @Column({ type: 'varchar', length: 255, name: 'chat_id' })
  chatId: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'sender_name' })
  senderName: string;

  @Column({ type: 'nvarchar', length: 255, nullable: true, name: 'participant_name' })
  participantName: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'participant_phone' })
  participantPhone: string;

  @Column({ type: 'nvarchar', length: 255, nullable: true, name: 'contact_pushname' })
  contactPushname: string;

  @Column({ type: 'bit', default: false, name: 'is_reply' })
  isReply: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'quoted_message_id' })
  quotedMessageId: string;

  @Column({ type: 'nvarchar', nullable: true, name: 'quoted_message_body' })
  quotedMessageBody: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'quoted_message_from' })
  quotedMessageFrom: string;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'quoted_message_type' })
  quotedMessageType: string;

  @Column({ type: 'datetime', nullable: true, name: 'quoted_message_timestamp' })
  quotedMessageTimestamp: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => Session, session => session.messages)
  @JoinColumn({ name: 'session_name', referencedColumnName: 'sessionName' })
  session: Session;

  @ManyToOne(() => Chat, chat => chat.messages)
  @JoinColumn({ name: 'chat_id', referencedColumnName: 'chatId' })
  chat: Chat;

  // Computed properties
  get downloadUrl(): string | null {
    return this.mediaFilename ? `/messages/${this.messageId}/download` : null;
  }

  get viewUrl(): string | null {
    return this.mediaFilename ? `/messages/${this.messageId}/view` : null;
  }
}
