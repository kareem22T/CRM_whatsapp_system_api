import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, Index, ManyToOne, JoinColumn } from 'typeorm';
import { Message } from './Message.ts';
import { Chat } from './Chat.ts';
import { User } from './User.ts';
import { Campaign } from './Campaign.ts';

@Entity('sessions')
@Index(['agentName'])
@Index(['isActive'])
@Index(['connectionStatus'])
export class Session {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true, name: 'session_name' })
  sessionName: string;

  @Column({ type: 'varchar', length: 255, name: 'agent_name' })
  agentName: string;

  @Column({ type: 'bit', default: true, name: 'is_active' })
  isActive: boolean;

  @Column({ type: 'datetime', nullable: true, name: 'last_connected' })
  lastConnected: Date;

  @Column({ type: 'varchar', length: 50, default: 'inactive', name: 'connection_status' })
  connectionStatus: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ type: "int", nullable: true })
  userId: number;

  @ManyToOne(() => User, user => user.sessions)
  @JoinColumn({ name: 'userId' })
  user: User;

  @OneToMany(() => Message, message => message.session)
  messages: Message[];

  @OneToMany(() => Chat, chat => chat.session)
  chats: Chat[];

  @OneToMany(() => Campaign, campaign => campaign.session)
  campaigns: Campaign[];
}
