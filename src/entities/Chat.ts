import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Message } from './Message.ts';
import { Session } from './Session.ts';

@Entity('chats')
@Index(['sessionName'])
@Index(['chatType'])
@Index(['isActive'])
@Index(['lastMessageTime'])
@Index(['participantNumber'])
export class Chat {
  @PrimaryColumn({ type: 'varchar', length: 255, name: 'chat_id' })
  chatId: string;

  @Column({ type: 'nvarchar', length: 255, nullable: true, name: 'chat_name' })
  chatName: string;

  @Column({ type: 'varchar', length: 20, name: 'chat_type' })
  chatType: 'individual' | 'group';

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'participant_number' })
  participantNumber: string;

  @Column({ type: 'nvarchar', length: 255, nullable: true, name: 'group_name' })
  groupName: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'last_message_id' })
  lastMessageId: string;

  @Column({ type: 'nvarchar', nullable: true, name: 'last_message_text' })
  lastMessageText: string;

  @Column({ type: 'datetime', nullable: true, name: 'last_message_time' })
  lastMessageTime: Date;

  @Column({ type: 'varchar', length: 50, nullable: true, name: 'last_message_from' })
  lastMessageFrom: string;

  @Column({ type: 'int', default: 0, name: 'unread_count' })
  unreadCount: number;

  @Column({ type: 'bit', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'varchar', length: 255, name: 'session_name' })
  sessionName: string;

  @Column({ type: 'int', default: 0, name: 'total_messages' })
  totalMessages: number;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'last_reply_id' })
  lastReplyId: string;

  @Column({ type: 'int', default: 0, name: 'reply_count' })
  replyCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // Relations
  @OneToMany(() => Message, message => message.chat)
  messages: Message[];

  @ManyToOne(() => Session, session => session.chats)
  @JoinColumn({ name: 'session_name', referencedColumnName: 'sessionName' })
  session: Session;
}